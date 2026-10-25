/**
 * Pure selection logic: which sessions need Chris, in what order. Sessions come
 * from Herdr (agent panes), QuickAsk (popup chats) and Claude Code in plain
 * Ghostty tabs (state files written by a hook). No I/O here so it can be
 * unit-tested without either app or the Stream Deck.
 */

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** The subset of `agent.list` fields the plugin uses. */
export type HerdrAgent = {
	pane_id: string;
	tab_id?: string;
	workspace_id?: string;
	agent?: string;
	agent_status: AgentStatus;
	terminal_title_stripped?: string;
	cwd?: string;
	focused?: boolean;
	state_change_seq?: number;
};

/** One chat from QuickAsk's status.json. */
export type QuickAskChat = {
	id: string;
	title: string;
	state: "working" | "needs-you" | "answered";
	since: string;
};

export type Source = "herdr" | "quickask" | "claude";

export type WaitingSession = {
	/** Unique across sources: "herdr:w1:p1", "quickask:<uuid>". */
	key: string;
	source: Source;
	/** Herdr pane id or QuickAsk chat id. */
	id: string;
	status: "blocked" | "done";
	title: string;
	/** Repo for Herdr, "QuickAsk" for QuickAsk. */
	repo: string;
	/** When it started waiting (ms); orders sessions across sources. */
	since: number;
	/** Herdr's sequence number, to break ties among sessions first seen together. */
	seq: number;
};

/** Herdr agents that are blocked, or done when `countDone`. `since` comes from `firstSeen`. */
export function herdrWaiting(agents: HerdrAgent[], countDone: boolean, firstSeen: (key: string) => number): WaitingSession[] {
	return agents
		.filter((a) => a.agent_status === "blocked" || (countDone && a.agent_status === "done"))
		.map((a) => {
			const status = a.agent_status as "blocked" | "done";
			const key = `herdr:${a.pane_id}`;
			return {
				key,
				source: "herdr" as const,
				id: a.pane_id,
				status,
				title: a.terminal_title_stripped?.trim() || a.agent || a.pane_id,
				repo: repoName(a.cwd),
				since: firstSeen(`${key}:${status}`),
				seq: a.state_change_seq ?? 0,
			};
		});
}

/** QuickAsk chats that need you (as blocked) or were answered unseen (as done, when `countDone`). */
export function quickAskWaiting(chats: QuickAskChat[], countDone: boolean): WaitingSession[] {
	return chats
		.filter((c) => c.state === "needs-you" || (countDone && c.state === "answered"))
		.map((c) => ({
			key: `quickask:${c.id}`,
			source: "quickask" as const,
			id: c.id,
			status: c.state === "needs-you" ? ("blocked" as const) : ("done" as const),
			title: c.title.trim() || "QuickAsk chat",
			repo: "QuickAsk",
			since: Date.parse(c.since) || 0,
			seq: 0,
		}));
}

/** A plain-terminal Claude session, already filtered to the ones waiting (see ClaudeTermWatcher). */
export type TermWaiting = { session_id: string; state: "needs-you" | "done"; since: string; title: string; cwd: string };

/** Plain-terminal Claude sessions: needs-you as blocked, done as done (when `countDone`). */
export function claudeTermWaiting(sessions: TermWaiting[], countDone: boolean): WaitingSession[] {
	return sessions
		.filter((s) => s.state === "needs-you" || countDone)
		.map((s) => ({
			key: `claude:${s.session_id}`,
			source: "claude" as const,
			id: s.session_id,
			status: s.state === "needs-you" ? ("blocked" as const) : ("done" as const),
			title: s.title,
			repo: repoName(s.cwd),
			since: Date.parse(s.since) || 0,
			seq: 0,
		}));
}

/** Blocked before done; within each, the one waiting longest first. */
export function orderWaiting(items: WaitingSession[]): WaitingSession[] {
	const rank = (s: WaitingSession) => (s.status === "blocked" ? 0 : 1);
	return [...items].sort((a, b) => rank(a) - rank(b) || a.since - b.since || a.seq - b.seq);
}

/** Herdr-only convenience: everything first seen at once, so Herdr's own order decides. */
export function selectWaiting(agents: HerdrAgent[], countDone: boolean): WaitingSession[] {
	return orderWaiting(herdrWaiting(agents, countDone, () => 0));
}

export function repoName(cwd: string | undefined): string {
	if (!cwd) return "";
	const parts = cwd.replace(/\/+$/, "").split("/");
	return parts[parts.length - 1] || cwd;
}

/** Greedy word wrap into at most `maxLines` lines of `width` chars; overflow ends in "…". */
export function wrap(text: string, width: number, maxLines: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const w = word.length > width ? word.slice(0, width - 1) + "…" : word;
		const cur = lines[lines.length - 1];
		if (cur !== undefined && cur.length + 1 + w.length <= width) lines[lines.length - 1] = `${cur} ${w}`;
		else lines.push(w);
	}
	if (lines.length <= maxLines) return lines;
	const kept = lines.slice(0, maxLines);
	const last = kept[maxLines - 1];
	kept[maxLines - 1] = (last.length >= width ? last.slice(0, width - 1) : last) + "…";
	return kept;
}
