# CX Deck — Stream Deck plugin

Shows which Herdr agent sessions and QuickAsk chats need you, and brings one
forward on press. Also: Zen link keys that open a site in the right Zen container.
(Plugin UUID stays `com.cx.herdr` so placed keys keep working.)

- **Agent slot** (key) — the k-th waiting session: state, title, repo. Slots number
  themselves in placement order (row, then column); override in the inspector.
- **Next waiting** (key) — how many are waiting; press focuses the one that has
  waited longest.
- **Waiting dial** (Stream Deck +) — rotate through waiting sessions, press or tap
  to focus the one shown.
- **Zen link** (key) — opens a URL in Zen in its container (Auto = Zen MCP's
  `~/.config/zen-mcp/containers.json` host rules, or pick one), or brings forward a tab
  already on that site (or exact page) **in that container**. Talks to the Zen MCP daemon
  (`ws://127.0.0.1:8766`, token `~/.config/zen-mcp/auth.token`); daemon or extension down
  = alert, never a plain open in the wrong jar. Console hosts need an explicit container.
  The key shows the site's icon (cached in `~/Library/Caches/com.cx.deck/favicons`).

"Waiting" = `blocked` (approval or question UI) first, then `done` (finished a turn,
unseen; toggle with *Count done*), oldest first within each. Focusing marks a done
session seen, so it drops off; a blocked one stays until answered.

## How it works

- **QuickAsk**: reads `~/Library/Application Support/QuickAsk/status.json`, written by
  QuickAsk's `StatusFeed.swift` (watched with `fs.watch` on the folder, 5 s poll behind
  it; a file whose pid is dead is ignored). `needs-you` ranks with blocked, `answered`
  with done; press opens `quickask://chat/<id>`. Herdr panes are stamped when the plugin
  first sees them waiting, so both sources order by how long they have waited.

- Talks to `~/.config/herdr/herdr.sock` directly. State is pushed: `events.subscribe`
  on `pane.agent_detected` / `pane.closed` / `pane.focused` plus a per-pane
  `pane.agent_status_changed` (Herdr requires a `pane_id` on that one), each
  event re-reads `agent.list`; a 5 s poll backs it up. No socket = "Herdr offline".
- Press → `agent.focus`, then AppleScript (Ghostty 1.3+) focuses the Ghostty tab
  whose name contains *Ghostty tab* (default `Herdr`), falling back to `open -a Ghostty`.
  The first press asks for Automation permission (Stream Deck → Ghostty).

## Develop

```sh
npm install
npm test                 # selection logic + socket client against a fake Herdr
npm run build
streamdeck link com.cx.herdr.sdPlugin   # once
streamdeck dev           # once — `streamdeck restart` is a no-op without developer mode
streamdeck restart com.cx.herdr
```

Logs: `com.cx.herdr.sdPlugin/logs/`. A newly linked plugin only appears after the
Stream Deck app restarts.
