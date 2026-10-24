import { action, type KeyAction, SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { hub } from "../hub";
import { slotImage } from "../render";

type SlotSettings = JsonObject & {
	/** 1-based slot; 0 or unset = auto (placement order on the device, row then column). */
	slot?: number;
};

type Instance = { action: KeyAction<SlotSettings>; settings: SlotSettings; image?: string; key?: string };

/** Shows the k-th session waiting for input; press focuses it. */
@action({ UUID: "com.cx.herdr.slot" })
export class AgentSlot extends SingletonAction<SlotSettings> {
	#instances = new Map<string, Instance>();

	constructor() {
		super();
		hub.subscribe(() => void this.#renderAll());
	}

	override onWillAppear(ev: WillAppearEvent<SlotSettings>): void {
		if (!ev.action.isKey()) return;
		this.#instances.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
		void this.#renderAll(true);
	}

	override onWillDisappear(ev: WillDisappearEvent<SlotSettings>): void {
		this.#instances.delete(ev.action.id);
		void this.#renderAll(true);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SlotSettings>): void {
		const inst = this.#instances.get(ev.action.id);
		if (inst) inst.settings = ev.payload.settings;
		void this.#renderAll(true);
	}

	override async onKeyDown(ev: KeyDownEvent<SlotSettings>): Promise<void> {
		// Focus what this key is showing, not whatever slot k holds by now.
		const key = this.#instances.get(ev.action.id)?.key;
		if (!key || !(await hub.focus(key))) await ev.action.showAlert();
	}

	/** Slot number per instance: explicit setting, else position among auto slots on that device. */
	#slotNumbers(): Map<string, number> {
		const byDevice = new Map<string, Instance[]>();
		for (const inst of this.#instances.values()) {
			if (inst.settings.slot && inst.settings.slot > 0) continue;
			const list = byDevice.get(inst.action.device.id) ?? [];
			list.push(inst);
			byDevice.set(inst.action.device.id, list);
		}
		const out = new Map<string, number>();
		for (const list of byDevice.values()) {
			list.sort((a, b) => {
				const ca = a.action.coordinates ?? { row: 99, column: 99 };
				const cb = b.action.coordinates ?? { row: 99, column: 99 };
				return ca.row - cb.row || ca.column - cb.column;
			});
			list.forEach((inst, i) => out.set(inst.action.id, i + 1));
		}
		for (const inst of this.#instances.values()) {
			if (inst.settings.slot && inst.settings.slot > 0) out.set(inst.action.id, inst.settings.slot);
		}
		return out;
	}

	async #renderAll(force = false): Promise<void> {
		const waiting = hub.waiting;
		const numbers = this.#slotNumbers();
		await Promise.all(
			[...this.#instances.values()].map(async (inst) => {
				const n = numbers.get(inst.action.id) ?? 1;
				const session = waiting[n - 1];
				inst.key = hub.online ? session?.key : undefined;
				const image = slotImage(session, n, hub.online);
				if (!force && image === inst.image) return;
				inst.image = image;
				await inst.action.setImage(image);
			}),
		);
	}
}
