/**
 * Claude Code sessions running in plain Ghostty tabs (not Herdr panes). Their
 * state comes from ~/.claude/hooks/cx-deck-state.sh, which writes one JSON file
 * per session into ~/.local/state/cx-deck/claude/. A file whose claude pid has
 * died is a leftover and is ignored.
 *
 * Ghostty's AppleScript doesn't say which tty a terminal uses, so to find a
 * session's tab we briefly set that tty's title to a unique marker, ask Ghostty
 * which terminal now carries it, and put the old title back. The terminal id
 * that comes back is stable, so it is learned once per tty and cached.
 *
 * More than one Ghostty process can be running (a script that runs `ghostty -e …`
 * starts a second one), and no scripting route can pick a process: AppleScript by
 * name reaches one instance, JXA (by name or pid) reaches another. So both routes
 * are searched, the terminal remembers which one found it, and the window is
 * raised through System Events by the pid of the Ghostty that owns the session.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_DIR = process.env.CX_DECK_CLAUDE_DIR ?? path.join(os.homedir(), ".local/state/cx-deck/claude");

const POLL_MS = 5000;
const SEEN_POLL_MS = 2000;

export type TermSession = {
	session_id: string;
	state: "working" | "needs-you" | "done";
	since: string;
	cwd: string;
	tty: string;
	pid: number;
};

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Live sessions in the state folder; files left by a dead claude are ignored. */
export function readSessions(dir = STATE_DIR): TermSession[] {
	let names: string[];
	try {
		names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
	} catch {
		return [];
	}
	const out: TermSession[] = [];
	for (const name of names) {
		try {
			const s = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as TermSession;
			if (s.session_id && s.tty && s.pid && alive(s.pid)) out.push(s);
		} catch {
			// half-written or foreign file
		}
	}
	return out.sort((a, b) => a.session_id.localeCompare(b.session_id));
}

function run(args: string[]): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile("/usr/bin/osascript", args, { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))),
	);
}

/** Which scripting route reached the terminal: AppleScript by name, or JXA. */
export type Route = "as" | "jxa";

const sh = (route: Route, script: string) => run(route === "as" ? ["-e", script] : ["-l", "JavaScript", "-e", script]);

// `tab` inside a Ghostty tell block means Ghostty's tab class, so the separator is set outside it.
// Each line: terminal id, terminal name, name of the tab holding it (the title Chris sees).
const LIST: Record<Route, string> = {
	as: `
set sep to character id 9
tell application "Ghostty"
	set out to ""
	repeat with w in windows
		repeat with tb in tabs of w
			repeat with t in terminals of tb
				set out to out & (id of t) & sep & (name of t) & sep & (name of tb) & linefeed
			end repeat
		end repeat
	end repeat
	return out
end tell`,
	jxa: `const g = Application("Ghostty"); const out = [];
for (const w of g.windows()) for (const tb of w.tabs()) for (const t of tb.terminals()) out.push([t.id(), t.name(), tb.name()].join("\\t"));
out.join("\\n")`,
};

type Term = { route: Route; id: string; name: string; tab: string };

/** Every terminal reachable by either route; a route that fails (Ghostty not running) adds nothing. */
async function terminals(): Promise<Term[]> {
	const out: Term[] = [];
	for (const route of ["as", "jxa"] as Route[]) {
		let text = "";
		try {
			text = await sh(route, LIST[route]);
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			const [id, name, tab] = line.split("\t");
			if (id && name !== undefined) out.push({ route, id, name, tab: tab ?? name });
		}
	}
	return out;
}

async function focusTerminal(route: Route, id: string, ghosttyPid: number | null): Promise<void> {
	const safe = id.replace(/[^A-Za-z0-9-]/g, "");
	await sh(route, route === "as" ? `tell application "Ghostty" to focus terminal id "${safe}"` : `const g = Application("Ghostty"); g.focus(g.terminals.byId("${safe}"))`);
	// Raise the Ghostty process that owns the session; `activate` by name could raise the other one.
	if (ghosttyPid) {
		await run(["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${ghosttyPid}) to true`]).catch(() => undefined);
	} else {
		await sh(route, route === "as" ? `tell application "Ghostty" to activate` : `Application("Ghostty").activate()`).catch(() => undefined);
	}
}

/** The Ghostty process above a pid (the session's claude), or null. */
function ghosttyAbove(pid: number): Promise<number | null> {
	return new Promise((resolve) =>
		execFile("/bin/ps", ["-A", "-o", "pid=,ppid=,comm="], { timeout: 2000 }, (err, stdout) => {
			if (err) return resolve(null);
			const procs = new Map<number, [number, string]>();
			for (const line of stdout.split("\n")) {
				const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
				if (m) procs.set(Number(m[1]), [Number(m[2]), m[3]]);
			}
			let p = pid;
			for (let i = 0; i < 12 && procs.has(p); i++) {
				const [ppid, comm] = procs.get(p)!;
				if (path.basename(comm) === "ghostty") return resolve(p);
				p = ppid;
			}
			resolve(null);
		}),
	);
}

const MARKER = "cx-deck-";
/** After a failed match, don't retitle that tty again on its own for this long (a press still tries). */
const RETRY_MS = 5 * 60 * 1000;

/** The title to put back: the tab's own title minus Ghostty's bell, never a leftover marker. */
export function restoreTitle(tab: string | undefined, fallback: string): string {
	const t = (tab ?? "").replace(/^🔔\s*/u, "").trim();
	return t && !t.includes(MARKER) ? t : fallback;
}

function setTitle(tty: string, title: string): void {
	fs.writeFileSync(tty, `\x1b]2;${title.replace(/[\x00-\x1f\x7f]/g, "")}\x07`);
}

/** Claude's tab titles start with a spinner or star glyph; drop it for display. */
export function cleanTitle(name: string): string {
	return name.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/** Emits "change" when the set of live sessions, their states or what has been seen changes. */
type Learned = { route: Route; id: string; title: string; ghostty: number | null };

export class ClaudeTermWatcher extends EventEmitter {
	sessions: TermSession[] = [];
	/** tty → the Ghostty terminal showing it, the route that reached it, and its title when learned. */
	readonly terminalsByTty = new Map<string, Learned>();
	/** session:since pairs you have already looked at while done. */
	readonly seen = new Set<string>();

	private readonly dir: string;
	#watcher: fs.FSWatcher | null = null;
	#poll: NodeJS.Timeout | null = null;
	#seenPoll: NodeJS.Timeout | null = null;
	#learning = new Set<string>();
	/** tty → when a match last failed, so a tab that can't be found isn't retitled every poll. */
	#failedAt = new Map<string, number>();

	constructor(dir = STATE_DIR) {
		super();
		this.dir = dir;
	}

	start(): void {
		fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		this.refresh();
		try {
			this.#watcher = fs.watch(this.dir, () => this.refresh());
		} catch {
			this.#watcher = null;
		}
		this.#poll = setInterval(() => this.refresh(), POLL_MS);
	}

	stop(): void {
		if (this.#poll) clearInterval(this.#poll);
		if (this.#seenPoll) clearInterval(this.#seenPoll);
		this.#watcher?.close();
	}

	/** Waiting = needs-you, or done and not yet looked at. */
	waiting(): TermSession[] {
		return this.sessions.filter((s) => s.state === "needs-you" || (s.state === "done" && !this.seen.has(`${s.session_id}:${s.since}`)));
	}

	title(s: TermSession): string {
		const learned = this.terminalsByTty.get(s.tty)?.title;
		return (learned && cleanTitle(learned)) || this.#fallbackTitle(s);
	}

	#fallbackTitle(s: TermSession): string {
		return `Claude · ${path.basename(s.cwd)}`;
	}

	refresh(): void {
		const next = readSessions(this.dir);
		if (JSON.stringify(next) !== JSON.stringify(this.sessions)) {
			this.sessions = next;
			this.emit("change");
		}
		const now = Date.now();
		for (const s of this.waiting()) {
			if (this.terminalsByTty.has(s.tty) || now - (this.#failedAt.get(s.tty) ?? 0) < RETRY_MS) continue;
			void this.#learn(s);
		}
		this.#armSeenPoll();
	}

	/** Bring the session's Ghostty tab forward. */
	async focus(sessionId: string): Promise<boolean> {
		const s = this.sessions.find((x) => x.session_id === sessionId);
		if (!s) return false;
		let term = this.terminalsByTty.get(s.tty) ?? (await this.#learn(s));
		if (!term) return false;
		try {
			await focusTerminal(term.route, term.id, term.ghostty);
		} catch {
			// Stale id (the tab closed and the tty was reused): learn again once.
			this.terminalsByTty.delete(s.tty);
			term = await this.#learn(s);
			if (!term) return false;
			await focusTerminal(term.route, term.id, term.ghostty);
		}
		this.markSeen(s);
		return true;
	}

	markSeen(s: TermSession): void {
		if (s.state !== "done") return;
		const key = `${s.session_id}:${s.since}`;
		if (this.seen.has(key)) return;
		this.seen.add(key);
		this.emit("change");
	}

	/** The marker trick: retitle the tty, see which Ghostty terminal shows it, restore. */
	async #learn(s: TermSession): Promise<Learned | undefined> {
		const tty = s.tty;
		if (this.#learning.has(tty)) return undefined;
		this.#learning.add(tty);
		try {
			const before = await terminals();
			const marker = `${MARKER}${randomUUID().slice(0, 8)}`;
			setTitle(tty, marker);
			let hit: Term | undefined;
			for (let i = 0; i < 10 && !hit; i++) {
				await new Promise((r) => setTimeout(r, 100));
				hit = (await terminals()).find((t) => t.name.includes(marker));
			}
			// Always put a title back, even when no terminal matched, so a marker never sticks.
			const prior = hit && before.find((t) => t.route === hit!.route && t.id === hit!.id);
			const title = restoreTitle(prior?.tab, this.#fallbackTitle(s));
			setTitle(tty, title);
			if (!hit) {
				this.#failedAt.set(tty, Date.now());
				return undefined;
			}
			this.#failedAt.delete(tty);
			const term = { route: hit.route, id: hit.id, title, ghostty: await ghosttyAbove(s.pid) };
			this.terminalsByTty.set(tty, term);
			this.emit("change");
			return term;
		} catch {
			this.#failedAt.set(tty, Date.now());
			return undefined;
		} finally {
			this.#learning.delete(tty);
		}
	}

	/** While a done session is unseen, notice when its tab is the one in front. */
	#armSeenPoll(): void {
		const pending = this.sessions.some((s) => s.state === "done" && !this.seen.has(`${s.session_id}:${s.since}`));
		if (pending && !this.#seenPoll) {
			this.#seenPoll = setInterval(() => void this.#checkFront(), SEEN_POLL_MS);
		} else if (!pending && this.#seenPoll) {
			clearInterval(this.#seenPoll);
			this.#seenPoll = null;
		}
	}

	async #checkFront(): Promise<void> {
		let frontPid: number;
		try {
			frontPid = Number(await run(["-e", `tell application "System Events" to return unix id of first process whose frontmost is true`]));
		} catch {
			return;
		}
		const front = new Map<Route, string>();
		for (const s of this.sessions) {
			const term = this.terminalsByTty.get(s.tty);
			if (s.state !== "done" || !term || term.ghostty !== frontPid) continue;
			if (!front.has(term.route)) {
				const q =
					term.route === "as"
						? `tell application "Ghostty" to return id of focused terminal of selected tab of front window`
						: `const g = Application("Ghostty"); g.windows[0].selectedTab().focusedTerminal().id()`;
				front.set(term.route, await sh(term.route, q).catch(() => ""));
			}
			if (front.get(term.route) === term.id) this.markSeen(s);
		}
		this.#armSeenPoll();
	}
}
