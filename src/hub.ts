/**
 * The one shared state every action renders from: the Herdr watcher, the
 * plugin's global settings, and the focus routine (Herdr pane + Ghostty tab).
 */
import streamDeck from "@elgato/streamdeck";

import { raiseHerdrWindow } from "./ghostty";
import { HerdrWatcher } from "./herdr";
import { selectWaiting, type WaitingSession } from "./waiting";

export type GlobalSettings = {
	/** Count "done" (finished a turn, unseen) as waiting. Default true. */
	countDone?: boolean;
	/** Substring of the Ghostty tab title that holds the Herdr TUI. Default "Herdr". */
	windowMatch?: string;
};

type Listener = () => void;

class Hub {
	readonly watcher = new HerdrWatcher();
	settings: GlobalSettings = {};
	#listeners = new Set<Listener>();

	get online(): boolean {
		return this.watcher.state.online;
	}

	get waiting(): WaitingSession[] {
		return selectWaiting(this.watcher.state.agents, this.settings.countDone ?? true);
	}

	start(): void {
		this.watcher.on("change", () => this.#emit());
		this.watcher.on("log", (m: string) => streamDeck.logger.warn(m));
		this.watcher.start();
	}

	applySettings(s: GlobalSettings): void {
		this.settings = s ?? {};
		this.#emit();
	}

	subscribe(fn: Listener): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	/** Focus the pane in Herdr, then raise the Ghostty tab. Returns false if Herdr refused. */
	async focus(paneId: string): Promise<boolean> {
		try {
			await this.watcher.focus(paneId);
		} catch (e) {
			streamDeck.logger.error(`focus ${paneId} failed: ${(e as Error).message}`);
			return false;
		}
		const how = await raiseHerdrWindow(this.settings.windowMatch ?? "Herdr");
		streamDeck.logger.info(`focused ${paneId}; ghostty raised via ${how}`);
		return true;
	}

	#emit(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch (e) {
				streamDeck.logger.error(`render failed: ${(e as Error).message}`);
			}
		}
	}
}

export const hub = new Hub();
