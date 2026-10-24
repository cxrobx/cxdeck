# Herdr Agents — Stream Deck plugin

Shows which Herdr agent sessions need you, and focuses one on press.

- **Agent slot** (key) — the k-th waiting session: state, title, repo. Slots number
  themselves in placement order (row, then column); override in the inspector.
- **Next waiting** (key) — how many are waiting; press focuses the one that has
  waited longest.
- **Waiting dial** (Stream Deck +) — rotate through waiting sessions, press or tap
  to focus the one shown.

"Waiting" = `blocked` (approval or question UI) first, then `done` (finished a turn,
unseen; toggle with *Count done*), oldest first within each. Focusing marks a done
session seen, so it drops off; a blocked one stays until answered.

## How it works

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
