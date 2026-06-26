# Cue

**A desktop ping when an auto-mode Claude Code session goes idle waiting for you — built for many parallel sessions.**

In an unattended permission mode (`bypassPermissions`, `auto`, or `dontAsk`) there are
no permission prompts to pull you back, so the only "your turn" moment is when a session
finishes its work and the input prompt sits waiting. Cue listens for exactly that,
figures out *which* session it is, and pings you — without stacking sounds when you walk
back to several idle sessions at once.

## What it does

- **Fires on idle, gated to unattended modes.** A `Notification` hook with the
  `idle_prompt` matcher is the trigger — it fires when the session is done and the prompt
  is waiting for you. Cue only notifies for sessions running in an unattended mode, so an
  attended session you're actively watching won't ping you.
- **Tells you which session.** The notification title is the session's identity (see
  [Identity](#identity)).
- **Plays nicely in parallel.** A global, atomic sound throttle means N sessions idling
  at once produce N notifications but only **one** sound — even when the idle handlers
  fire simultaneously.
- **Unattended modes only.** A `default` / `plan` / `acceptEdits` session that idles
  produces **no** notification (configurable).

By default Cue notifies for the three **unattended** permission modes —
`bypassPermissions`, `auto`, and `dontAsk` — because in those modes nothing prompts you
back, so the idle moment is the only signal you've got. `acceptEdits` still prompts for
non-filesystem commands (so you're expected to be present), and `default` / `plan` only
read without asking; none of those notify unless you opt them in via `autoModes`.

## How it works

Claude Code's `Notification` payload (the idle trigger) does **not** include the
session's `permission_mode`, but the `Stop` payload does. So Cue uses two hooks:

| Hook | Matcher | Job |
| --- | --- | --- |
| `Stop` | — | Stash this session's current `permission_mode` into its state file. |
| `Notification` | `idle_prompt` | On idle, read the stashed mode; if it's an unattended mode, resolve the identity and notify. |

Both run with `"async": true` so they never block the agent loop. One script
(`bin/cue.mjs`) handles both, dispatched by a subcommand (`idle` / `stash-mode`).

State lives in `~/.cue/`, one JSON file per session, with a forward-compatible schema so
a future "control tower" dashboard can read it unchanged. If `XDG_STATE_HOME` is set,
state and config move under `$XDG_STATE_HOME/cue` instead (e.g. `~/.local/state/cue`) —
that's also where you'll find `config.json`.

## Install

### From the marketplace (recommended)

```text
/plugin marketplace add wikispecadmin-ai/cue
/plugin install cue@cue-marketplace
```

> Replace `wikispecadmin-ai/cue` with wherever you host this repo. This plugin's
> marketplace uses a relative `source: "./"`, which only resolves when the marketplace is
> added **via the git repo** (GitHub/GitLab/git URL), as shown above — **not** via a
> direct URL to a raw `marketplace.json` file (a raw-URL add downloads only the manifest,
> not the plugin files).

### Local / development

```bash
claude --plugin-dir ./cue
```

or add the local marketplace from inside Claude Code:

```text
/plugin marketplace add ./cue
/plugin install cue@cue-marketplace
```

**Requirements:** Node.js (already present for Claude Code). Zero runtime dependencies.

## Identity

The notification **title** is resolved once per session (and cached), in this order:

1. **`CUE_NAME`** env var, if set — used verbatim. Great for naming a session:
   ```bash
   CUE_NAME=redactr-proxy claude
   ```
2. **Claude Code's session title**, if one can be read from the transcript.
3. Otherwise, the **first three words** of your first message, e.g.
   `refactor the auth — Claude session`.
4. Fallback: a short slice of the session id.

The **body** is `Waiting for you`, plus an optional `repo:branch` line derived from the
working directory and `git branch --show-current` (toggle with `showRepoBranch`).

## Configuration

Optional file at `~/.cue/config.json` (or `$XDG_STATE_HOME/cue/config.json`). All keys
are optional; defaults shown:

```json
{
  "autoModes": ["bypassPermissions", "auto", "dontAsk"],
  "throttleSeconds": 5,
  "sound": true,
  "showRepoBranch": true,
  "quietHours": null,
  "tabTitleMarker": false
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `autoModes` | `["bypassPermissions", "auto", "dontAsk"]` | Which `permission_mode` values count as "unattended" and so notify. These three never prompt you back. Add `"acceptEdits"` to include it too. |
| `throttleSeconds` | `5` | If any Cue notification played a sound within this window, the next one is silent (still shows). Coalescing is atomic across simultaneous idles. |
| `sound` | `true` | Master switch for sound. |
| `showRepoBranch` | `true` | Append a `repo:branch` subtitle. Silently omitted if `git` fails. |
| `quietHours` | `null` | e.g. `{ "start": "22:00", "end": "08:00" }` — suppress **sound** during this window (still notifies). Handles overnight wrap. |
| `tabTitleMarker` | `false` | Intended to set the terminal tab title to a waiting marker. **Currently inert:** the idle hook runs `async`, and Claude Code does not parse an async hook's stdout, so the `terminalSequence` it returns is ignored. Reserved for a future delivery path; leave off. |

`CUE_NAME` (env var) overrides the identity per session.

## Per-platform notes

- **macOS (primary).** Best experience with [`terminal-notifier`](https://github.com/julienXX/terminal-notifier):
  ```bash
  brew install terminal-notifier
  ```
  It enables per-session grouping/replacement and sound. Without it, Cue falls back to
  `osascript` (built in) — notifications work, with fewer options.
- **Linux.** Needs `notify-send` (`libnotify`):
  ```bash
  sudo apt install libnotify-bin     # Debian/Ubuntu
  ```
  Each session uses a synchronous replace hint so its notification replaces its prior one.
- **Windows.** Uses [BurntToast](https://github.com/Windos/BurntToast) if installed
  (`Install-Module BurntToast`), otherwise a raw WinRT toast via PowerShell. Per-session
  `Group`/`Tag` for grouping/replacement.

All notifier failures are swallowed silently — Cue never surfaces an error that would
nag you.

## Clicking a notification (not yet)

Cue's notifications are **not clickable to jump back to a session** in v1. Reliable
click-to-focus doesn't exist across the full range of setups people run: the macOS
`osascript` fallback has no click handler at all, `notify-send` click callbacks need a
long-lived process (our hooks are short-lived), and even where a click *can* fire an
action it can't reliably focus the exact terminal tab/pane of a specific session — that
part is emulator-specific (Terminal, iTerm2, tmux, WezTerm, VS Code all differ). Rather
than ship a click that sometimes focuses the wrong window, Cue ships none.

What it *does* do: at `Stop` time it records best-effort focus hints in each session's
state file (`terminal`: `termProgram`, tmux pane, iTerm session id, etc.). That's purely
forward-compatible groundwork — nothing acts on it today — so a future focus feature can
be built without changing the on-disk format.

## Troubleshooting

- **No notification?** Confirm the session is in an unattended mode (`bypassPermissions`,
  `auto`, or `dontAsk`) — or whatever you've set in `autoModes`. A `Stop` must have
  happened at least once so the mode was stashed.
- **Inspect hook activity:** press **Ctrl+O** for verbose output, or launch with
  `claude --debug-file /tmp/claude.log` and check the log.
- **Inspect Cue's state:** look at `~/.cue/state/<session_id>.json` — it records
  `permissionMode`, `status`, `identity`, and timestamps.
- **macOS shows nothing:** check System Settings → Notifications for Terminal/iTerm/Script
  Editor (osascript) or `terminal-notifier`, and that Do Not Disturb / Focus is off.
- **Too many sounds / too few:** tune `throttleSeconds`, or set `quietHours`.

## Development

```bash
node --test               # run the suite (node:test, zero deps)
claude plugin validate .  # from the repo root (the repo root IS the plugin root)
```

(From the *parent* directory, the equivalent is `claude plugin validate ./cue`.)

## License

MIT — see [LICENSE](./LICENSE).
