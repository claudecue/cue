import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractFirstUserText,
  extractSessionTitle,
  resolveIdentity,
} from '../lib/identity.mjs';

// Build a .jsonl transcript file from an array of records and return its path.
function transcript(records) {
  const dir = mkdtempSync(join(tmpdir(), 'cue-id-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('extractFirstUserText: plain string content', () => {
  const { path, cleanup } = transcript([
    { type: 'user', message: { role: 'user', content: 'refactor the auth module please' } },
  ]);
  assert.equal(extractFirstUserText(path), 'refactor the auth module please');
  cleanup();
});

test('extractFirstUserText: block-array content extracts text blocks', () => {
  const { path, cleanup } = transcript([
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'fix the flaky test' },
          { type: 'image', source: {} },
        ],
      },
    },
  ]);
  assert.equal(extractFirstUserText(path), 'fix the flaky test');
  cleanup();
});

test('extractFirstUserText: skips a slash-command first message', () => {
  const { path, cleanup } = transcript([
    { type: 'user', message: { role: 'user', content: '/clear' } },
    { type: 'user', message: { role: 'user', content: 'add a dark mode toggle' } },
  ]);
  assert.equal(extractFirstUserText(path), 'add a dark mode toggle');
  cleanup();
});

test('extractFirstUserText: skips tag/system noise (e.g. <command-name>)', () => {
  const { path, cleanup } = transcript([
    { type: 'user', message: { role: 'user', content: '<command-name>/init</command-name>' } },
    { type: 'user', message: { role: 'user', content: 'write the changelog' } },
  ]);
  assert.equal(extractFirstUserText(path), 'write the changelog');
  cleanup();
});

test('extractFirstUserText: skips tool-result-only user messages', () => {
  const { path, cleanup } = transcript([
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'x', content: 'output' }],
      },
    },
    { type: 'user', message: { role: 'user', content: 'now ship it' } },
  ]);
  assert.equal(extractFirstUserText(path), 'now ship it');
  cleanup();
});

test('extractFirstUserText: collapses internal whitespace', () => {
  const { path, cleanup } = transcript([
    { type: 'user', message: { role: 'user', content: '  build\t the   thing\n' } },
  ]);
  assert.equal(extractFirstUserText(path), 'build the thing');
  cleanup();
});

test('extractFirstUserText: missing file returns null', () => {
  assert.equal(extractFirstUserText('/no/such/transcript.jsonl'), null);
});

test('extractFirstUserText: no usable user text returns null', () => {
  const { path, cleanup } = transcript([
    { type: 'assistant', message: { role: 'assistant', content: 'hi' } },
  ]);
  assert.equal(extractFirstUserText(path), null);
  cleanup();
});

test('extractSessionTitle: reads a summary record', () => {
  const { path, cleanup } = transcript([
    { type: 'summary', summary: 'Auth refactor session' },
    { type: 'user', message: { role: 'user', content: 'hello' } },
  ]);
  assert.equal(extractSessionTitle(path), 'Auth refactor session');
  cleanup();
});

test('extractSessionTitle: none present returns null', () => {
  const { path, cleanup } = transcript([
    { type: 'user', message: { role: 'user', content: 'hello' } },
  ]);
  assert.equal(extractSessionTitle(path), null);
  cleanup();
});

test('resolveIdentity: CUE_NAME overrides everything', () => {
  const { path, cleanup } = transcript([
    { type: 'summary', summary: 'A Title' },
    { type: 'user', message: { role: 'user', content: 'something else entirely' } },
  ]);
  const id = resolveIdentity({
    sessionId: 'abc123def456',
    transcriptPath: path,
    env: { CUE_NAME: 'redactr-proxy' },
  });
  assert.equal(id, 'redactr-proxy');
  cleanup();
});

test('resolveIdentity: uses session title when no CUE_NAME', () => {
  const { path, cleanup } = transcript([
    { type: 'summary', summary: 'Billing bugfix' },
    { type: 'user', message: { role: 'user', content: 'fix the billing bug' } },
  ]);
  const id = resolveIdentity({ sessionId: 'abc123def456', transcriptPath: path, env: {} });
  assert.equal(id, 'Billing bugfix');
  cleanup();
});

test('resolveIdentity: falls back to first three words + marker', () => {
  const { path, cleanup } = transcript([
    { type: 'user', message: { role: 'user', content: 'refactor the auth layer and tidy imports' } },
  ]);
  const id = resolveIdentity({ sessionId: 'abc123def456', transcriptPath: path, env: {} });
  assert.equal(id, 'refactor the auth — Claude session');
  cleanup();
});

test('resolveIdentity: falls back to session id slice when no user text', () => {
  const { path, cleanup } = transcript([
    { type: 'assistant', message: { role: 'assistant', content: 'hi' } },
  ]);
  const id = resolveIdentity({ sessionId: 'abcdef1234567890', transcriptPath: path, env: {} });
  assert.ok(id.includes('abcdef12'), `expected session-id slice, got: ${id}`);
  cleanup();
});

test('resolveIdentity: no transcript at all still yields a non-empty identity', () => {
  const id = resolveIdentity({
    sessionId: 'abcdef1234567890',
    transcriptPath: '/no/such/file.jsonl',
    env: {},
  });
  assert.ok(id && id.length > 0);
  assert.ok(id.includes('abcdef12'));
});
