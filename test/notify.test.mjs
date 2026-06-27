import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCommand, findBinary } from '../lib/notify.mjs';

const base = {
  title: 'redactr-proxy',
  body: 'Waiting for you',
  subtitle: 'redactr:main',
  sessionId: 'sess-123',
  sound: true,
};

test('macOS: prefers terminal-notifier with group/title/subtitle/sound', () => {
  const { cmd, args } = buildCommand({
    platform: 'darwin',
    hasTerminalNotifier: true,
    ...base,
  });
  assert.equal(cmd, 'terminal-notifier');
  // argv pairs, not a shell string
  assert.ok(Array.isArray(args));
  assert.equal(args[args.indexOf('-title') + 1], 'redactr-proxy');
  assert.equal(args[args.indexOf('-message') + 1], 'Waiting for you');
  assert.equal(args[args.indexOf('-subtitle') + 1], 'redactr:main');
  assert.equal(args[args.indexOf('-group') + 1], 'cue-sess-123');
  assert.ok(args.includes('-sound'));
});

test('macOS: terminal-notifier adds -activate when a click target is given', () => {
  const { args } = buildCommand({
    platform: 'darwin',
    hasTerminalNotifier: true,
    ...base,
    activate: 'com.microsoft.VSCode',
  });
  assert.equal(args[args.indexOf('-activate') + 1], 'com.microsoft.VSCode');
});

test('macOS: no -activate when no click target', () => {
  const { args } = buildCommand({ platform: 'darwin', hasTerminalNotifier: true, ...base });
  assert.ok(!args.includes('-activate'));
});

test('macOS osascript fallback ignores activate (no click support, no crash)', () => {
  const { cmd, args } = buildCommand({
    platform: 'darwin',
    hasTerminalNotifier: false,
    ...base,
    activate: 'com.microsoft.VSCode',
  });
  assert.equal(cmd, 'osascript');
  assert.ok(!args.join(' ').includes('-activate'));
});

test('macOS: terminal-notifier omits -sound when silent', () => {
  const { args } = buildCommand({
    platform: 'darwin',
    hasTerminalNotifier: true,
    ...base,
    sound: false,
  });
  assert.ok(!args.includes('-sound'));
});

test('macOS: falls back to osascript when terminal-notifier absent', () => {
  const { cmd, args } = buildCommand({
    platform: 'darwin',
    hasTerminalNotifier: false,
    ...base,
  });
  assert.equal(cmd, 'osascript');
  assert.equal(args[0], '-e');
  const script = args[1];
  assert.ok(script.startsWith('display notification'));
  assert.ok(script.includes('"redactr-proxy"'));
  assert.ok(script.includes('"Waiting for you"'));
  assert.ok(script.includes('sound name'));
});

test('macOS osascript: escapes embedded quotes/backslashes (no AppleScript injection)', () => {
  const { args } = buildCommand({
    platform: 'darwin',
    hasTerminalNotifier: false,
    ...base,
    title: 'evil" & do shell script "rm -rf ~',
  });
  const script = args[1];
  // The raw unescaped attack substring must not appear; the quote must be escaped.
  assert.ok(!script.includes('evil" & do shell script'));
  assert.ok(script.includes('evil\\"'));
});

test('Linux: notify-send with per-session replace hint', () => {
  const { cmd, args } = buildCommand({
    platform: 'linux',
    ...base,
  });
  assert.equal(cmd, 'notify-send');
  assert.ok(args.some((a) => a.includes('x-canonical-private-synchronous:cue-sess-123')));
  // title and body are passed as plain argv (last two positional args)
  assert.ok(args.includes('redactr-proxy'));
  assert.ok(args.includes('Waiting for you'));
});

test('Linux: app name and urgency are set', () => {
  const { args } = buildCommand({ platform: 'linux', ...base });
  assert.ok(args.some((a) => a.startsWith('--app-name')));
  assert.ok(args.some((a) => a.startsWith('--urgency')));
});

test('Windows: uses BurntToast when available with per-session group/tag', () => {
  const { cmd, args } = buildCommand({
    platform: 'win32',
    hasBurntToast: true,
    ...base,
  });
  assert.match(cmd, /powershell|pwsh/i);
  const script = args[args.length - 1];
  assert.ok(/New-BurntToastNotification/i.test(script));
  assert.ok(script.includes('sess-123'));
});

test('Windows: raw WinRT toast fallback when BurntToast absent', () => {
  const { cmd, args } = buildCommand({
    platform: 'win32',
    hasBurntToast: false,
    ...base,
  });
  assert.match(cmd, /powershell|pwsh/i);
  const script = args[args.length - 1];
  assert.ok(/Windows\.UI\.Notifications|ToastNotification/i.test(script));
});

test('Windows: single quotes in identity are escaped for PowerShell', () => {
  const { args } = buildCommand({
    platform: 'win32',
    hasBurntToast: true,
    ...base,
    title: "Bob's session",
  });
  const script = args[args.length - 1];
  assert.ok(script.includes("Bob''s session"));
});

test('unknown platform returns null', () => {
  assert.equal(buildCommand({ platform: 'aix', ...base }), null);
});

// findBinary must locate a notifier even when it lives in a dir that is NOT on
// the (often minimal) non-interactive hook PATH — e.g. Homebrew's bin.
test('findBinary: finds a binary via an extra dir not on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cue-bin-'));
  const bin = join(dir, 'terminal-notifier');
  writeFileSync(bin, '#!/bin/sh\n');
  chmodSync(bin, 0o755);
  // PATH deliberately empty; the binary is only discoverable via extraDirs.
  const found = findBinary('terminal-notifier', { env: { PATH: '' }, extraDirs: [dir] });
  assert.equal(found, bin);
  rmSync(dir, { recursive: true, force: true });
});

test('findBinary: finds a binary on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cue-bin-'));
  const bin = join(dir, 'mybin');
  writeFileSync(bin, '');
  const found = findBinary('mybin', { env: { PATH: dir }, extraDirs: [] });
  assert.equal(found, bin);
  rmSync(dir, { recursive: true, force: true });
});

test('findBinary: returns null when nowhere to be found', () => {
  assert.equal(findBinary('definitely-not-a-real-binary-xyz', { env: { PATH: '' }, extraDirs: [] }), null);
});
