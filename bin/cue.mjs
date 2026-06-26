#!/usr/bin/env node
// Cue entrypoint. Dispatched by subcommand:
//   stash-mode  (Stop hook)         -> record this session's permission_mode
//   idle        (Notification hook) -> notify if the session is in an auto mode
//
// Both hooks run with "async": true. Everything is wrapped so the process is
// idempotent, time-bounded, and fail-silent, and always exits 0.

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';

import { baseDir, loadConfig, readState, writeState } from '../lib/state.mjs';
import { isAutoMode } from '../lib/mode.mjs';
import { resolveIdentity } from '../lib/identity.mjs';
import { claimSound, inQuietHours } from '../lib/throttle.mjs';
import { send } from '../lib/notify.mjs';
import { terminalHints } from '../lib/terminal.mjs';

// Read the hook payload from stdin (fd 0). Payloads are small JSON objects.
function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function nowMs() {
  return Date.now();
}

function gitBranch(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

function handleStashMode(payload, dir) {
  const sessionId = payload.session_id;
  if (!sessionId) return;
  const mode = payload.permission_mode;
  if (!mode) return; // nothing to stash
  writeState(
    sessionId,
    {
      permissionMode: mode,
      cwd: payload.cwd || readState(sessionId, { dir })?.cwd,
      status: 'working',
      lastEventAt: nowMs(),
      // Forward-compatible groundwork for a future focus feature; v1 never reads it.
      terminal: terminalHints(process.env),
    },
    { dir },
  );
}

function handleIdle(payload, dir) {
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const config = loadConfig(dir);
  const prior = readState(sessionId, { dir });
  const stashedMode = prior?.permissionMode;

  if (!isAutoMode(stashedMode, config.autoModes)) return; // not an auto-mode session

  // Identity is cached per session (it never changes within a session).
  let identity = prior?.identity;
  if (!identity) {
    identity = resolveIdentity({
      sessionId,
      transcriptPath: payload.transcript_path,
      env: process.env,
    });
  }

  const cwd = payload.cwd || prior?.cwd || process.cwd();

  // Body: status line + optional repo:branch subtitle.
  let repo = null;
  let branch = null;
  let subtitle = '';
  if (config.showRepoBranch) {
    repo = basename(cwd);
    branch = gitBranch(cwd);
    if (repo && branch) subtitle = `${repo}:${branch}`;
    else if (repo) subtitle = repo;
  }

  // Sound decision: globally on, not in quiet hours, and wins the throttle.
  const now = nowMs();
  let sound = false;
  if (config.sound && !inQuietHours(now, config.quietHours)) {
    sound = claimSound({ dir, nowMs: now, throttleSeconds: config.throttleSeconds });
  }

  send({
    platform: process.platform,
    title: identity,
    body: 'Waiting for you',
    subtitle,
    sessionId,
    sound,
  });

  writeState(
    sessionId,
    {
      identity,
      cwd,
      repo,
      branch,
      status: 'idle',
      lastEventAt: now,
      lastNotifiedAt: now,
    },
    { dir },
  );

  // Optional tab-title marker, off by default and config-gated. NOTE: this hook
  // runs async, and Claude Code does not parse an async hook's stdout, so the
  // terminalSequence below is currently ignored — the feature is inert until a
  // synchronous delivery path exists (documented in README/PLAN). Kept behind
  // the flag so the wiring is ready. OSC 0 = set icon name + window title; built
  // from char codes so the raw ESC (0x1b) / BEL (0x07) bytes aren't in source.
  if (config.tabTitleMarker) {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    const seq = `${ESC}]0;⏳ ${identity}${BEL}`;
    process.stdout.write(JSON.stringify({ terminalSequence: seq }));
  }
}

function main() {
  try {
    const sub = process.argv[2];
    const payload = readStdin();
    const dir = baseDir();
    if (sub === 'stash-mode') handleStashMode(payload, dir);
    else if (sub === 'idle') handleIdle(payload, dir);
  } catch {
    /* fail silent — never block the agent loop */
  }
  process.exit(0);
}

main();
