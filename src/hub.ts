/**
 * The one shared state every action renders from: the Herdr, QuickAsk and
 * plain-terminal Claude watchers, the plugin's global settings, and the focus routine.
 */
import streamDeck from "@elgato/streamdeck";

import { ClaudeTermWatcher } from "./claude-term";
import { raiseHerdrWindow } from "./ghostty";
import { HerdrWatcher } from "./herdr";
import { OnYou, type Turn } from "./on-you";
import { openQuickAskChat, QuickAskWatcher } from "./quickask";
import { claudeTermWaiting, herdrWaiting, orderWaiting, quickAskWaiting, type WaitingSession } from "./waiting";

export type GlobalSettings = {
	/** Count "done" (finished a turn, unseen) as waiting. Default true. */
	countDone?: boolean;
	/** Substring of the Ghostty tab title that holds the Herdr TUI. Default "Herdr". */
	windowMatch?: string;
};

type Listener = () => void;

class Hub {
	readonly herdr = new HerdrWatcher();
	readonly quickAsk = new QuickAskWatcher();
	readonly claudeTerm = new ClaudeTermWatcher();
	readonly onYou = new OnYou();
	settings: GlobalSettings = {};
	#listeners = new Set<Listener>();
	/** When each Herdr pane entered its current waiting state, as first seen by the plugin. */
	#firstSeen = new Map<string, number>();

	/** Something to show: Herdr is up, or another source has sessions waiting. False shows "offline". */
	get online(): boolean {
		return this.herdr.state.online || this.waiting.length > 0;
	}

	get waiting(): WaitingSession[] {
		const countDone = this.settings.countDone ?? true;
		const now = Date.now();
		const seen = new Set<string>();
		const stamp = (key: string) => {
			seen.add(key);
			if (!this.#firstSeen.has(key)) this.#firstSeen.set(key, now);
			return this.#firstSeen.get(key)!;
		};
		const terms = this.claudeTerm.waiting().map((t) => ({ ...t, state: t.state as "needs-you" | "done", title: this.claudeTerm.title(t) }));
		const items = [
			...herdrWaiting(this.herdr.state.agents, countDone, stamp),
			...quickAskWaiting(this.quickAsk.chats, countDone),
			...claudeTermWaiting(terms, countDone),
		];
		for (const key of this.#firstSeen.keys()) if (!seen.has(key)) this.#firstSeen.delete(key);
		return orderWaiting(items);
	}

	start(): void {
		this.herdr.on("change", () => this.#emit());
		this.herdr.on("log", (m: string) => streamDeck.logger.warn(m));
		this.quickAsk.on("change", () => this.#emit());
		this.claudeTerm.on("change", () => this.#emit());
		this.onYou.on("change", () => this.#emit());
		this.onYou.on("log", (m: string) => streamDeck.logger.info(`on you: ${m}`));
		this.herdr.start();
		this.quickAsk.start();
		this.claudeTerm.start();
		// Re-judged on every source change; the OnYou tick covers the 10-minute wait.
		this.subscribe(() => this.onYou.refresh());
		this.onYou.start(() => this.#onYouInputs());
	}

	applySettings(s: GlobalSettings): void {
		this.settings = s ?? {};
		this.#emit();
	}

	subscribe(fn: Listener): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	/** Bring a waiting session forward by its key. Returns false if it couldn't. */
	async focus(key: string): Promise<boolean> {
		const [source, ...rest] = key.split(":");
		const id = rest.join(":");
		if (source === "claude") {
			const ok = await this.claudeTerm.focus(id).catch(() => false);
			streamDeck.logger.info(`focused Claude session ${id} in Ghostty: ${ok ? "ok" : "failed"}`);
			return ok;
		}
		if (source === "quickask") {
			const ok = await openQuickAskChat(id);
			streamDeck.logger.info(`opened QuickAsk chat ${id}: ${ok ? "ok" : "failed"}`);
			return ok;
		}
		try {
			await this.herdr.focus(id);
		} catch (e) {
			streamDeck.logger.error(`focus ${id} failed: ${(e as Error).message}`);
			return false;
		}
		const how = await raiseHerdrWindow(this.settings.windowMatch ?? "Herdr");
		streamDeck.logger.info(`focused ${id}; ghostty raised via ${how}`);
		return true;
	}

	/** What "On you" reads: every Claude turn, whether it's been seen, how to show and focus it. */
	#onYouInputs() {
		const agents = new Map(this.herdr.state.agents.map((a) => [a.pane_id, a]));
		return {
			turns: this.claudeTerm.all as Turn[],
			// A Herdr pane is seen once Herdr stops calling it "done"; a plain tab, once the deck saw it in front.
			seen: (t: Turn) => (t.herdr_pane ? agents.has(t.herdr_pane) && agents.get(t.herdr_pane)!.agent_status !== "done" : this.claudeTerm.seen.has(`${t.session_id}:${t.since}`)),
			describe: (t: Turn) => {
				if (!t.herdr_pane) {
					const s = this.claudeTerm.sessions.find((x) => x.session_id === t.session_id);
					return s ? { key: `claude:${s.session_id}`, title: this.claudeTerm.title(s) } : null;
				}
				const a = agents.get(t.herdr_pane);
				return a ? { key: `herdr:${a.pane_id}`, title: a.terminal_title_stripped?.trim() || a.agent || "Herdr agent" } : null;
			},
			quickAsk: this.quickAsk.chats.filter((c) => c.state === "still-on-you"),
		};
	}

	#emit(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch (e) {
				streamDeck.logger.error(`render failed: ${(e as Error).message}`);
			}
		}
	}
}

export const hub = new Hub();
