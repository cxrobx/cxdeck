import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openDb, readThreads, threadLink, T3Watcher } from "../src/t3.ts";
import { orderWaiting, quickAskWaiting, t3StillOnYou, t3Waiting, type T3Thread } from "../src/waiting.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const th = (id: string, over: Partial<T3Thread> = {}): T3Thread => ({
	thread_id: id,
	title: `thread ${id}`,
	project: "Home",
	last_visited: "2026-11-06T10:00:00Z",
	settled_at: null,
	snoozed_until: null,
	relation: null,
	run_status: "completed",
	completed_at: "2026-11-06T11:00:00Z",
	pending_since: null,
	...over,
});

test("pending request is blocked; a run finished after the last visit is done", () => {
	const items = t3Waiting([th("a"), th("b", { pending_since: "2026-11-06T11:30:00Z", run_status: "running", completed_at: null })], true, NOW);
	assert.deepEqual(items.map((i) => [i.key, i.status, i.repo, i.since]), [
		["t3:a", "done", "T3 · Home", Date.parse("2026-11-06T11:00:00Z")],
		["t3:b", "blocked", "T3 · Home", Date.parse("2026-11-06T11:30:00Z")],
	]);
});

test("seen, settled, snoozed, subagent, still working or interrupted never show as done", () => {
	const quiet = [
		th("seen", { last_visited: "2026-11-06T11:00:00Z" }),
		th("settled", { settled_at: "2026-11-06T11:05:00Z" }),
		th("snoozed", { snoozed_until: "2026-11-07T00:00:00Z" }),
		th("sub", { relation: "subagent" }),
		th("running", { run_status: "running", completed_at: null }),
		th("interrupted", { run_status: "interrupted" }),
		th("cancelled", { run_status: "cancelled" }),
	];
	assert.deepEqual(t3Waiting(quiet, true, NOW), []);
	// Never visited counts as unseen; a failed run needs a look too; a snooze that ran out shows again.
	const loud = [th("new", { last_visited: null }), th("failed", { run_status: "failed" }), th("woke", { snoozed_until: "2026-11-06T11:59:00Z" })];
	assert.deepEqual(t3Waiting(loud, true, NOW).map((i) => i.id), ["new", "failed", "woke"]);
	// Settled before the latest run finished: that run is still unseen.
	assert.equal(t3Waiting([th("resettled", { settled_at: "2026-11-06T10:30:00Z" })], true, NOW).length, 1);
});

test("countDone off keeps only blocked; blocked stays even after a visit", () => {
	const items = t3Waiting([th("a"), th("b", { pending_since: "2026-11-06T11:30:00Z", last_visited: "2026-11-06T11:59:00Z" })], false, NOW);
	assert.deepEqual(items.map((i) => i.key), ["t3:b"]);
});

test("merges with the other sources by the usual order", () => {
	const merged = orderWaiting([
		...t3Waiting([th("t-done"), th("t-blocked", { pending_since: "2026-11-06T09:00:00Z" })], true, NOW),
		...quickAskWaiting([{ id: "q", title: "q", state: "answered", since: "2026-11-06T10:30:00Z" }], true),
	]);
	assert.deepEqual(merged.map((i) => i.key), ["t3:t-blocked", "quickask:q", "t3:t-done"]);
});

test("on you: seen and unsettled; never unseen, settled, running, blocked, snoozed or subagent", () => {
	const seen = { last_visited: "2026-11-06T11:30:00Z" };
	const items = t3StillOnYou([
		th("open", seen),
		th("failed", { ...seen, run_status: "failed" }),
		th("resettled", { ...seen, settled_at: "2026-11-06T10:30:00Z" }),
		th("unseen"),
		th("settled", { ...seen, settled_at: "2026-11-06T11:00:00Z" }),
		th("running", { ...seen, run_status: "running", completed_at: null }),
		th("blocked", { ...seen, pending_since: "2026-11-06T11:40:00Z" }),
		th("snoozed", { ...seen, snoozed_until: "2026-11-07T00:00:00Z" }),
		th("sub", { ...seen, relation: "subagent" }),
		th("interrupted", { ...seen, run_status: "interrupted" }),
	], NOW);
	assert.deepEqual(items.map((i) => i.id), ["t3:open", "t3:failed", "t3:resettled"]);
	assert.deepEqual(items[0], { key: "t3:open", id: "t3:open", title: "thread open", repo: "T3 · Home", since: "2026-11-06T11:00:00Z" });
	// An unseen thread is on the waiting list, a seen one on "On you": never both.
	const all = [th("a"), th("b", seen)];
	const waiting = new Set(t3Waiting(all, true, NOW).map((i) => i.key));
	assert.ok(t3StillOnYou(all, NOW).every((i) => !waiting.has(i.key)));
});

test("thread link: environment and thread id, ':' kept literal", () => {
	assert.equal(threadLink("env-1", "abc-123"), "t3code://threads/env-1/abc-123");
	assert.equal(threadLink("env-1", "mcp:abc"), "t3code://threads/env-1/mcp:abc");
	assert.equal(threadLink("env-1", "a/b"), "t3code://threads/env-1/a%2Fb");
});

/** The slice of T3's schema the query touches, with T3's own column names. */
function fakeT3(dir: string): DatabaseSync {
	const db = new DatabaseSync(path.join(dir, "statev2.sqlite"));
	db.exec(`
		create table orchestration_v2_projection_threads (thread_id text primary key, project_id text not null, title text not null,
			updated_at text not null, archived_at text, deleted_at text, payload_json text not null);
		create table orchestration_v2_projection_runs (run_id text primary key, thread_id text not null, ordinal integer not null,
			status text not null, completed_at text);
		create table orchestration_v2_projection_runtime_requests (runtime_request_id text primary key, thread_id text not null,
			status text not null, created_at text not null);
		create table projection_projects (project_id text primary key, title text not null);
		insert into projection_projects values ('p1', 'Placeholder Project');
	`);
	return db;
}

test("database: latest run per thread, oldest pending request, archived and stale threads left out", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdt3-"));
	const db = fakeT3(dir);
	const thread = db.prepare("insert into orchestration_v2_projection_threads values (?, 'p1', ?, ?, ?, null, ?)");
	const payload = (lastVisitedAt: string) => JSON.stringify({ lastVisitedAt, settledAt: null, snoozedUntil: null, lineage: { relationshipToParent: null } });
	thread.run("a", "Alpha", "2026-11-06T11:00:00Z", null, payload("2026-11-06T10:00:00Z"));
	thread.run("b", "Bravo", "2026-11-06T11:00:00Z", null, payload("2026-11-06T10:00:00Z"));
	thread.run("archived", "Old", "2026-11-06T11:00:00Z", "2026-11-06T11:10:00Z", payload("2026-11-06T10:00:00Z"));
	thread.run("stale", "Stale", "2026-10-01T11:00:00Z", null, payload("2026-09-01T10:00:00Z"));
	const run = db.prepare("insert into orchestration_v2_projection_runs values (?, ?, ?, ?, ?)");
	run.run("a1", "a", 1, "failed", "2026-11-06T09:00:00Z");
	run.run("a2", "a", 2, "completed", "2026-11-06T11:00:00Z");
	run.run("b1", "b", 1, "running", null);
	const req = db.prepare("insert into orchestration_v2_projection_runtime_requests values (?, ?, ?, ?)");
	req.run("r1", "b", "pending", "2026-11-06T11:20:00Z");
	req.run("r2", "b", "pending", "2026-11-06T11:10:00Z");
	req.run("r3", "a", "resolved", "2026-11-06T08:00:00Z");

	const rows = readThreads(openDb(dir)!, NOW);
	assert.deepEqual(
		rows.map((r) => [r.thread_id, r.project, r.run_status, r.completed_at, r.pending_since, r.last_visited]).sort(),
		[
			["a", "Placeholder Project", "completed", "2026-11-06T11:00:00Z", null, "2026-11-06T10:00:00Z"],
			["b", "Placeholder Project", "running", null, "2026-11-06T11:10:00Z", "2026-11-06T10:00:00Z"],
		],
	);
	assert.deepEqual(t3Waiting(rows, true, NOW).map((i) => [i.id, i.status]).sort(), [["a", "done"], ["b", "blocked"]]);
});

test("watcher: no database means no threads, and the environment id is read from its file", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdt3-"));
	const w = new T3Watcher(dir);
	w.refresh();
	assert.deepEqual(w.threads, []);
	assert.equal(w.environmentId(), null);
	fs.writeFileSync(path.join(dir, "environment-id"), "env-placeholder\n");
	assert.equal(w.environmentId(), "env-placeholder");
});
