import streamDeck, { action, type KeyAction, SingletonAction, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { onYouImage } from "../render";
import { keyClaims } from "../on-you-claims";
import { settle } from "../spread";

/** Held at least this long, a press dismisses instead of focusing. */
const HOLD_MS = 600;

type Instance = { action: KeyAction<JsonObject>; index: number; key?: string; image?: string };

/**
 * Sessions read but not answered that still leave Chris a next step. Press focuses the one
 * shown; hold dismisses it. With several of these keys, each shows a different session:
 * in reading order (row, then column) they take the oldest free one, and a key keeps its
 * session while it is still on you.
 */
@action({ UUID: "com.cx.herdr.onyou" })
export class OnYouKey extends SingletonAction<JsonObject> {
	#instances = new Map<string, Instance>();
	#down = new Map<string, number>();

	constructor() {
		super();
		hub.subscribe(() => void this.#renderAll().catch((e) => streamDeck.logger.error(`on-you key render failed: ${(e as Error).stack}`)));
	}

	override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
		if (!ev.action.isKey()) return;
		this.#instances.set(ev.action.id, { action: ev.action, index: 0 });
		void this.#renderAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
		this.#instances.delete(ev.action.id);
		void this.#renderAll();
	}

	override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
		this.#down.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<JsonObject>): Promise<void> {
		const held = Date.now() - (this.#down.get(ev.action.id) ?? Date.now());
		this.#down.delete(ev.action.id);
		const inst = this.#instances.get(ev.action.id);
		const item = inst?.key ? hub.onYou.items.find((i) => i.key === inst.key) : undefined;
		if (!item) return void (await ev.action.showAlert());
		if (held >= HOLD_MS) {
			hub.onYou.dismiss(item.turn);
			await ev.action.showOk();
			return;
		}
		const ok = await hub.focus(item.key);
		streamDeck.logger.info(`on-you key press: ${item.key} → ${ok ? "ok" : "failed"}`);
		if (!ok) await ev.action.showAlert();
	}

	async #renderAll(): Promise<void> {
		const items = hub.onYou.items;
		const keys = items.map((i) => i.key);
		const pos = (i: Instance) => i.action.coordinates ?? { row: 99, column: 99 };
		const ordered = [...this.#instances.values()].sort(
			(a, b) => a.action.device.id.localeCompare(b.action.device.id) || pos(a).row - pos(b).row || pos(a).column - pos(b).column,
		);
		const taken = new Map<string, Set<string>>();
		for (const inst of ordered) {
			const mine = taken.get(inst.action.device.id) ?? new Set<string>();
			taken.set(inst.action.device.id, mine);
			const at = settle(keys, inst.key, inst.index, mine);
			inst.index = Math.max(at, 0);
			inst.key = at >= 0 ? keys[at] : undefined;
			if (inst.key) mine.add(inst.key);
		}
		keyClaims.set(taken);
		await Promise.all(
			ordered.map(async (inst) => {
				const image = onYouImage(inst.key ? items[inst.index] : undefined, items.length);
				if (inst.image === image) return;
				inst.image = image;
				await inst.action.setImage(image);
			}),
		);
	}
}
