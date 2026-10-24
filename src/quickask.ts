/**
 * QuickAsk chats, from the status file QuickAsk keeps at
 * ~/Library/Application Support/QuickAsk/status.json (see StatusFeed.swift in
 * ~/Projects/quickask). QuickAsk replaces the file atomically, so we watch the
 * folder rather than the file, with a slow poll behind it. A file whose pid is
 * no longer running is a leftover from a quit QuickAsk and counts as no chats.
 */
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { QuickAskChat } from "./waiting";

export const STATUS_PATH = process.env.QUICKASK_STATUS ?? path.join(os.homedir(), "Library/Application Support/QuickAsk/status.json");

const POLL_MS = 5000;

type Payload = { version?: number; pid?: number; chats?: QuickAskChat[] };

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** The live chats in the file, or none when it is missing, unreadable or left by a dead process. */
export function readStatus(file = STATUS_PATH): QuickAskChat[] {
	let payload: Payload;
	try {
		payload = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return [];
	}
	if (!payload.pid || !alive(payload.pid) || !Array.isArray(payload.chats)) return [];
	return payload.chats.filter((c) => c && typeof c.id === "string" && typeof c.state === "string");
}

/** Emits "change" with the chat list whenever it changes. */
export class QuickAskWatcher extends EventEmitter {
	chats: QuickAskChat[] = [];

	private readonly file: string;
	#watcher: fs.FSWatcher | null = null;
	#poll: NodeJS.Timeout | null = null;

	constructor(file = STATUS_PATH) {
		super();
		this.file = file;
	}

	start(): void {
		this.refresh();
		this.#watch();
		// The poll also catches QuickAsk quitting (the file stays, the pid dies) and re-arms the watch.
		this.#poll = setInterval(() => {
			this.refresh();
			if (!this.#watcher) this.#watch();
		}, POLL_MS);
	}

	stop(): void {
		if (this.#poll) clearInterval(this.#poll);
		this.#watcher?.close();
		this.#watcher = null;
	}

	refresh(): void {
		const next = readStatus(this.file);
		if (JSON.stringify(next) === JSON.stringify(this.chats)) return;
		this.chats = next;
		this.emit("change", next);
	}

	#watch(): void {
		const dir = path.dirname(this.file);
		const name = path.basename(this.file);
		try {
			this.#watcher = fs.watch(dir, (_event, filename) => {
				if (!filename || filename.toString() === name) this.refresh();
			});
			this.#watcher.on("error", () => {
				this.#watcher?.close();
				this.#watcher = null;
			});
		} catch {
			this.#watcher = null; // folder missing: QuickAsk never ran; the poll retries
		}
	}
}

/** Opens that chat in QuickAsk (quickask://chat/<id>). */
export function openQuickAskChat(id: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile("/usr/bin/open", [`quickask://chat/${encodeURIComponent(id)}`], { timeout: 4000 }, (err) => resolve(!err));
	});
}
