import { action, type KeyAction, SingletonAction, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { onYouImage } from "../render";

/** Held at least this long, a press dismisses instead of focusing. */
const HOLD_MS = 600;

/** Sessions read but not answered that still leave Chris a next step. Press focuses the oldest; hold dismisses it. */
@action({ UUID: "com.cx.herdr.onyou" })
export class OnYouKey extends SingletonAction<JsonObject> {
	#instances = new Map<string, { action: KeyAction<JsonObject>; image?: string }>();
	#down = new Map<string, number>();

	constructor() {
		super();
		hub.subscribe(() => void this.#renderAll());
	}

	override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
		if (!ev.action.isKey()) return;
		this.#instances.set(ev.action.id, { action: ev.action });
		void this.#renderAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
		this.#instances.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
		this.#down.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<JsonObject>): Promise<void> {
		const held = Date.now() - (this.#down.get(ev.action.id) ?? Date.now());
		this.#down.delete(ev.action.id);
		const first = hub.onYou.items[0];
		if (!first) return void (await ev.action.showAlert());
		if (held >= HOLD_MS) {
			hub.onYou.dismiss(first.turn);
			await ev.action.showOk();
			return;
		}
		if (!(await hub.focus(first.key))) await ev.action.showAlert();
	}

	async #renderAll(): Promise<void> {
		const items = hub.onYou.items;
		const image = onYouImage(items[0], items.length);
		await Promise.all(
			[...this.#instances.values()].map(async (inst) => {
				if (inst.image === image) return;
				inst.image = image;
				await inst.action.setImage(image);
			}),
		);
	}
}
