<h1 align="center">Cue</h1>

<p align="center">
  <strong>A desktop ping when an unattended Claude Code session goes idle waiting for you — built for many parallel sessions.</strong>
</p>

<p align="center">
  <a href="https://github.com/claudecue/cue/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/claudecue/cue/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-d97757">
  <img alt="Node ≥18" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white">
  <img alt="Dependencies: 0" src="https://img.shields.io/badge/dependencies-0-brightgreen">
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-supported-blue">
</p>

When a Claude Code session runs in an **unattended** permission mode (`bypassPermissions`,
`auto`, or `dontAsk`) nothing prompts you back, so the only "your turn" moment is when the
session finishes and the prompt sits waiting. Cue notices that, works out *which* session
it is, and sends a desktop notification titled with that session's name — and when several
sessions go idle at once you get one notification each but only a single sound.

## Getting started

### Prerequisites

- **`node` on your PATH** — Cue's hooks run `node` (check with `node --version`).
- **A notifier for your OS:**
  - **macOS:** `brew install terminal-notifier` (recommended). Without it, Cue uses
    built-in `osascript`.
  - **Linux:** `notify-send` — `sudo apt install libnotify-bin` (or your distro's package).
  - **Windows:** `Install-Module BurntToast` (else a built-in WinRT toast is used).

No npm dependencies — nothing to install for the plugin itself.

### Install

Inside Claude Code:

```text
/plugin marketplace add claudecue/cue
/plugin install cue@cue-marketplace
/reload-plugins
```

The hooks ship inside the plugin and **activate automatically** — you never edit
`settings.json`. It installs **enabled by default** to your user scope, with no restart
needed. Disable or re-enable any time with `/plugin disable cue@cue-marketplace` and
`/plugin enable cue@cue-marketplace`.

> Add the marketplace **via the git repo** (`claudecue/cue`), not a raw `marketplace.json`
> URL — the plugin source is relative and only resolves from the cloned repo.

### Grant the notification permission

The first time Cue posts a notification your OS asks whether to allow it (on macOS this is
for **terminal-notifier**). Click **Allow** and make sure Focus / Do Not Disturb is off.

### Verify

1. Run `/hooks` and confirm Cue's `Notification` and `Stop` entries appear.
2. Start an unattended session: `claude --permission-mode bypassPermissions`.
3. Give Claude a quick task, let it finish, and step away. When the prompt goes idle you
   get a notification titled with the session's name.

## Usage

### Which sessions notify

By default Cue notifies for the three unattended modes — `bypassPermissions`, `auto`, and
`dontAsk`. Sessions in `default`, `plan`, or `acceptEdits` don't notify (you're expected to
be present). Change this with `autoModes` (below).

### Name a session

The notification **title** identifies the session, resolved once and cached:

1. **`CUE_NAME`**, if set — used verbatim. The easiest way to label a session:
   ```bash
   CUE_NAME=redactr-proxy claude
   ```
2. Otherwise Claude Code's session title, if available.
3. Otherwise the first few words of your first message (e.g. `refactor the auth — Claude session`).

The **body** is `Waiting for you`, plus an optional `repo:branch` line from the working
directory and current git branch. Clicking a notification just dismisses it.

### Configuration

Optional file at `~/.cue/config.json` (or `$XDG_STATE_HOME/cue/config.json`). All keys are
optional; defaults shown:

```json
{
  "autoModes": ["bypassPermissions", "auto", "dontAsk"],
  "throttleSeconds": 5,
  "sound": true,
  "showRepoBranch": true,
  "clickToFocus": true,
  "quietHours": null,
  "tabTitleMarker": false
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `autoModes` | `["bypassPermissions","auto","dontAsk"]` | Which permission modes notify. Add `"acceptEdits"` to include it. |
| `throttleSeconds` | `5` | If a Cue notification played a sound within this window, the next one is silent (still shows). |
| `sound` | `true` | Master switch for sound. |
| `showRepoBranch` | `true` | Append a `repo:branch` subtitle. Omitted silently if `git` fails. |
| `clickToFocus` | `true` | Clicking a notification brings that session's terminal/editor app to the front (macOS + `terminal-notifier` only; no-op if the app can't be identified). It brings the *app* forward, not the exact tab. |
| `quietHours` | `null` | e.g. `{ "start": "22:00", "end": "08:00" }` — suppress sound during this window (still notifies). Handles overnight wrap. |
| `tabTitleMarker` | `false` | Reserved; off by default. |

`CUE_NAME` (env var) overrides the title per session.

### Make notifications stay on screen (macOS)

macOS shows notifications as **banners**, which auto-dismiss. To make Cue's notifications
persist until you act on them, set the delivering app to **Alerts**: System Settings →
Notifications → **terminal-notifier** → notification style **Alerts**. (This is a macOS
per-app setting, not something the plugin can set for you.)

## Contributing

Contributions are welcome.

```bash
git clone https://github.com/claudecue/cue.git
cd cue
node --test               # run the test suite (Node's built-in test runner)
claude plugin validate .  # validate the plugin manifests
```

- **Zero runtime dependencies, pure Node (ESM).** Please keep it dependency-free.
- **Tests** use `node:test` / `node:assert` — add coverage for new behavior.
- **CI** runs `node --test` on macOS, Linux, and Windows (Node 20 & 22) plus manifest
  validation on every pull request; all checks must pass.
- **`main` is protected:** open a pull request from a branch — direct pushes and force
  pushes are blocked, and a review plus green CI are required before merge.

## License

MIT — see [LICENSE](./LICENSE).
