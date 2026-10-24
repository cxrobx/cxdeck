import { action, type DialAction, SingletonAction, type DialDownEvent, type DialRotateEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { stripImage } from "../render";

type Instance = { action: DialAction<JsonObject>; index: number; key?: string; image?: string };

/** Stream Deck +: rotate to scroll through waiting sessions, press or tap to focus the shown one. */
@action({ UUID: "com.cx.herdr.dial" })
export class WaitingDial extends SingletonAction<JsonObject> {
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
		const waiting = hub.waiting;
		const total = waiting.length;
		if (!inst || total === 0) return;
		inst.index = (((inst.index + ev.payload.ticks) % total) + total) % total;
		inst.key = waiting[inst.index].key;
		void this.#render(inst);
	}

	override onDialDown(ev: DialDownEvent<JsonObject>): Promise<void> {
		return this.#press(ev.action.id);
	}

	override onTouchTap(ev: TouchTapEvent<JsonObject>): Promise<void> {
		return this.#press(ev.action.id);
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
		const waiting = hub.waiting;
		// Stay on the same pane across reorders when it is still waiting.
		const keep = inst.key ? waiting.findIndex((w) => w.key === inst.key) : -1;
		inst.index = keep >= 0 ? keep : Math.min(inst.index, Math.max(waiting.length - 1, 0));
		const session = hub.online ? waiting[inst.index] : undefined;
		inst.key = session?.key;
		const image = stripImage(session, inst.index, waiting.length, hub.online);
		if (inst.image === image) return;
		inst.image = image;
		await inst.action.setFeedback({ canvas: image });
	}
}
