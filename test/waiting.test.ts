import { test } from "node:test";
import assert from "node:assert/strict";

import { repoName, selectWaiting, wrap, type HerdrAgent } from "../src/waiting.ts";

const a = (pane_id: string, agent_status: HerdrAgent["agent_status"], seq: number, title = pane_id): HerdrAgent => ({
	pane_id, agent_status, state_change_seq: seq, terminal_title_stripped: title, cwd: `/Users/x/Projects/${pane_id}`, agent: "claude",
});

test("blocked before done, oldest first within each group; idle/working/unknown excluded", () => {
	const got = selectWaiting([a("d2", "done", 9), a("b2", "blocked", 8), a("w", "working", 1), a("d1", "done", 3), a("i", "idle", 2), a("b1", "blocked", 5), a("u", "unknown", 0)], true);
	assert.deepEqual(got.map((s) => s.paneId), ["b1", "b2", "d1", "d2"]);
});

test("countDone=false drops done", () => {
	assert.deepEqual(selectWaiting([a("d", "done", 1), a("b", "blocked", 2)], false).map((s) => s.paneId), ["b"]);
});

test("title falls back to agent kind when blank; repo is cwd basename", () => {
	const [s] = selectWaiting([{ ...a("p", "blocked", 1), terminal_title_stripped: "  " }], true);
	assert.equal(s.title, "claude");
	assert.equal(s.repo, "p");
	assert.equal(repoName("/a/b/"), "b");
	assert.equal(repoName(undefined), "");
});

test("wrap respects width and line cap with ellipsis", () => {
	assert.deepEqual(wrap("Prod Postgres config tuning and temp spill", 12, 3), ["Prod", "Postgres", "config…"]);
	assert.deepEqual(wrap("short one", 12, 3), ["short one"]);
	assert.deepEqual(wrap("Supercalifragilistic", 8, 2), ["Superca…"]);
	for (const l of wrap("CX Ventures click-to-call copilot session", 12, 3)) assert.ok(l.length <= 12, l);
});
