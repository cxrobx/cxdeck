/**
 * Several dials showing the same list each hold a different item. Pure: indexes over the
 * list's keys, and the keys the other dials already hold.
 */

/** Where a dial should sit: its own item if still listed and free, else the first free one from `index` on. -1 = none free. */
export function settle(keys: string[], current: string | undefined, index: number, taken: Set<string>): number {
	const keep = current ? keys.indexOf(current) : -1;
	if (keep >= 0 && !taken.has(current!)) return keep;
	const n = keys.length;
	const start = Math.min(Math.max(index, 0), Math.max(n - 1, 0));
	for (let i = 0; i < n; i++) {
		const j = (start + i) % n;
		if (!taken.has(keys[j])) return j;
	}
	return -1;
}

/** Rotate `ticks` steps from `index`, skipping items other dials hold. Stays put when nothing else is free. */
export function rotate(keys: string[], index: number, ticks: number, taken: Set<string>): number {
	const n = keys.length;
	if (n === 0) return -1;
	const step = ticks < 0 ? -1 : 1;
	let at = index;
	for (let t = 0; t < Math.abs(ticks); t++) {
		let next = at;
		for (let i = 0; i < n; i++) {
			next = (((next + step) % n) + n) % n;
			if (!taken.has(keys[next])) break;
		}
		if (taken.has(keys[next])) return at;
		at = next;
	}
	return at;
}
