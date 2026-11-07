import { test } from "node:test";
import assert from "node:assert/strict";

import { rotate, settle } from "../src/spread.ts";

const keys = ["a", "b", "c", "d"];

test("settle: keep your own item while free; otherwise the next free one, wrapping", () => {
	assert.equal(settle(keys, "c", 2, new Set()), 2);
	assert.equal(settle(keys, "a", 0, new Set(["a"])), 1, "second dial on the same item moves on");
	assert.equal(settle(keys, undefined, 0, new Set(["a"])), 1, "a new dial starts past the first");
	assert.equal(settle(keys, "gone", 3, new Set(["d"])), 0, "wraps to the start");
	assert.equal(settle(keys, "x", 9, new Set()), 3, "an index past the end clamps");
	assert.equal(settle(["a"], undefined, 0, new Set(["a"])), -1, "nothing free: show nothing rather than a duplicate");
	assert.equal(settle([], undefined, 0, new Set()), -1);
});

test("two dials never land on the same item as they settle left to right", () => {
	const first = settle(keys, undefined, 0, new Set());
	const second = settle(keys, undefined, 0, new Set([keys[first]]));
	assert.notEqual(keys[first], keys[second]);
});

test("rotate skips items other dials hold, both ways, and stays put when none is free", () => {
	assert.equal(rotate(keys, 0, 1, new Set(["b"])), 2);
	assert.equal(rotate(keys, 2, -1, new Set(["b"])), 0);
	assert.equal(rotate(keys, 0, 2, new Set(["b"])), 3);
	assert.equal(rotate(keys, 3, 1, new Set(["a"])), 1, "wraps past a held item");
	assert.equal(rotate(["a", "b"], 0, 1, new Set(["b"])), 0, "only one free: stays");
	assert.equal(rotate([], 0, 1, new Set()), -1);
});
