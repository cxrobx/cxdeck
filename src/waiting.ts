/**
 * Pure selection logic: which Herdr agents need Chris, in what order.
 * No I/O here so it can be unit-tested without Herdr or the Stream Deck.
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

export type WaitingSession = {
	paneId: string;
	status: "blocked" | "done";
	title: string;
	repo: string;
	agent: string;
};

/**
 * Blocked first, then done (when `countDone`); within each group the one that
 * has waited longest (lowest state_change_seq) comes first.
 */
export function selectWaiting(agents: HerdrAgent[], countDone: boolean): WaitingSession[] {
	const rank = (s: AgentStatus) => (s === "blocked" ? 0 : s === "done" && countDone ? 1 : -1);
	return agents
		.filter((a) => rank(a.agent_status) >= 0)
		.sort((a, b) => rank(a.agent_status) - rank(b.agent_status) || (a.state_change_seq ?? 0) - (b.state_change_seq ?? 0))
		.map((a) => ({
			paneId: a.pane_id,
			status: a.agent_status as "blocked" | "done",
			title: a.terminal_title_stripped?.trim() || a.agent || a.pane_id,
			repo: repoName(a.cwd),
			agent: a.agent ?? "agent",
		}));
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
