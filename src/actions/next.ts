import { action, type KeyAction, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { countImage } from "../render";

/** Shows how many sessions are waiting; press focuses the one that has waited longest (blocked first). */
@action({ UUID: "com.cx.herdr.next" })
export class NextWaiting extends SingletonAction<JsonObject> {
	#instances = new Map<string, { action: KeyAction<JsonObject>; image?: string }>();

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

	override async onKeyDown(ev: KeyDownEvent<JsonObject>): Promise<void> {
		const first = hub.online ? hub.waiting[0] : undefined;
		if (!first || !(await hub.focus(first.key))) await ev.action.showAlert();
	}

	async #renderAll(): Promise<void> {
		const image = countImage(hub.waiting, hub.online);
		await Promise.all(
			[...this.#instances.values()].map(async (inst) => {
				if (inst.image === image) return;
				inst.image = image;
				await inst.action.setImage(image);
			}),
		);
	}
}
