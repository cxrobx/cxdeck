/**
 * The site's own icon for a Zen link key, the way Stream Deck's built-in
 * Website action shows one. Tries the page's <link rel="apple-touch-icon"/"icon">
 * (largest raster first), then /apple-touch-icon.png, then /favicon.ico. Every
 * result is normalised to a 144 px PNG with macOS `sips`, because .ico and odd
 * sizes don't render inside a key's SVG. Cached on disk per host; a miss is
 * remembered for a day so a site without an icon isn't re-fetched on every draw.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_DIR = path.join(os.homedir(), "Library/Caches/com.cx.deck/favicons");
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

type Candidate = { href: string; size: number; touch: boolean };

/** Icon links from a page, best first: apple-touch-icon, then larger, then raster over SVG. */
export function iconLinks(html: string, base: string): string[] {
	const out: Candidate[] = [];
	for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
		const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((v) => v !== undefined);
		const rel = (attr("rel") ?? "").toLowerCase();
		const href = attr("href");
		if (!href || rel.includes("mask-icon") || !/\b(icon|apple-touch-icon|fluid-icon)\b/.test(rel)) continue;
		const sizes = attr("sizes") ?? "";
		const size = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])));
		const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(attr("type") ?? "");
		try {
			out.push({ href: new URL(href, base).href, size: svg ? -1 : size, touch: rel.includes("apple-touch-icon") || rel.includes("fluid-icon") });
		} catch {
			// bad href
		}
	}
	return out.sort((a, b) => Number(b.touch) - Number(a.touch) || b.size - a.size).map((c) => c.href);
}

async function get(url: string): Promise<Response | null> {
	try {
		const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(6000) });
		return res.ok ? res : null;
	} catch {
		return null;
	}
}

function toPng(input: string, output: string): Promise<boolean> {
	return new Promise((resolve) =>
		execFile("/usr/bin/sips", ["-s", "format", "png", "-Z", "144", input, "--out", output], { timeout: 8000 }, (err) => resolve(!err && fs.existsSync(output))),
	);
}

/** A PNG data URI of the site's icon, or null when none could be fetched. */
export async function siteIcon(url: string): Promise<string | null> {
	let host: string;
	try {
		host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
	} catch {
		return null;
	}
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	const key = createHash("sha1").update(host).digest("hex").slice(0, 16);
	const png = path.join(CACHE_DIR, `${key}.png`);
	const miss = path.join(CACHE_DIR, `${key}.miss`);
	if (fs.existsSync(png)) return `data:image/png;base64,${fs.readFileSync(png).toString("base64")}`;
	if (fs.existsSync(miss) && Date.now() - fs.statSync(miss).mtimeMs < MISS_TTL_MS) return null;

	const origin = `https://${host}/`;
	const page = await get(origin);
	const fromPage = page ? iconLinks(await page.text(), page.url || origin).filter((h) => !/\.svg(\?|$)/i.test(h)) : [];
	for (const candidate of [...fromPage, new URL("/apple-touch-icon.png", origin).href, new URL("/favicon.ico", origin).href]) {
		const res = await get(candidate);
		if (!res || !/^image\//.test(res.headers.get("content-type") ?? "image/")) continue;
		const bytes = Buffer.from(await res.arrayBuffer());
		if (bytes.length < 100) continue;
		const raw = path.join(CACHE_DIR, `${key}.src`);
		fs.writeFileSync(raw, bytes);
		const ok = await toPng(raw, png);
		fs.rmSync(raw, { force: true });
		if (ok) return `data:image/png;base64,${fs.readFileSync(png).toString("base64")}`;
	}
	fs.writeFileSync(miss, "");
	return null;
}
