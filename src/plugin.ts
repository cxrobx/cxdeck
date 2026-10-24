import streamDeck from "@elgato/streamdeck";

import { WaitingDial } from "./actions/dial";
import { NextWaiting } from "./actions/next";
import { AgentSlot } from "./actions/slot";
import { hub, type GlobalSettings } from "./hub";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new AgentSlot());
streamDeck.actions.registerAction(new NextWaiting());
streamDeck.actions.registerAction(new WaitingDial());

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => hub.applySettings(ev.settings));

await streamDeck.connect();
hub.applySettings(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
hub.start();
