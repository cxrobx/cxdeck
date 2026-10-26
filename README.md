# CX Deck — Stream Deck plugin

Shows which Herdr agent sessions, QuickAsk chats and Claude Code sessions in plain
Ghostty tabs need you, and brings one forward on press. Also: Zen link keys that open a site in the right Zen container.
(Plugin UUID stays `com.cx.herdr` so placed keys keep working.)

Source available under the [Business Source License 1.1](LICENSE): free for personal use and inside your own organisation. It converts to Apache 2.0 on 2030-10-26.

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
- **On you** (key) — sessions you've read but never answered whose last answer still
  leaves you a next step (a question, a decision, an offer to carry on). Shows the count
  and the one that has waited longest; press focuses it, hold dismisses it.
- **On you dial** (Stream Deck +) — the same list on a dial, modeled on the waiting
  dial: rotate through it, press or tap to focus, long-touch the strip to dismiss.

"Waiting" = `blocked` (approval or question UI) first, then `done` (finished a turn,
unseen; toggle with *Count done*), oldest first within each. Focusing marks a done
session seen, so it drops off; a blocked one stays until answered.

## How it works

- **QuickAsk**: reads `~/Library/Application Support/QuickAsk/status.json`, written by
  QuickAsk's `StatusFeed.swift` (watched with `fs.watch` on the folder, 5 s poll behind
  it; a file whose pid is dead is ignored). `needs-you` ranks with blocked, `answered`
  with done; press opens `quickask://chat/<id>`. Herdr panes are stamped when the plugin
  first sees them waiting, so both sources order by how long they have waited.

- **Claude Code in plain Ghostty tabs**: `~/.claude/hooks/cx-deck-state.sh` (registered
  in `~/.claude/settings.json` on UserPromptSubmit, PreToolUse AskUserQuestion,
  PermissionRequest, PostToolUse, Notification, Stop, SessionEnd) writes one file per
  session to `~/.local/state/cx-deck/claude/<session_id>.json` (state, cwd, tty, claude
  pid). Sessions with a `herdr` process above them (read from the process tree;
  `HERDR_ENV` leaks into plain tabs) are tagged with their `HERDR_PANE_ID` and used only
  for *On you*; it skips Meeting Copilot and anything without a tty (`claude -p`). Tests: `~/.claude/hooks/tests/test-cx-deck-state.sh`.
  The plugin finds a session's tab by briefly retitling its tty to a marker and asking
  Ghostty which terminal shows it, then restores the tab's title. Two Ghostty processes
  can run at once (`ghostty -e …` starts a second), and AppleScript-by-name and JXA each
  reach a different one, so both are searched and the owning Ghostty is raised by pid.
  A done session clears once its tab has been in front.

- **On you**: the hook also keeps each session's last prompt and the last answer
  (trimmed to its first 1,500 and last 2,500 characters), never for anything under
  `~/clients`. A turn that finished, that you've seen, and that sat untouched for 10
  minutes is judged once by Claude Haiku (`claude -p`, no tools, no MCP, hooks off,
  nothing saved): "does the user still owe a next step?" Turns you answer quickly are
  never sent. Verdicts and dismissals: `~/Library/Caches/com.cx.deck/on-you.json`.
  QuickAsk chats with the "still on me" ring arrive as `still-on-you` in status.json.

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
npm test                 # selection logic, state files, routes, socket client against a fake Herdr
npm run build
streamdeck link com.cx.herdr.sdPlugin   # once
streamdeck dev           # once — `streamdeck restart` is a no-op without developer mode
streamdeck restart com.cx.herdr
```

Logs: `com.cx.herdr.sdPlugin/logs/`. A newly linked plugin only appears after the
Stream Deck app restarts.
