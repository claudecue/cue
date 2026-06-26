// Sound throttle and quiet hours.
//
// The throttle coalesces sound across simultaneous idles: if any Cue
// notification played a sound within the window, the next one shows silently.
// The notification still appears — only the sound is suppressed.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const SOUND_FILE = 'last-sound.json';
const LOCK_FILE = 'last-sound.lock';

function readLastSound(dir) {
  try {
    const raw = readFileSync(join(dir, SOUND_FILE), 'utf8');
    const obj = JSON.parse(raw);
    return typeof obj.ts === 'number' ? obj.ts : 0;
  } catch {
    return 0;
  }
}

function writeLastSound(dir, ts) {
  const target = join(dir, SOUND_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ ts }));
    renameSync(tmp, target);
  } catch {
    /* fail silent */
  }
}

// A synchronous sleep (hooks run as short-lived processes; this only spins
// during the rare millisecond-scale lock contention between simultaneous idles).
function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable; skip the wait */
  }
}

// Acquire a cross-process mutex by atomically creating a lock file (O_EXCL only
// succeeds for the one process that wins the race). Returns a release function,
// or null if the lock couldn't be taken. A stale lock (holder crashed) older
// than staleMs is stolen.
function acquireLock(dir, nowMs, staleMs) {
  const lockPath = join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx'); // atomic exclusive create
      return () => {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      };
    } catch {
      try {
        const age = nowMs - statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          unlinkSync(lockPath);
          continue; // retry immediately after stealing a stale lock
        }
      } catch {
        /* lock vanished between open and stat; retry */
      }
      sleepMs(8);
    }
  }
  return null;
}

// Returns true if this notification may play a sound (and records the stamp);
// false if a sound played within the throttle window. The read-check-write is
// guarded by a cross-process lock so that when N sessions idle simultaneously
// exactly one wins the sound — the coalescing the whole feature depends on.
export function claimSound({ dir, nowMs, throttleSeconds }) {
  const windowMs = Math.max(0, Number(throttleSeconds) || 0) * 1000;
  const release = acquireLock(dir, nowMs, Math.max(windowMs, 3000));
  // Couldn't get the lock — another process is deciding right now. Stay silent
  // rather than risk a double sound (fail toward fewer sounds, not more).
  if (!release) return false;
  try {
    const last = readLastSound(dir);
    if (last && nowMs - last < windowMs) return false;
    writeLastSound(dir, nowMs);
    return true;
  } finally {
    release();
  }
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Is the local time of `nowMs` inside the quiet-hours window? Handles a window
// that wraps past midnight (start > end). End is exclusive.
export function inQuietHours(nowMs, quietHours) {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;
  const start = parseHHMM(quietHours.start);
  const end = parseHHMM(quietHours.end);
  if (start === null || end === null) return false;

  const d = new Date(nowMs);
  const cur = d.getHours() * 60 + d.getMinutes();

  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // wraps midnight
}
