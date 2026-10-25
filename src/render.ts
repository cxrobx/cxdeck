/**
 * SVG images for keys (144×144) and the dial touch strip (200×100).
 * Style "Header bar": a solid bar in the state colour carries the state and the
 * position in dark ink, the title sits below in white, the source in the state
 * colour at the bottom. Set in JetBrains Mono, QuickAsk's font (falls back to
 * Menlo). Only SVG Tiny features (rects, circles, text) — Stream Deck's renderer
 * has no filters.
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
const CARD = "#121214";
const FONT = "JetBrains Mono";

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

/** The state bar across the top: label on the left, position on the right, dark ink. */
function headerBar(w: number, h: number, accent: string, label: string, right: string, size: number): string {
	const y = Math.round(h / 2 + size * 0.36);
	return `<rect width="${w}" height="${h}" fill="${accent}"/>` + text(10, y, label, size, GROUND, 800, "start", 0.5) + text(w - 10, y, right, size, GROUND, 700, "end");
}

/** Slot key: state bar with the slot number, up to three title lines, source at the bottom. */
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
		`<rect width="144" height="144" fill="${CARD}"/>` +
			headerBar(144, 30, c.accent, c.label, String(slot), 13) +
			lines.map((l, i) => text(10, 56 + i * 20, l, 16, INK, 600)).join("") +
			text(10, 131, truncate(session.repo, 14), 13, c.accent, 600),
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

/** Dial touch strip: state bar with k/N, two title lines, source. */
export function stripImage(session: WaitingSession | undefined, index: number, total: number, online: boolean): string {
	if (!online) {
		return svg(200, 100, `<rect width="200" height="100" fill="${GROUND}"/>` + text(100, 46, "Herdr", 18, FAINT, 600, "middle") + text(100, 68, "offline", 14, GHOST, 500, "middle", 1));
	}
	if (!session) {
		return svg(200, 100, `<rect width="200" height="100" fill="${GROUND}"/><circle cx="100" cy="38" r="4" fill="#2a2a2e"/>` + text(100, 66, "No agents waiting", 13, "#55555c", 600, "middle"));
	}
	const c = COLORS[session.status];
	const lines = wrap(session.title, 17, 2);
	return svg(
		200,
		100,
		`<rect width="200" height="100" fill="${CARD}"/>` +
			headerBar(200, 24, c.accent, c.label, `${index + 1}/${total}`, 11) +
			lines.map((l, i) => text(10, 48 + i * 19, l, 15, INK, 600)).join("") +
			text(10, 91, truncate(session.repo, 19), 10, c.accent, 600),
	);
}

export function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Zen link key. With the site's icon: the icon centred on black like Stream Deck's own
 * Website key, the container as a small coloured line beneath. Without one: the site name.
 */
export function linkImage(label: string, container: string | null, color: string | null, icon: string | null = null): string {
	if (icon) {
		const foot = container
			? `<rect x="0" y="140" width="144" height="4" fill="${color ?? FAINT}"/>` + text(72, 131, truncate(container, 16), 13, color ?? MUTED, 600, "middle")
			: text(72, 131, "pick a container", 12, COLORS.blocked.accent, 600, "middle");
		return svg(
			144,
			144,
			`<rect width="144" height="144" fill="#000000"/>` +
				`<image xmlns:xlink="http://www.w3.org/1999/xlink" x="32" y="16" width="80" height="80" xlink:href="${icon}" href="${icon}"/>` +
				foot,
		);
	}
	const lines = wrap(label, 11, 3);
	const firstY = 74 - (lines.length - 1) * 11;
	const chip = container
		? `<circle cx="20" cy="124" r="5" fill="${color ?? FAINT}"/>` + text(31, 129, truncate(container, 13), 14, color ?? MUTED, 600)
		: text(15, 129, "pick a container", 13, COLORS.blocked.accent, 600);
	return svg(
		144,
		144,
		`<rect width="144" height="144" fill="${GROUND}"/><rect width="5" height="144" fill="${color ?? GHOST}"/>` +
			text(15, 27, "ZEN", 12, FAINT, 700, "start", 1.2) +
			lines.map((l, i) => text(15, firstY + i * 22, l, 19, INK, 600)).join("") +
			chip,
	);
}
