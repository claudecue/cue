import { test } from 'node:test';
import assert from 'node:assert/strict';

import { terminalHints, bundleIdFor } from '../lib/terminal.mjs';

// These hints are recorded in session state for a FUTURE focus/control-tower
// feature. v1 never acts on them — so the contract is just "describe the
// terminal accurately, invent nothing."

test('empty env yields no hints', () => {
  assert.deepEqual(terminalHints({}), {});
});

test('tmux: records the multiplexer and pane only when both vars are present', () => {
  const h = terminalHints({ TMUX: '/tmp/tmux-501/default,123,0', TMUX_PANE: '%3', TERM_PROGRAM: 'iTerm.app' });
  assert.equal(h.multiplexer, 'tmux');
  assert.equal(h.tmuxPane, '%3');
  assert.equal(h.termProgram, 'iTerm.app');
});

test('tmux without TMUX_PANE does not claim a pane', () => {
  const h = terminalHints({ TMUX: '/tmp/tmux-501/default,123,0' });
  assert.equal(h.multiplexer, undefined);
  assert.equal(h.tmuxPane, undefined);
});

test('iTerm2 session id is captured', () => {
  const h = terminalHints({ TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: 'w0t1p0:ABC' });
  assert.equal(h.termProgram, 'iTerm.app');
  assert.equal(h.itermSessionId, 'w0t1p0:ABC');
});

test('VS Code terminal is identified by TERM_PROGRAM', () => {
  const h = terminalHints({ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.99.0' });
  assert.equal(h.termProgram, 'vscode');
  assert.equal(h.termProgramVersion, '1.99.0');
});

test('WezTerm and kitty panes/windows are captured', () => {
  assert.equal(terminalHints({ WEZTERM_PANE: '7' }).weztermPane, '7');
  assert.equal(terminalHints({ KITTY_WINDOW_ID: '2' }).kittyWindowId, '2');
});

test('returns a plain object (safe to JSON-serialize into state)', () => {
  const h = terminalHints({ TERM_PROGRAM: 'Apple_Terminal' });
  assert.equal(typeof h, 'object');
  assert.doesNotThrow(() => JSON.stringify(h));
});

test('bundleIdFor: maps known TERM_PROGRAM values to app bundle ids', () => {
  assert.equal(bundleIdFor('vscode'), 'com.microsoft.VSCode');
  assert.equal(bundleIdFor('iTerm.app'), 'com.googlecode.iterm2');
  assert.equal(bundleIdFor('Apple_Terminal'), 'com.apple.Terminal');
  assert.equal(bundleIdFor('WezTerm'), 'com.github.wez.wezterm');
});

test('bundleIdFor: unknown or missing program returns null (no misfire)', () => {
  assert.equal(bundleIdFor('SomeUnknownTerm'), null);
  assert.equal(bundleIdFor(undefined), null);
  assert.equal(bundleIdFor(''), null);
});
