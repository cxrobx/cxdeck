/**
 * Open a link in Zen in the right container, or bring forward the tab that
 * already has it. Talks to the Zen MCP daemon (ws://127.0.0.1:8766) as one
 * more client, using the same calls Zen MCP's servers make: containers.list,
 * pages.list (includeHidden, so tabs in other Zen workspaces count),
 * pages.select and pages.new. One short connection per press; nothing is held open.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadRoutes, routeFor, samePage, sameSite } from "./zen-routes";

const DAEMON_URL = process.env.ZEN_MCP_URL ?? "ws://127.0.0.1:8766";
const TOKEN_PATH = process.env.ZEN_MCP_TOKEN_FILE ?? path.join(os.homedir(), ".config/zen-mcp/auth.token");
const PROTOCOL_VERSION = 1;
const TIMEOUT_MS = 8000;
const ZEN_BUNDLE_ID = "app.zen-browser.zen";

export type ZenContainer = { cookieStoreId: string; name: string; color: string; icon: string };
type PageInfo = { tabId: number; url: string; cookieStoreId: string; containerName: string | null; active: boolean };

export class ZenError extends Error {}

type Call = <T>(method: string, params?: unknown) => Promise<T>;

/** Connects, says hello, runs `fn` with a request function, then closes. */
export async function withDaemon<T>(fn: (call: Call) => Promise<T>): Promise<T> {
	let token: string;
	try {
		token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
	} catch {
		throw new ZenError("Zen MCP token not found");
	}
	const ws = new WebSocket(DAEMON_URL);
	const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	const fail = (err: Error) => {
		for (const p of pending.values()) p.reject(err);
		pending.clear();
	};
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new ZenError("Zen MCP daemon: hello timed out")), TIMEOUT_MS);
			ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION, role: "client", token, containerScope: null })));
			ws.addEventListener("error", () => {
				clearTimeout(timer);
				reject(new ZenError("Zen MCP daemon is not running"));
			});
			ws.addEventListener("message", (ev) => {
				let msg: { type?: string; id?: string; result?: unknown; error?: { message?: string }; reason?: string; ts?: number };
				try {
					msg = JSON.parse(String(ev.data));
				} catch {
					return;
				}
				if (msg.type === "welcome") {
					clearTimeout(timer);
					resolve();
				} else if (msg.type === "unauthorized") {
					clearTimeout(timer);
					reject(new ZenError(`Zen MCP daemon refused the token: ${msg.reason}`));
				} else if (msg.type === "ping") {
					ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
				} else if (msg.type === "response" && msg.id && pending.has(msg.id)) {
					const p = pending.get(msg.id)!;
					pending.delete(msg.id);
					msg.error ? p.reject(new ZenError(msg.error.message ?? "Zen error")) : p.resolve(msg.result);
				}
			});
			ws.addEventListener("close", () => fail(new ZenError("Zen MCP daemon closed the connection")));
		});
		const call: Call = (method, params) =>
			new Promise((resolve, reject) => {
				const id = randomUUID();
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new ZenError(`${method}: timed out (is the Zen extension connected?)`));
				}, TIMEOUT_MS);
				pending.set(id, {
					resolve: (v) => (clearTimeout(timer), resolve(v as never)),
					reject: (e) => (clearTimeout(timer), reject(e)),
				});
				ws.send(JSON.stringify({ type: "request", id, method, params }));
			});
		return await fn(call);
	} finally {
		ws.close();
	}
}

export async function listContainers(): Promise<ZenContainer[]> {
	return withDaemon(async (call) => (await call<{ containers: ZenContainer[] }>("containers.list")).containers);
}

/** The container a key uses: its own setting, else Zen MCP's route for the URL. */
export function containerFor(url: string, setting: string | undefined): { container: string } | { error: string } {
	if (setting) return { container: setting };
	const route = routeFor(url, loadRoutes());
	if (route.kind === "container") return { container: route.container };
	if (route.kind === "console") return { error: `${route.host} is a shared console host; pick a container for this key` };
	return { error: "no Zen MCP route for this site; pick a container for this key" };
}

export type OpenResult = { how: "focused" | "opened"; tabId: number; container: string };

/** Focus a tab already showing `url` in that container, or open it there; then raise Zen. */
export async function openInZen(url: string, containerName: string, match: "site" | "page"): Promise<OpenResult> {
	const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
	const result = await withDaemon(async (call) => {
		const { containers } = await call<{ containers: ZenContainer[] }>("containers.list");
		const container = containers.find((c) => c.name.toLowerCase() === containerName.toLowerCase());
		if (!container) throw new ZenError(`no Zen container named "${containerName}"`);
		const { pages } = await call<{ pages: PageInfo[] }>("pages.list", { includeHidden: true });
		const same = match === "page" ? samePage : sameSite;
		// Only a tab in the same container counts: the same site in another jar is another login.
		const candidates = pages.filter((p) => p.cookieStoreId === container.cookieStoreId && same(p.url, target));
		const existing = candidates.find((p) => p.active) ?? candidates[0];
		if (existing) {
			await call("pages.select", { tabId: existing.tabId });
			return { how: "focused" as const, tabId: existing.tabId, container: container.name };
		}
		const opened = await call<{ tabId: number }>("pages.new", { url: target, cookieStoreId: container.cookieStoreId, active: true });
		await call("pages.select", { tabId: opened.tabId });
		return { how: "opened" as const, tabId: opened.tabId, container: container.name };
	});
	await new Promise((resolve) => execFile("/usr/bin/osascript", ["-e", `tell application id "${ZEN_BUNDLE_ID}" to activate`], { timeout: 4000 }, resolve));
	return result;
}

/** Firefox container colour names → swatches. */
export const CONTAINER_COLORS: Record<string, string> = {
	blue: "#37adff",
	turquoise: "#00c79a",
	green: "#51cd00",
	yellow: "#ffcb00",
	orange: "#ff9f00",
	red: "#ff613d",
	pink: "#ff4bda",
	purple: "#af51f5",
	toolbar: "#9a9aa2",
	gray: "#9a9aa2",
};
