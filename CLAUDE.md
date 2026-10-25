# CX Deck (cxdeck)

Stream Deck plugin, plugin UUID `com.cx.herdr`, shown in the app as **CX Deck**. It shows which
agent sessions need Chris and brings one forward on press, plus Zen link keys. The README
has the user-facing behaviour and the mechanics of each source; read it first.

## Sources of "waiting"

| Source | Signal | Press does |
|---|---|---|
| Herdr panes | `~/.config/herdr/herdr.sock` (push via `events.subscribe` + 5 s poll) | `agent.focus`, then raise the Ghostty tab named `Herdr` |
| QuickAsk chats | `~/Library/Application Support/QuickAsk/status.json` (written by `~/Projects/quickask` `StatusFeed.swift`) | `open quickask://chat/<id>` |
| Claude Code in plain Ghostty tabs | `~/.local/state/cx-deck/claude/*.json`, written by `~/.claude/hooks/cx-deck-state.sh` | focus that tab (marker-title match) |

Each source merges in `src/hub.ts`; ordering and the blocked/done mapping are pure
functions in `src/waiting.ts` (unit-tested).

## Things that bite

- **Developer mode is required**: run `npx streamdeck dev` once, or `streamdeck restart` is
  a silent no-op. A new action or a manifest rename shows only after restarting the
  Stream Deck app itself.
- **Node's type stripping (tests) can't resolve extensionless relative imports at
  runtime**: a file imported by a test must not runtime-import a sibling (`import type`
  is fine). Rollup bundles fine either way. No TS parameter properties either.
- **Ghostty AppleScript**: inside `tell application "Ghostty"`, `tab` is Ghostty's tab
  class, not a tab character; build separators outside the tell block. The tab's `name`
  is the title Chris sees; a terminal's `name` is often just its working directory.
- **Two Ghostty processes** are normal (voice-lab's `transcript` runs `ghostty -e …`).
  AppleScript-by-name reaches one, JXA (by name *or* pid) the other, and neither can be
  pinned to a pid. `src/claude-term.ts` searches both and raises the owning process
  through System Events by pid. Don't "simplify" this back to one route.
- **`HERDR_ENV=1` leaks into plain tabs** of a Ghostty launched from a Herdr pane, so the
  hook decides "inside Herdr" from the process tree (a `herdr` above `claude`), never
  from the env.
- **A failed tab match backs off 5 min** (a press still retries). Without it the plugin
  retitles that tab every poll, which shows as a flickering title.
- **Key SVGs take exactly one `font-family`.** Stream Deck's renderer ignores a
  comma-separated list entirely (it drew a default sans, not even the fallback), so
  `src/render.ts` names `JetBrains Mono` alone (QuickAsk's font, installed system-wide).
  Check a font change on the real deck, zoomed, not in Chrome: Chrome renders lists fine.
- **Zen links never fall back to a plain open.** Daemon down, console host or no route =
  alert. A wrong container is an incident (wrong logins), not a degraded success.
- Tests use placeholder domains and containers, never Chris's real routes or tabs
  (`test/zen-routes.test.ts`); the live routes file is read at runtime only.

## Outside this repo

- `~/.claude/hooks/cx-deck-state.sh` + `~/.claude/hooks/tests/test-cx-deck-state.sh`,
  registered in `~/.claude/settings.json` (all tracked by `cxcfg`). The hook runs in
  every Claude session: it must stay fast (PostToolUse exits in bash unless the session
  is marked needs-you) and always exit 0. Re-run its test after any edit.
- `~/.config/zen-mcp/containers.json` holds the container routes the Zen link's *Auto*
  uses (owned by zen-mcp; `x.com → Geek` was added for this plugin).
- `~/Projects/quickask` owns `status.json` and the `quickask://` URL scheme.

## Verify

`npm test`, `npm run build`, `npx streamdeck restart com.cx.herdr`, then a real press:
logs in `com.cx.herdr.sdPlugin/logs/` print one line per press (`focused …: ok|failed`).
Screenshot the deck with `screencapture -l <Stream Deck window id>`.
