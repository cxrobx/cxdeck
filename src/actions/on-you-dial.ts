import { action, type DialAction, SingletonAction, type DialDownEvent, type DialRotateEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { onYouStripImage } from "../render";

type Instance = { action: DialAction<JsonObject>; index: number; key?: string; image?: string };

/** Stream Deck +: rotate through "On you" sessions, press or tap to focus the shown one, long-touch to dismiss it. */
@action({ UUID: "com.cx.herdr.onyoudial" })
export class OnYouDial extends SingletonAction<JsonObject> {
	#instances = new Map<string, Instance>();

	constructor() {
		super();
		hub.subscribe(() => void this.#renderAll());
	}

	override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
		if (!ev.action.isDial()) return;
		this.#instances.set(ev.action.id, { action: ev.action, index: 0 });
		void this.#renderAll();
	}

	override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
		this.#instances.delete(ev.action.id);
	}

	override onDialRotate(ev: DialRotateEvent<JsonObject>): void {
		const inst = this.#instances.get(ev.action.id);
		const items = hub.onYou.items;
		const total = items.length;
		if (!inst || total === 0) return;
		inst.index = (((inst.index + ev.payload.ticks) % total) + total) % total;
		inst.key = items[inst.index].key;
		void this.#render(inst);
	}

	override onDialDown(ev: DialDownEvent<JsonObject>): Promise<void> {
		return this.#press(ev.action.id);
	}

	override async onTouchTap(ev: TouchTapEvent<JsonObject>): Promise<void> {
		if (!ev.payload.hold) return this.#press(ev.action.id);
		const inst = this.#instances.get(ev.action.id);
		const item = inst && hub.onYou.items.find((i) => i.key === inst.key);
		if (!item) return void (await ev.action.showAlert());
		hub.onYou.dismiss(item.turn);
	}

	async #press(id: string): Promise<void> {
		const inst = this.#instances.get(id);
		if (!inst) return;
		if (!inst.key || !(await hub.focus(inst.key))) await inst.action.showAlert();
	}

	async #renderAll(): Promise<void> {
		await Promise.all([...this.#instances.values()].map((inst) => this.#render(inst)));
	}

	async #render(inst: Instance): Promise<void> {
		const items = hub.onYou.items;
		// Stay on the same session across reorders while it is still on you.
		const keep = inst.key ? items.findIndex((i) => i.key === inst.key) : -1;
		inst.index = keep >= 0 ? keep : Math.min(inst.index, Math.max(items.length - 1, 0));
		const item = items[inst.index];
		inst.key = item?.key;
		const image = onYouStripImage(item, inst.index, items.length);
		if (inst.image === image) return;
		inst.image = image;
		await inst.action.setFeedback({ canvas: image });
	}
}
