import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { HerdrWatcher, request } from "../src/herdr.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdherdr-"));

test("missing socket → offline, no throw", async () => {
	const w = new HerdrWatcher(path.join(tmp, "nope.sock"));
	await w.refresh();
	assert.equal(w.state.online, false);
	w.stop();
	await assert.rejects(request("agent.list", {}, path.join(tmp, "nope.sock")));
});

test("fake Herdr: list, subscribe event triggers re-read, server death → offline", async () => {
	const sock = path.join(tmp, "fake.sock");
	let status = "working";
	let subscribers: net.Socket[] = [];
	const server = net.createServer((c) => {
		let buf = "";
		c.on("data", (d) => {
			buf += d;
			const nl = buf.indexOf("\n");
			if (nl < 0) return;
			const req = JSON.parse(buf.slice(0, nl));
			buf = buf.slice(nl + 1);
			if (req.method === "agent.list") c.end(JSON.stringify({ id: req.id, result: { agents: [{ pane_id: "w1:p1", agent_status: status }] } }) + "\n");
			else if (req.method === "events.subscribe") {
				assert.ok(req.params.subscriptions.some((s: { type: string; pane_id?: string }) => s.type === "pane.agent_status_changed" && s.pane_id === "w1:p1"));
				c.write(JSON.stringify({ id: req.id, result: { type: "subscription_started" } }) + "\n");
				subscribers.push(c);
			}
		});
		c.on("error", () => {});
	});
	await new Promise<void>((r) => server.listen(sock, r));
	const w = new HerdrWatcher(sock);
	const changes: string[] = [];
	w.on("change", (s) => changes.push(s.online ? s.agents[0]?.agent_status : "offline"));
	await w.refresh();
	assert.equal(w.state.agents[0].agent_status, "working");
	await new Promise((r) => setTimeout(r, 100));
	assert.equal(subscribers.length, 1);

	status = "blocked";
	subscribers[0].write(JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: "w1:p1", workspace_id: "w1", agent_status: "blocked" } }) + "\n");
	await new Promise((r) => setTimeout(r, 150));
	assert.equal(w.state.agents[0].agent_status, "blocked");

	for (const s of subscribers) s.destroy();
	await new Promise<void>((r) => server.close(() => r()));
	await new Promise((r) => setTimeout(r, 1300));
	assert.equal(w.state.online, false);
	assert.deepEqual(changes, ["working", "blocked", "offline"]);
	w.stop();
});
