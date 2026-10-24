/**
 * SVG images for keys (144×144) and the dial touch strip (200×100).
 * Style "Calm": near-black ground with a faint state-tinted gradient, an
 * accent rail on the left, a dot + small-caps state label, white title.
 * Only SVG Tiny features (gradients, rects, circles, text) — Stream Deck's
 * renderer has no filters.
 */
import { wrap, type WaitingSession } from "./waiting";

export const COLORS = {
	blocked: { accent: "#ff6b4a", deep: "#3a140c", label: "NEEDS YOU" },
	done: { accent: "#3ddc84", deep: "#0d2e1c", label: "DONE" },
} as const;

const GROUND = "#0c0c0e";
const INK = "#f4f4f5";
const MUTED = "#8a8a93";
const FAINT = "#6e6e76";
const GHOST = "#3a3a40";
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function svg(w: number, h: number, body: string): string {
	const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(s)}`;
}

function text(x: number, y: number, content: string, size: number, fill: string, weight = 400, anchor = "start", spacing = 0): string {
	const ls = spacing ? ` letter-spacing="${spacing}"` : "";
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${esc(content)}</text>`;
}

/** State-tinted gradient fading into the ground, plus the accent rail. */
function tinted(w: number, h: number, deep: string, accent: string, horizontal: boolean, rail: number): string {
	const dir = horizontal ? `x1="0" y1="0" x2="1" y2="0"` : `x1="0" y1="0" x2="0" y2="1"`;
	return (
		`<defs><linearGradient id="g" ${dir}><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${GROUND}"/></linearGradient></defs>` +
		`<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${rail}" height="${h}" fill="${accent}"/>`
	);
}

/** Slot key: state label on top, up to three title lines, repo at the bottom. */
export function slotImage(session: WaitingSession | undefined, slot: number, online: boolean): string {
	if (!online) return offlineImage();
	if (!session) {
		return svg(144, 144, `<rect width="144" height="144" fill="${GROUND}"/><circle cx="72" cy="72" r="5" fill="#2a2a2e"/>` + text(130, 26, String(slot), 14, GHOST, 600, "end"));
	}
	const c = COLORS[session.status];
	const lines = wrap(session.title, 13, 3);
	return svg(
		144,
		144,
		tinted(144, 144, c.deep, c.accent, false, 5) +
			`<circle cx="20" cy="22" r="5" fill="${c.accent}"/>` +
			text(31, 27, c.label, 13, c.accent, 700, "start", 1.2) +
			text(132, 27, String(slot), 13, FAINT, 600, "end") +
			lines.map((l, i) => text(15, 62 + i * 21, l, 18, INK, 600)).join("") +
			text(15, 132, truncate(session.repo, 16), 13, MUTED, 500),
	);
}

/** "Next waiting" key: big count, tinted by the most urgent state present. */
export function countImage(waiting: WaitingSession[], online: boolean): string {
	if (!online) return offlineImage();
	const blocked = waiting.filter((w) => w.status === "blocked").length;
	const done = waiting.length - blocked;
	const c = blocked ? COLORS.blocked : done ? COLORS.done : null;
	const sub = waiting.length ? [blocked && `${blocked} blocked`, done && `${done} done`].filter(Boolean).join(" · ") : "all clear";
	return svg(
		144,
		144,
		`<rect width="144" height="144" fill="${c ? c.deep : GROUND}"/>` +
			text(72, 88, String(waiting.length), 68, c ? INK : GHOST, 300, "middle") +
			text(72, 122, sub, 13, c ? c.accent : "#55555c", 600, "middle"),
	);
}

export function offlineImage(): string {
	return svg(144, 144, `<rect width="144" height="144" fill="${GROUND}"/>` + text(72, 70, "Herdr", 20, FAINT, 600, "middle") + text(72, 94, "offline", 15, GHOST, 500, "middle", 1));
}

/** Dial touch strip: state label + k / N, two title lines, repo. */
export function stripImage(session: WaitingSession | undefined, index: number, total: number, online: boolean): string {
	if (!online) {
		return svg(200, 100, `<rect width="200" height="100" fill="${GROUND}"/>` + text(100, 46, "Herdr", 18, FAINT, 600, "middle") + text(100, 68, "offline", 14, GHOST, 500, "middle", 1));
	}
	if (!session) {
		return svg(200, 100, `<rect width="200" height="100" fill="${GROUND}"/><circle cx="100" cy="38" r="4" fill="#2a2a2e"/>` + text(100, 66, "No agents waiting", 13, "#55555c", 600, "middle"));
	}
	const c = COLORS[session.status];
	const lines = wrap(session.title, 20, 2);
	return svg(
		200,
		100,
		tinted(200, 100, c.deep, c.accent, true, 4) +
			`<circle cx="16" cy="16" r="4" fill="${c.accent}"/>` +
			text(26, 20, c.label, 11, c.accent, 700, "start", 1) +
			text(190, 20, `${index + 1} / ${total}`, 11, FAINT, 600, "end") +
			lines.map((l, i) => text(12, 46 + i * 19, l, 16, INK, 600)).join("") +
			text(12, 91, truncate(session.repo, 28), 11, MUTED, 500),
	);
}

export function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
