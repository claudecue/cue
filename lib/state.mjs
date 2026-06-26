// State directory, config, and per-session state files.
//
// Base dir: $XDG_STATE_HOME/cue if set, else ~/.cue.
//   <base>/config.json          user config (all keys optional)
//   <base>/last-sound.json      sound-throttle stamp (see throttle.mjs)
//   <base>/state/<id>.json      one record per session
//
// The session record schema is intentionally rich so a future "control tower"
// dashboard can read it without changes.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';

export function baseDir() {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg && xdg.trim() ? join(xdg, 'cue') : join(homedir(), '.cue');
}

export function stateSubdir(dir = baseDir()) {
  return join(dir, 'state');
}

export const DEFAULT_CONFIG = {
  // The unattended permission modes: nothing prompts the user back, so the only
  // "your turn" moment is when the session goes idle. acceptEdits still prompts
  // for non-filesystem commands, so it's opt-in rather than a default.
  autoModes: ['bypassPermissions', 'auto', 'dontAsk'],
  throttleSeconds: 5,
  sound: true,
  showRepoBranch: true,
  quietHours: null,
  tabTitleMarker: false,
};

export function loadConfig(dir = baseDir()) {
  try {
    const raw = readFileSync(join(dir, 'config.json'), 'utf8');
    const user = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...user };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function stateFile(sessionId, dir) {
  return join(stateSubdir(dir), `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

export function readState(sessionId, { dir = baseDir() } = {}) {
  try {
    return JSON.parse(readFileSync(stateFile(sessionId, dir), 'utf8'));
  } catch {
    return null;
  }
}

// Merge `patch` into the existing record (or a fresh one) and write atomically.
export function writeState(sessionId, patch, { dir = baseDir() } = {}) {
  const sub = stateSubdir(dir);
  ensureDir(sub);
  const existing = readState(sessionId, { dir }) || { sessionId };
  const record = { ...existing, ...patch, sessionId };
  const target = stateFile(sessionId, dir);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(record, null, 2));
    renameSync(tmp, target);
  } catch {
    /* fail silent */
  }
  return record;
}
