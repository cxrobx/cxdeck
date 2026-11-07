import { action, type DialAction, SingletonAction, type DialDownEvent, type DialRotateEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { onYouStripImage } from "../render";
import { rotate, settle } from "../spread";

type Instance = { action: DialAction<JsonObject>; index: number; key?: string; image?: string };

/**
 * Stream Deck +: rotate through "On you" sessions, press or tap to focus the shown one,
 * long-touch to dismiss it. With several of these dials, each shows a different session:
 * left to right they take the next free one, and rotating skips the ones the others show.
 */
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
		const next = rotate(items.map((i) => i.key), inst.index, ev.payload.ticks, this.#takenBy(inst));
		if (next < 0) return;
		inst.index = next;
		inst.key = items[next].key;
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

	/** Keys the other dials on the same device show. */
	#takenBy(inst: Instance): Set<string> {
		const device = inst.action.device.id;
		return new Set([...this.#instances.values()].filter((o) => o !== inst && o.key && o.action.device.id === device).map((o) => o.key!));
	}

	/** Left to right, so the leftmost dial keeps its session and the next one moves on. */
	async #renderAll(): Promise<void> {
		const ordered = [...this.#instances.values()].sort(
			(a, b) => a.action.device.id.localeCompare(b.action.device.id) || (a.action.coordinates?.column ?? 99) - (b.action.coordinates?.column ?? 99),
		);
		const taken = new Map<string, Set<string>>();
		for (const inst of ordered) {
			const mine = taken.get(inst.action.device.id) ?? new Set<string>();
			taken.set(inst.action.device.id, mine);
			this.#place(inst, mine);
			if (inst.key) mine.add(inst.key);
		}
		await Promise.all(ordered.map((inst) => this.#render(inst, false)));
	}

	#place(inst: Instance, taken: Set<string>): void {
		const items = hub.onYou.items;
		// Stay on the same session across reorders while it is still on you and no dial to the left has it.
		const at = settle(items.map((i) => i.key), inst.key, inst.index, taken);
		inst.index = Math.max(at, 0);
		inst.key = at >= 0 ? items[at].key : undefined;
	}

	async #render(inst: Instance, place = true): Promise<void> {
		const items = hub.onYou.items;
		if (place) this.#place(inst, this.#takenBy(inst));
		const item = inst.key ? items[inst.index] : undefined;
		const image = onYouStripImage(item, inst.index, items.length);
		if (inst.image === image) return;
		inst.image = image;
		await inst.action.setFeedback({ canvas: image });
	}
}
