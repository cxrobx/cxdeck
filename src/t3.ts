/**
 * T3 Code threads, read straight from T3's own database at
 * ~/.t3/userdata/statev2.sqlite (read-only; T3 keeps it in WAL mode, so reading
 * never blocks it). The query takes a couple of milliseconds, so a short poll is
 * all the watching this needs. A press opens the thread with T3's deep link
 * t3code://threads/<environmentId>/<threadId>, which also marks it seen.
 */
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { T3Thread } from "./waiting";

export const T3_DIR = process.env.T3_USERDATA ?? path.join(os.homedir(), ".t3/userdata");

const POLL_MS = 2500;
/** Threads untouched for longer than this are ignored, so long-forgotten unread ones don't pile up. */
const WINDOW_MS = 7 * 24 * 3600 * 1000;

const QUERY = `
select t.thread_id, t.title,
  p.title as project,
  json_extract(t.payload_json, '$.lastVisitedAt') as last_visited,
  json_extract(t.payload_json, '$.settledAt') as settled_at,
  json_extract(t.payload_json, '$.snoozedUntil') as snoozed_until,
  json_extract(t.payload_json, '$.lineage.relationshipToParent') as relation,
  r.status as run_status, r.completed_at,
  (select min(q.created_at) from orchestration_v2_projection_runtime_requests q
     where q.thread_id = t.thread_id and q.status = 'pending') as pending_since
from orchestration_v2_projection_threads t
left join projection_projects p on p.project_id = t.project_id
left join orchestration_v2_projection_runs r on r.run_id = (
  select r2.run_id from orchestration_v2_projection_runs r2
  where r2.thread_id = t.thread_id order by r2.ordinal desc limit 1)
where t.archived_at is null and t.deleted_at is null and t.updated_at > ?`;

/** Every recent, live thread in the database, or none when it is missing or unreadable. */
export function readThreads(db: DatabaseSync, now = Date.now()): T3Thread[] {
	return db.prepare(QUERY).all(new Date(now - WINDOW_MS).toISOString()) as unknown as T3Thread[];
}

export function openDb(dir = T3_DIR): DatabaseSync | null {
	const file = path.join(dir, "statev2.sqlite");
	if (!fs.existsSync(file)) return null;
	try {
		return new DatabaseSync(file, { readOnly: true });
	} catch {
		return null;
	}
}

/** Emits "change" whenever the thread list changes. */
export class T3Watcher extends EventEmitter {
	threads: T3Thread[] = [];

	private readonly dir: string;
	#db: DatabaseSync | null = null;
	#poll: NodeJS.Timeout | null = null;

	constructor(dir = T3_DIR) {
		super();
		this.dir = dir;
	}

	start(): void {
		this.refresh();
		this.#poll = setInterval(() => this.refresh(), POLL_MS);
	}

	stop(): void {
		if (this.#poll) clearInterval(this.#poll);
		this.#db?.close();
		this.#db = null;
	}

	refresh(): void {
		let next: T3Thread[] = [];
		try {
			this.#db ??= openDb(this.dir);
			if (this.#db) next = readThreads(this.#db);
		} catch (e) {
			// A schema change in a T3 update, or the file replaced: reopen next time.
			this.emit("log", `T3 read failed: ${(e as Error).message}`);
			this.#db?.close();
			this.#db = null;
		}
		if (JSON.stringify(next) === JSON.stringify(this.threads)) return;
		this.threads = next;
		this.emit("change", next);
	}

	/** T3's id for this machine's environment, which its thread links need. */
	environmentId(): string | null {
		try {
			return fs.readFileSync(path.join(this.dir, "environment-id"), "utf8").trim() || null;
		} catch {
			return null;
		}
	}
}

export function threadLink(environmentId: string, threadId: string): string {
	// ":" stays literal (ids like "mcp:<uuid>"): it is a plain path character, and the form T3 was checked with.
	const seg = (v: string) => encodeURIComponent(v).replace(/%3A/gi, ":");
	return `t3code://threads/${seg(environmentId)}/${seg(threadId)}`;
}

/** Opens the thread in T3 Code; with no environment id, just brings T3 Code forward. */
export function openT3Thread(environmentId: string | null, threadId: string): Promise<boolean> {
	const args = environmentId ? [threadLink(environmentId, threadId)] : ["-b", "com.t3tools.t3code"];
	return new Promise((resolve) => {
		execFile("/usr/bin/open", args, { timeout: 4000 }, (err) => resolve(!err));
	});
}
