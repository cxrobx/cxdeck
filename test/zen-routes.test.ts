import { test } from "node:test";
import assert from "node:assert/strict";

import { displayName, routeFor, samePage, sameSite } from "../src/zen-routes.ts";

// Placeholder domains, shaped like ~/.config/zen-mcp/containers.json.
const file = {
	containers: { Work: ["work.example"], Client: { domains: ["client.example"], account: "you@example.com" } },
	consoles: ["console.example"],
	routes: { Work: ["social.example", "app.client.example"] },
};

test("routes: exact host, subdomain, residence routes, most specific wins", () => {
	assert.deepEqual(routeFor("https://social.example/home", file), { kind: "container", container: "Work", rule: "social.example" });
	assert.deepEqual(routeFor("www.social.example", file), { kind: "container", container: "Work", rule: "social.example" });
	assert.equal((routeFor("https://client.example/x", file) as { container: string }).container, "Client");
	// app.client.example is routed to Work explicitly, beating the Client parent domain.
	assert.equal((routeFor("https://app.client.example", file) as { container: string }).container, "Work");
	// Lookalikes don't match.
	assert.equal(routeFor("https://notsocial.example", file).kind, "none");
	assert.equal(routeFor("https://social.example.evil.test", file).kind, "none");
});

test("routes: console hosts are refused, never guessed", () => {
	assert.deepEqual(routeFor("https://console.example/?resource=work.example", file), { kind: "console", host: "console.example" });
});

test("tab reuse: same site ignores www and path; same page ignores slash and fragment", () => {
	assert.ok(sameSite("https://www.x.com/home", "x.com"));
	assert.ok(!sameSite("https://x.com", "https://xx.com"));
	assert.ok(samePage("https://x.com/home/", "x.com/home#top"));
	assert.ok(!samePage("https://x.com/home", "https://x.com/explore"));
	assert.ok(!samePage("https://x.com/a?q=1", "https://x.com/a?q=2"));
});

test("display name", () => {
	assert.equal(displayName("https://www.x.com/"), "x.com");
	assert.equal(displayName("x.com/i/bookmarks"), "x.com/i/bookmarks");
});
