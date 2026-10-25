import streamDeck from "@elgato/streamdeck";

import { WaitingDial } from "./actions/dial";
import { NextWaiting } from "./actions/next";
import { OnYouKey } from "./actions/on-you";
import { OnYouDial } from "./actions/on-you-dial";
import { AgentSlot } from "./actions/slot";
import { ZenLink } from "./actions/zen-link";
import { hub, type GlobalSettings } from "./hub";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new AgentSlot());
streamDeck.actions.registerAction(new NextWaiting());
streamDeck.actions.registerAction(new WaitingDial());
streamDeck.actions.registerAction(new ZenLink());
streamDeck.actions.registerAction(new OnYouKey());
streamDeck.actions.registerAction(new OnYouDial());

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => hub.applySettings(ev.settings));

await streamDeck.connect();
hub.applySettings(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
hub.start();
