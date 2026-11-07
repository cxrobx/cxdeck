/**
 * Which "On you" sessions the On you keys show, per device, so the On you dials on the same
 * device show different ones. Keys place first; dials re-place whenever this changes.
 */
import { EventEmitter } from "node:events";

const byDevice = new Map<string, Set<string>>();
const events = new EventEmitter();

export const keyClaims = {
	get(device: string): Set<string> {
		return byDevice.get(device) ?? new Set();
	},
	set(next: Map<string, Set<string>>): void {
		const same = next.size === byDevice.size && [...next].every(([d, s]) => {
			const old = byDevice.get(d);
			return !!old && old.size === s.size && [...s].every((k) => old.has(k));
		});
		if (same) return;
		byDevice.clear();
		for (const [d, s] of next) byDevice.set(d, s);
		events.emit("change");
	},
	subscribe(fn: () => void): void {
		events.on("change", fn);
	},
};
