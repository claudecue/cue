# Cue — Implementation Plan

A Claude Code plugin that fires a desktop notification when an **auto-mode**
session goes idle waiting for the human, designed to behave well with many
parallel sessions.

## Platform facts (verified against live docs 2026-06-26)

Checked against https://code.claude.com/docs/en/hooks, `.../hooks-guide`,
`.../plugins-reference`, and `.../plugin-marketplaces`.

| Claim | Result |
| --- | --- |
| `Notification` event with `idle_prompt` matcher fires on ~idle prompt | **Confirmed.** Matchers: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_*`. |
| `Notification` payload has `session_id`, `transcript_path`, `cwd`, `message`, **no** `permission_mode` | **Confirmed.** This is exactly why we stash mode on `Stop`. |
| `Stop` payload carries `permission_mode` | **Inferred (fails safe).** Docs list `permission_mode` as a common field present "for events that fire within a tool-use context, such as PreToolUse, PostToolUse, Stop, SubagentStop," but show no published `Stop` JSON example. Our design fails safe if it's absent (no stash ⇒ no notify), so this is the only inference in the design. |
| `permission_mode` enum | **Confirmed — six values, not four:** `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`. The unattended ones (no prompt pulls the user back) are `bypassPermissions`, `auto`, and `dontAsk` — these are the default `autoModes`. `acceptEdits` still prompts for non-filesystem Bash, so it's opt-in. `default`/`plan` never notify. |
| `async: true` stdout is ignored | **Confirmed.** "Runs in the background without blocking" — its stdout is **not** parsed. So the optional `tabTitleMarker` (which returns `terminalSequence` on stdout) is a no-op on the async idle hook. See deviation #5. |
| `idle_prompt` fire timing | **Not documented.** Docs only list `idle_prompt` as a Notification matcher; they don't define whether it fires immediately on completion or after an idle delay. The README no longer claims a specific "~60s stepped away" timing (deviation #6). |
| `transcript_path` points to a `.jsonl` conversation transcript | **Confirmed** ("Path to conversation JSON"). Per-record schema is **not** documented; we parse defensively (see Identity). |
| `"async": true` makes a command hook non-blocking | **Confirmed** (exact key on the command-hook schema). |
| Hook config shape `{ matcher?, hooks: [{type:"command", command, async}] }`; `matcher` omittable for `Stop` | **Confirmed.** |
| `${CLAUDE_PLUGIN_ROOT}` expands to the plugin install dir inside hook commands | **Confirmed.** |
| Components live at plugin root; `hooks/hooks.json` is auto-discovered | **Confirmed.** Only `plugin.json` lives in `.claude-plugin/`. |
| `plugin.json`: `author` is an **object**, `repository` is a **string** | **Confirmed.** |
| `marketplace.json`: `name` + `owner{name,email?}` + `plugins[]`; each entry needs `name` + `source`; `source:"./"` = marketplace root | **Confirmed.** Reserved names enumerated (avoid Anthropic-impersonating names). |
| `terminalSequence` is a real hook-stdout output field | **Confirmed** — used for the optional tab-title marker. |
| `claude plugin validate <path>` exists | **Confirmed.** Local install via `/plugin marketplace add ./cue` + `/plugin install cue@<marketplace>`. |

### Deviations from the brief

1. **Identity fallback separator.** The prose says *first three words + `" Claude session"`*
   but the worked example shows `refactor the auth — Claude session`. The example is
   user-facing, so we emit `<three words> — Claude session` (em-dash separator).
2. **Stop `permission_mode` ambiguity.** Docs list `permission_mode` as a common field
   but don't print the full `Stop` schema. We treat it as present (per brief) and the
   stash handler is defensive: if absent it simply records nothing, and idle gating then
   fails safe (no notification). Documented so a future doc change is easy to spot.
3. **Config loading** lives in `lib/state.mjs` (`loadConfig`) rather than a separate
   `config.mjs`, to keep to the brief's lib file list.
4. Marketplace and plugin are **co-located** in one repo (single-plugin self-hosted
   marketplace): `source: "./"` makes the marketplace root the plugin root. `version` is
   set **only** in `plugin.json` (docs warn against duplicating it in the entry).
5. **`tabTitleMarker` is inert under the async hook.** `async: true` means the hook's
   stdout is not parsed, so the `terminalSequence` output never reaches Claude Code. The
   feature stays config-gated and off by default; the README documents that it currently
   has no effect (delivering it would require a synchronous hook, which would risk
   blocking the agent loop — not worth it for an off-by-default marker).
6. **Idle timing is not promised.** The brief asserted the idle signal "encodes that
   you've stepped away (~60s)"; the docs don't define `idle_prompt` timing, so the README
   describes the trigger as "the session is done and the prompt is waiting" and relies on
   the auto-mode gate + sound throttle rather than a timing guarantee.

### Post-build audit fixes (verified against live docs)

- **Throttle race (was unhandled):** `claimSound` now wraps its read-check-write in a
  cross-process mutex (atomic `O_EXCL` lock file with stale-steal), so N simultaneous
  idles yield exactly one sound. Covered by a real multi-process regression test.
- **Mode enum / default set:** corrected to six values; default `autoModes` now
  `["bypassPermissions", "auto", "dontAsk"]`. Gating test exercises the full enum.
- **Click-to-focus:** deliberately **not** shipped. Held to a "100% smooth for every
  user" bar, no click path qualifies (osascript has no click handler; `notify-send`
  callbacks need a long-lived process; exact tab/pane focus is emulator-specific). Added
  `lib/terminal.mjs` (`terminalHints`) instead, recording focus hints (`termProgram`,
  tmux pane, iTerm/WezTerm/kitty ids) into session state at `Stop` time — forward-
  compatible groundwork the future control tower can use, with zero v1 behavior. Covered
  by `test/terminal.test.mjs`.

## Architecture

One Node entrypoint `bin/cue.mjs`, dispatched by subcommand (`idle` | `stash-mode`).
Pure, unit-testable helpers in `lib/`. Zero runtime dependencies, ESM, fail-silent,
always exit 0.

```
Stop hook  ──> cue.mjs stash-mode ──> state/<id>.json { permissionMode, status:working }
Notification(idle_prompt) ──> cue.mjs idle ──> read state ──> gate on auto mode
                                              ──> resolve+cache identity
                                              ──> claim sound (throttle/quiet hours)
                                              ──> deliver platform notification
                                              ──> state/<id>.json { status:idle, lastNotifiedAt }
```

### lib/state.mjs
- `baseDir()` → `$XDG_STATE_HOME/cue` if set else `~/.cue`.
- `loadConfig(dir)` → defaults merged with `<dir>/config.json`.
  Defaults: `autoModes:["bypassPermissions"]`, `throttleSeconds:5`, `sound:true`,
  `showRepoBranch:true`, `quietHours:null`, `tabTitleMarker:false`.
- `readState(sessionId,{dir})` → object|null.
- `writeState(sessionId, patch,{dir})` → merges patch into existing record, atomic
  write (tmp + rename). Record: `{ sessionId, identity, cwd, repo, branch,
  permissionMode, status, lastEventAt, lastNotifiedAt, terminal }` (forward-compatible
  for a future control tower; `terminal` holds focus hints from `lib/terminal.mjs`).

### lib/mode.mjs
- `isAutoMode(stashedMode, autoModes)` → boolean. `null`/missing ⇒ `false`.

### lib/identity.mjs
- `iterLines(path,{maxBytes})` — generator, chunked sync read, stops early (never
  slurps a whole large transcript).
- `extractFirstUserText(path)` — first usable user message: handles string content,
  block-array content (`{type:"text",text}`), skips slash-command (`/…`) and
  tag/system noise (`<…>`) and tool-result-only messages; collapses whitespace.
- `extractSessionTitle(path)` — best-effort Claude title from a `summary` record.
- `resolveIdentity({sessionId, transcriptPath, env})` — precedence:
  `env.CUE_NAME` → session title → `<3 words> — Claude session` → `session_id` slice.

### lib/throttle.mjs
- `inQuietHours(nowMs, quietHours)` — `"HH:MM"` window, handles midnight wrap.
- `claimSound({dir, nowMs, throttleSeconds})` — true if no Cue sound played within
  the window; records the timestamp in `last-sound.json` when it returns true.

### lib/notify.mjs
- `buildCommand({platform,title,body,subtitle,sessionId,sound,hasTerminalNotifier,hasBurntToast})`
  → `{cmd, args[]}` (pure; no shell string). macOS terminal-notifier vs osascript,
  Linux notify-send (per-session replace hint), Windows BurntToast vs raw WinRT toast.
- `send(opts)` — detects notifier availability, builds argv, spawns detached via
  `child_process` (no shell), swallows all errors.

### bin/cue.mjs
- Read stdin JSON, dispatch on `argv[2]`, everything in try/catch, exit 0.
- `stash-mode`: record `permissionMode`, `cwd`, `status:'working'`, `lastEventAt`.
- `idle`: gate on auto mode → resolve/cache identity → build body
  (`Waiting for you` + optional `repo:branch` from cwd basename + `git branch
  --show-current`) → sound = `config.sound && !quietHours && claimSound` → deliver →
  update state `status:'idle'`, `lastNotifiedAt`. If `tabTitleMarker`, print
  `{terminalSequence}` JSON on stdout.

## Tests (node --test, node:test + node:assert, no deps)

- `test/identity.test.mjs` — string content; block-array content; slash-command first
  line skipped; tag/system noise skipped; tool-result-only skipped; empty/short;
  missing file; precedence (CUE_NAME override, summary title, three-words, sessionId
  fallback).
- `test/throttle.test.mjs` — `claimSound` window (mock clock, temp dir): first plays,
  second within window silent, after window plays again; `inQuietHours` non-wrap & wrap
  & null; `isAutoMode` for each `permission_mode` value and missing stash.
- `test/notify.test.mjs` — `buildCommand` argv per platform: macOS terminal-notifier
  (group/subtitle/sound) & osascript fallback (AppleScript escaping); Linux notify-send
  replace hint; Windows BurntToast & raw-toast; no shell metacharacter leakage from a
  malicious identity.

## Packaging

```
cue/
├── .claude-plugin/{plugin.json, marketplace.json}
├── hooks/hooks.json
├── bin/cue.mjs
├── lib/{identity,mode,notify,throttle,state,terminal}.mjs
├── test/{identity,throttle,notify,terminal}.test.mjs
├── LICENSE (MIT)
└── README.md
```

## Sequencing

1. PLAN.md (this). 2. Scaffold dirs + manifests + hooks.json. 3. TDD each lib module
   (red → green). 4. Wire `bin/cue.mjs`. 5. `node --test` green. 6. `claude plugin
   validate ./cue` clean. 7. README + LICENSE. 8. Manual smoke test.

## Definition of done

- [ ] `PLAN.md` written and followed.
- [ ] All tests pass via `node --test`.
- [ ] `claude plugin validate .` clean (run from the repo root, which *is* the plugin
      root; `claude plugin validate ./cue` only works from the parent dir).
- [ ] macOS smoke: bypassPermissions session idle ≥60s → notification titled with identity.
- [ ] Two sessions idle within window → two notifications, one sound.
- [ ] `default`-mode session idle → no notification.
- [ ] README + LICENSE + both manifests present; installable from a fresh clone.
