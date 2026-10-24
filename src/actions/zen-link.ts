import streamDeck, { action, type KeyAction, SingletonAction, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { siteIcon } from "../favicon";
import { linkImage } from "../render";
import { CONTAINER_COLORS, containerFor, listContainers, openInZen } from "../zen";
import { displayName } from "../zen-routes";

type LinkSettings = JsonObject & {
	url?: string;
	/** Container name; empty = Auto (Zen MCP routes). */
	container?: string;
	/** "site" (any page on the site, default) or "page" (this exact page). */
	match?: string;
	/** Optional label instead of the site name. */
	label?: string;
};

/** Opens a link in Zen in its container, or brings forward the tab already showing it. */
@action({ UUID: "com.cx.herdr.zenlink" })
export class ZenLink extends SingletonAction<LinkSettings> {
	override onWillAppear(ev: WillAppearEvent<LinkSettings>): Promise<void> | void {
		if (ev.action.isKey()) return this.#draw(ev.action, ev.payload.settings);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<LinkSettings>): Promise<void> | void {
		if (ev.action.isKey()) return this.#draw(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<LinkSettings>): Promise<void> {
		const { url, container: setting, match } = ev.payload.settings;
		if (!url) return ev.action.showAlert();
		const choice = containerFor(url, setting || undefined);
		if ("error" in choice) {
			streamDeck.logger.warn(`zen link ${url}: ${choice.error}`);
			return ev.action.showAlert();
		}
		try {
			const r = await openInZen(url, choice.container, match === "page" ? "page" : "site");
			streamDeck.logger.info(`zen link ${url}: ${r.how} tab ${r.tabId} in ${r.container}`);
		} catch (e) {
			// Never fall back to a plain open: that would load the site in the wrong container.
			streamDeck.logger.error(`zen link ${url}: ${(e as Error).message}`);
			await ev.action.showAlert();
		}
	}

	/** The inspector's container dropdown asks for Zen's live container list. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, LinkSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getContainers") return;
		let items: { label: string; value: string }[] = [];
		try {
			items = (await listContainers()).map((c) => ({ label: c.name, value: c.name }));
		} catch (e) {
			streamDeck.logger.warn(`container list: ${(e as Error).message}`);
		}
		await streamDeck.ui.sendToPropertyInspector({ event: "getContainers", items: [{ label: "Auto (Zen MCP routes)", value: "" }, ...items] });
	}

	/** Drawn on appear and on settings change only, never on a timer. */
	async #draw(key: KeyAction<LinkSettings>, s: LinkSettings): Promise<void> {
		if (!s.url) return key.setImage(linkImage("Set a URL", null, null));
		const choice = containerFor(s.url, s.container || undefined);
		const name = "container" in choice ? choice.container : null;
		let color: string | null = null;
		if (name) {
			try {
				const c = (await listContainers()).find((x) => x.name.toLowerCase() === name.toLowerCase());
				color = c ? (CONTAINER_COLORS[c.color] ?? null) : null;
			} catch {
				// Zen not reachable: draw without the colour
			}
		}
		const label = s.label?.trim() || displayName(s.url);
		await key.setImage(linkImage(label, name, color));
		// The icon can take a few seconds the first time (fetched, then cached), so draw twice.
		const icon = await siteIcon(s.url).catch(() => null);
		if (icon) await key.setImage(linkImage(label, name, color, icon));
	}
}
