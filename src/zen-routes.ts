/**
 * Which Zen container a URL belongs to, read from Zen MCP's route file
 * (~/.config/zen-mcp/containers.json), plus the "is this tab already that link"
 * test. A deliberately small port of zen-mcp's server/src/routes.ts: host rules
 * from `containers` (identity domains) and `routes` (residence), exact host
 * beating a parent-domain match. Console hosts (shared, routed by URL contents
 * in Zen MCP) are not resolved here: Auto refuses them so a key never guesses
 * a jar where the wrong one is an incident.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROUTES_PATH = process.env.ZEN_MCP_ROUTES ?? path.join(os.homedir(), ".config/zen-mcp/containers.json");

export type RouteDecision =
	| { kind: "container"; container: string; rule: string }
	| { kind: "console"; host: string }
	| { kind: "none" };

type RouteFile = {
	containers?: Record<string, string[] | { domains?: string[] }>;
	consoles?: string[];
	routes?: Record<string, string[]>;
};

export function hostOf(url: string): string | null {
	for (const candidate of [url, `https://${url}`]) {
		try {
			const host = new URL(candidate).hostname.replace(/\.$/, "").toLowerCase();
			if (host) return host;
		} catch {
			// try the next form
		}
	}
	return null;
}

/** Resolve `url` against the route file's host rules. */
export function routeFor(url: string, file: RouteFile): RouteDecision {
	const host = hostOf(url);
	if (!host) return { kind: "none" };
	const matches = (pattern: string) => host === pattern || host.endsWith(`.${pattern}`);
	if ((file.consoles ?? []).some((c) => matches(c.toLowerCase()))) return { kind: "console", host };

	const rules: { container: string; pattern: string }[] = [];
	for (const [container, def] of Object.entries(file.containers ?? {})) {
		const domains = Array.isArray(def) ? def : (def?.domains ?? []);
		for (const d of domains) rules.push({ container, pattern: d.toLowerCase() });
	}
	for (const [container, hosts] of Object.entries(file.routes ?? {})) {
		for (const h of hosts) rules.push({ container, pattern: h.toLowerCase() });
	}
	let best: { container: string; pattern: string; score: number } | null = null;
	for (const r of rules) {
		if (!matches(r.pattern)) continue;
		const score = (host === r.pattern ? 10_000 : 0) + r.pattern.length;
		if (!best || score > best.score) best = { ...r, score };
	}
	return best ? { kind: "container", container: best.container, rule: best.pattern } : { kind: "none" };
}

export function loadRoutes(file = ROUTES_PATH): RouteFile {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}

const bareHost = (h: string) => h.replace(/^www\./, "");

/** Same site: hosts equal once a leading "www." is dropped (x.com == www.x.com). */
export function sameSite(a: string, b: string): boolean {
	const ha = hostOf(a);
	const hb = hostOf(b);
	return !!ha && !!hb && bareHost(ha) === bareHost(hb);
}

/** Same page: same site, path (ignoring a trailing slash) and query; the fragment is ignored. */
export function samePage(a: string, b: string): boolean {
	const parse = (u: string) => {
		try {
			return new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`);
		} catch {
			return null;
		}
	};
	const ua = parse(a);
	const ub = parse(b);
	if (!ua || !ub || !sameSite(a, b)) return false;
	const p = (u: URL) => u.pathname.replace(/\/+$/, "") || "/";
	return p(ua) === p(ub) && ua.search === ub.search;
}

/** "https://www.x.com/home" → "x.com/home"; the bare site when the path is just "/". */
export function displayName(url: string): string {
	const host = hostOf(url);
	if (!host) return url;
	try {
		const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
		const p = u.pathname.replace(/\/+$/, "");
		return bareHost(host) + p;
	} catch {
		return bareHost(host);
	}
}
