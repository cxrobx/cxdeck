import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readStatus, QuickAskWatcher } from "../src/quickask.ts";
import { herdrWaiting, orderWaiting, quickAskWaiting, type HerdrAgent, type QuickAskChat } from "../src/waiting.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdqa-"));
const chat = (id: string, state: QuickAskChat["state"], since: string): QuickAskChat => ({ id, title: `chat ${id}`, state, since });

test("needs-you is blocked, answered is done (dropped without countDone), working never shows", () => {
	const items = quickAskWaiting([chat("a", "answered", "2026-10-24T10:00:00Z"), chat("b", "needs-you", "2026-10-24T11:00:00Z"), chat("c", "working", "2026-10-24T09:00:00Z")], true);
	assert.deepEqual(items.map((i) => [i.key, i.status, i.repo]), [["quickask:a", "done", "QuickAsk"], ["quickask:b", "blocked", "QuickAsk"]]);
	assert.deepEqual(quickAskWaiting([chat("a", "answered", "2026-10-24T10:00:00Z")], false), []);
});

test("both sources merge: blocked first, then whoever has waited longest", () => {
	const agents: HerdrAgent[] = [
		{ pane_id: "w1:p1", agent_status: "done", state_change_seq: 5 },
		{ pane_id: "w1:p2", agent_status: "blocked", state_change_seq: 9 },
	];
	const seen: Record<string, number> = { "herdr:w1:p1:done": Date.parse("2026-10-24T10:30:00Z"), "herdr:w1:p2:blocked": Date.parse("2026-10-24T12:00:00Z") };
	const merged = orderWaiting([
		...herdrWaiting(agents, true, (k) => seen[k]),
		...quickAskWaiting([chat("q1", "needs-you", "2026-10-24T11:00:00Z"), chat("q2", "answered", "2026-10-24T10:00:00Z")], true),
	]);
	assert.deepEqual(merged.map((i) => i.key), ["quickask:q1", "herdr:w1:p2", "quickask:q2", "herdr:w1:p1"]);
});

test("status file: live pid → chats; dead pid, garbage or missing → none", () => {
	const file = path.join(tmp, "status.json");
	fs.writeFileSync(file, JSON.stringify({ version: 1, pid: process.pid, chats: [chat("a", "answered", "2026-10-24T10:00:00Z")] }));
	assert.equal(readStatus(file).length, 1);
	fs.writeFileSync(file, JSON.stringify({ version: 1, pid: 999999, chats: [chat("a", "answered", "2026-10-24T10:00:00Z")] }));
	assert.deepEqual(readStatus(file), []);
	fs.writeFileSync(file, "{not json");
	assert.deepEqual(readStatus(file), []);
	assert.deepEqual(readStatus(path.join(tmp, "missing.json")), []);
});

test("watcher picks up an atomic replace without waiting for the poll", async () => {
	const dir = fs.mkdtempSync(path.join(tmp, "w-"));
	const file = path.join(dir, "status.json");
	const w = new QuickAskWatcher(file);
	w.start();
	const changed = new Promise((r) => w.once("change", r));
	const temp = path.join(dir, ".status.tmp");
	fs.writeFileSync(temp, JSON.stringify({ pid: process.pid, chats: [chat("x", "needs-you", "2026-10-24T10:00:00Z")] }));
	fs.renameSync(temp, file);
	await Promise.race([changed, new Promise((_, rej) => setTimeout(() => rej(new Error("no change within 2s")), 2000))]);
	assert.equal(w.chats[0].id, "x");
	w.stop();
});
