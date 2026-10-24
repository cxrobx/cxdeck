/**
 * Herdr socket client: newline-delimited JSON {id, method, params} over
 * ~/.config/herdr/herdr.sock (same protocol as ~/.local/bin/cx-open-in-herdr).
 *
 * State is pushed: one long-lived `events.subscribe` connection listens for
 * agent appear/close/focus plus a per-pane `pane.agent_status_changed` for
 * every known pane (Herdr requires a pane_id on that one). Any event triggers
 * a re-read of `agent.list`. A slow poll backs it up in case an event is
 * missed or a pane appears between subscriptions.
 */
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { HerdrAgent } from "./waiting";

export const SOCKET_PATH = process.env.HERDR_SOCKET ?? path.join(os.homedir(), ".config/herdr/herdr.sock");

const REQUEST_TIMEOUT_MS = 5000;
const SAFETY_POLL_MS = 5000;
const MAX_BACKOFF_MS = 10000;
const MAX_RESPONSE = 8 * 1024 * 1024;

export class HerdrError extends Error {}

/** One request on its own connection; rejects on timeout, socket error or a Herdr error reply. */
export function request<T = unknown>(method: string, params: object = {}, socketPath = SOCKET_PATH): Promise<T> {
	return new Promise((resolve, reject) => {
		const id = randomUUID();
		const sock = net.createConnection(socketPath);
		let buf = "";
		const done = (err: Error | null, value?: T) => {
			clearTimeout(timer);
			sock.destroy();
			err ? reject(err) : resolve(value as T);
		};
		const timer = setTimeout(() => done(new HerdrError(`${method}: timed out`)), REQUEST_TIMEOUT_MS);
		sock.setEncoding("utf8");
		sock.on("connect", () => sock.write(JSON.stringify({ id, method, params }) + "\n"));
		sock.on("data", (chunk: string) => {
			buf += chunk;
			if (buf.length > MAX_RESPONSE) return done(new HerdrError(`${method}: oversized response`));
			const nl = buf.indexOf("\n");
			if (nl < 0) return;
			try {
				const msg = JSON.parse(buf.slice(0, nl));
				if (msg.id !== id) return done(new HerdrError(`${method}: mismatched reply id`));
				if (msg.error) return done(new HerdrError(`${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
				done(null, msg.result as T);
			} catch (e) {
				done(e as Error);
			}
		});
		sock.on("error", (e) => done(e));
		sock.on("close", () => done(new HerdrError(`${method}: connection closed`)));
	});
}

export type HerdrState = { online: boolean; agents: HerdrAgent[] };

/**
 * Emits "change" with a HerdrState whenever the agent list or online status
 * changes. Never throws; Herdr being down is just `online: false`.
 */
export class HerdrWatcher extends EventEmitter {
	state: HerdrState = { online: false, agents: [] };

	#sub: net.Socket | null = null;
	#subPanes = "";
	#poll: NodeJS.Timeout | null = null;
	#retry: NodeJS.Timeout | null = null;
	#backoff = 1000;
	#refreshing: Promise<void> | null = null;
	#again = false;
	#stopped = false;

	private readonly socketPath: string;

	constructor(socketPath = SOCKET_PATH) {
		super();
		this.socketPath = socketPath;
	}

	start(): void {
		this.#stopped = false;
		void this.refresh();
		this.#poll = setInterval(() => void this.refresh(), SAFETY_POLL_MS);
	}

	stop(): void {
		this.#stopped = true;
		if (this.#poll) clearInterval(this.#poll);
		if (this.#retry) clearTimeout(this.#retry);
		this.#closeSub();
	}

	/** Re-read agent.list; coalesces bursts of events into at most one extra read. */
	refresh(): Promise<void> {
		if (this.#refreshing) {
			this.#again = true;
			return this.#refreshing;
		}
		this.#refreshing = (async () => {
			do {
				this.#again = false;
				await this.#readOnce();
			} while (this.#again && !this.#stopped);
		})().finally(() => (this.#refreshing = null));
		return this.#refreshing;
	}

	async focus(paneId: string): Promise<void> {
		await request("agent.focus", { target: paneId }, this.socketPath);
		void this.refresh();
	}

	async #readOnce(): Promise<void> {
		let next: HerdrState;
		try {
			const res = await request<{ agents: HerdrAgent[] }>("agent.list", {}, this.socketPath);
			next = { online: true, agents: res.agents ?? [] };
		} catch {
			next = { online: false, agents: [] };
		}
		const changed = JSON.stringify(next) !== JSON.stringify(this.state);
		this.state = next;
		if (next.online) this.#ensureSubscription(next.agents);
		else this.#closeSub();
		if (changed) this.emit("change", next);
	}

	/** (Re)subscribe when the set of panes changes, since status events are per pane. */
	#ensureSubscription(agents: HerdrAgent[]): void {
		const panes = agents.map((a) => a.pane_id).sort();
		const key = panes.join(",");
		if (this.#sub && key === this.#subPanes) return;
		this.#closeSub();
		this.#subPanes = key;

		const subscriptions = [
			{ type: "pane.agent_detected" },
			{ type: "pane.closed" },
			{ type: "pane.focused" },
			...panes.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
		];
		const sock = net.createConnection(this.socketPath);
		this.#sub = sock;
		let buf = "";
		sock.setEncoding("utf8");
		sock.on("connect", () => {
			sock.write(JSON.stringify({ id: randomUUID(), method: "events.subscribe", params: { subscriptions } }) + "\n");
		});
		sock.on("data", (chunk: string) => {
			buf += chunk;
			let nl: number;
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				let msg: { event?: string; error?: unknown };
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg.error) {
					this.emit("log", `subscribe error: ${JSON.stringify(msg.error)}`);
					continue;
				}
				if (msg.event) {
					this.#backoff = 1000;
					void this.refresh();
				}
			}
		});
		const lost = () => {
			if (this.#sub !== sock) return;
			this.#sub = null;
			this.#subPanes = "";
			if (this.#stopped) return;
			// Herdr went away or restarted: re-read (marks offline) and retry with backoff.
			if (this.#retry) clearTimeout(this.#retry);
			this.#retry = setTimeout(() => void this.refresh(), this.#backoff);
			this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
		};
		sock.on("error", lost);
		sock.on("close", lost);
	}

	#closeSub(): void {
		const s = this.#sub;
		this.#sub = null;
		this.#subPanes = "";
		s?.destroy();
	}
}
