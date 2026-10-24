import { test } from "node:test";
import assert from "node:assert/strict";

import { iconLinks } from "../src/favicon.ts";

test("icon links: apple-touch first, larger first, mask-icon skipped, relative hrefs resolved", () => {
	const html = `
		<link rel="icon" href="/favicon.ico"/>
		<link rel="mask-icon" href="/pinned.svg" color="#000">
		<link rel="icon" type="image/png" sizes="32x32" href="/f32.png">
		<link rel="apple-touch-icon" sizes="192x192" href="/apple-touch-icon.png"/>
		<link rel="icon" type="image/svg+xml" href="https://cdn.example/f.svg">`;
	assert.deepEqual(iconLinks(html, "https://site.example/"), [
		"https://site.example/apple-touch-icon.png",
		"https://site.example/f32.png",
		"https://site.example/favicon.ico",
		"https://cdn.example/f.svg",
	]);
});
