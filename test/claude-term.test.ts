import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cleanTitle, readSessions, restoreTitle } from "../src/claude-term.ts";
import { claudeTermWaiting, orderWaiting } from "../src/waiting.ts";

test("state files: live pid kept, dead pid, junk and non-json ignored", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdct-"));
	const write = (name: string, body: unknown) => fs.writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
	write("a.json", { session_id: "a", state: "done", since: "2026-10-24T10:00:00Z", cwd: "/x/teacher-helper", tty: "/dev/ttys001", pid: process.pid });
	write("b.json", { session_id: "b", state: "done", since: "2026-10-24T10:00:00Z", cwd: "/x/y", tty: "/dev/ttys002", pid: 999999 });
	write("c.json", "{half");
	write("d.tmp", "{}");
	assert.deepEqual(readSessions(dir).map((s) => s.session_id), ["a"]);
	assert.deepEqual(readSessions(path.join(dir, "missing")), []);
});

test("titles lose Claude's spinner glyph", () => {
	assert.equal(cleanTitle("✳ Prompt improvement history critique"), "Prompt improvement history critique");
	assert.equal(cleanTitle("◐ Working on it"), "Working on it");
	assert.equal(cleanTitle("Plain title"), "Plain title");
});

test("terminal sessions merge: needs-you as blocked, done respects countDone, repo from cwd", () => {
	const s = [
		{ session_id: "t1", state: "done" as const, since: "2026-10-24T09:00:00Z", title: "Old done", cwd: "/p/teacher-helper" },
		{ session_id: "t2", state: "needs-you" as const, since: "2026-10-24T11:00:00Z", title: "Asks", cwd: "/p/cxventures" },
	];
	const items = orderWaiting(claudeTermWaiting(s, true));
	assert.deepEqual(items.map((i) => [i.key, i.status, i.repo]), [["claude:t2", "blocked", "cxventures"], ["claude:t1", "done", "teacher-helper"]]);
	assert.deepEqual(claudeTermWaiting(s, false).map((i) => i.key), ["claude:t2"]);
});

test("restored title: tab title without the bell, never a leftover marker", () => {
	assert.equal(restoreTitle("🔔 ✳ SEO enhancement discussion", "Claude · x"), "✳ SEO enhancement discussion");
	assert.equal(restoreTitle("cx-deck-3f37ca28", "Claude · x"), "Claude · x");
	assert.equal(restoreTitle(undefined, "Claude · x"), "Claude · x");
});
