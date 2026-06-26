import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { claimSound, inQuietHours } from '../lib/throttle.mjs';
import { isAutoMode } from '../lib/mode.mjs';
import { DEFAULT_CONFIG } from '../lib/state.mjs';

// Every permission_mode value the live docs define (six, not four).
const ALL_MODES = ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'];

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'cue-thr-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SEC = 1000;

test('claimSound: first call plays', () => {
  const { dir, cleanup } = tmp();
  assert.equal(claimSound({ dir, nowMs: 1000 * SEC, throttleSeconds: 5 }), true);
  cleanup();
});

test('claimSound: second call within window is silent', () => {
  const { dir, cleanup } = tmp();
  assert.equal(claimSound({ dir, nowMs: 1000 * SEC, throttleSeconds: 5 }), true);
  assert.equal(claimSound({ dir, nowMs: 1003 * SEC, throttleSeconds: 5 }), false);
  cleanup();
});

test('claimSound: a call after the window plays again', () => {
  const { dir, cleanup } = tmp();
  assert.equal(claimSound({ dir, nowMs: 1000 * SEC, throttleSeconds: 5 }), true);
  assert.equal(claimSound({ dir, nowMs: 1006 * SEC, throttleSeconds: 5 }), true);
  cleanup();
});

test('claimSound: exactly at the window boundary plays', () => {
  const { dir, cleanup } = tmp();
  assert.equal(claimSound({ dir, nowMs: 1000 * SEC, throttleSeconds: 5 }), true);
  assert.equal(claimSound({ dir, nowMs: 1005 * SEC, throttleSeconds: 5 }), true);
  cleanup();
});

test('inQuietHours: null window is never quiet', () => {
  assert.equal(inQuietHours(Date.parse('2026-06-26T03:00:00'), null), false);
});

test('inQuietHours: same-day window (09:00-17:00)', () => {
  const w = { start: '09:00', end: '17:00' };
  assert.equal(inQuietHours(Date.parse('2026-06-26T10:30:00'), w), true);
  assert.equal(inQuietHours(Date.parse('2026-06-26T08:59:00'), w), false);
  assert.equal(inQuietHours(Date.parse('2026-06-26T17:00:00'), w), false); // end exclusive
});

test('inQuietHours: overnight wrap window (22:00-08:00)', () => {
  const w = { start: '22:00', end: '08:00' };
  assert.equal(inQuietHours(Date.parse('2026-06-26T23:30:00'), w), true);
  assert.equal(inQuietHours(Date.parse('2026-06-26T02:00:00'), w), true);
  assert.equal(inQuietHours(Date.parse('2026-06-26T12:00:00'), w), false);
});

test('isAutoMode: bypassPermissions is auto by default', () => {
  assert.equal(isAutoMode('bypassPermissions', ['bypassPermissions']), true);
});

test('isAutoMode: default / plan / acceptEdits are not auto by default', () => {
  const def = ['bypassPermissions'];
  assert.equal(isAutoMode('default', def), false);
  assert.equal(isAutoMode('plan', def), false);
  assert.equal(isAutoMode('acceptEdits', def), false);
});

test('isAutoMode: acceptEdits can be opted into via config', () => {
  assert.equal(isAutoMode('acceptEdits', ['bypassPermissions', 'acceptEdits']), true);
});

test('isAutoMode: missing/never-stashed mode is not auto', () => {
  assert.equal(isAutoMode(null, ['bypassPermissions']), false);
  assert.equal(isAutoMode(undefined, ['bypassPermissions']), false);
});

test('default config: the three unattended modes notify, the others do not', () => {
  // The unattended modes — nothing prompts the user back, so idle is their only
  // "your turn" moment.
  for (const m of ['bypassPermissions', 'auto', 'dontAsk']) {
    assert.equal(isAutoMode(m, DEFAULT_CONFIG.autoModes), true, `${m} should notify by default`);
  }
  // The attended modes — the user is expected to be present.
  for (const m of ['default', 'plan', 'acceptEdits']) {
    assert.equal(isAutoMode(m, DEFAULT_CONFIG.autoModes), false, `${m} should not notify by default`);
  }
});

test('every documented permission_mode value resolves to a boolean (no crash on the full enum)', () => {
  for (const m of ALL_MODES) {
    assert.equal(typeof isAutoMode(m, DEFAULT_CONFIG.autoModes), 'boolean');
  }
});

// Regression test for the throttle race: when many idle handlers fire at once,
// exactly one must win the sound. Spawns real processes against a shared dir.
test('claimSound: only one of many concurrent processes plays the sound', async () => {
  const { dir, cleanup } = tmp();
  // Pass a file:// URL (not a raw fs path) so dynamic import() works on Windows too.
  const throttleUrl = new URL('../lib/throttle.mjs', import.meta.url).href;
  const N = 12;
  const code =
    `import(${JSON.stringify(throttleUrl)}).then((m) => {` +
    `const r = m.claimSound({ dir: process.env.CUE_TEST_DIR, nowMs: Date.now(), throttleSeconds: 5 });` +
    `process.stdout.write(r ? 'PLAY' : 'SILENT'); });`;

  const run = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, CUE_TEST_DIR: dir },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => resolve(out.trim()));
    });

  const results = await Promise.all(Array.from({ length: N }, run));
  const plays = results.filter((r) => r === 'PLAY').length;
  assert.equal(plays, 1, `expected exactly 1 PLAY, got ${plays} from ${JSON.stringify(results)}`);
  cleanup();
});
