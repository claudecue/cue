// Identity resolution for a session's notification title.
//
// Precedence (resolved once per session, cached by the caller):
//   1. env.CUE_NAME (verbatim)
//   2. Claude Code's own session title from the transcript
//   3. first three words of the first real user message + " — Claude session"
//   4. a short slice of the session id
//
// Transcripts are .jsonl. The per-record schema is not documented, so we parse
// defensively and read line-by-line, stopping early — never slurping a whole
// large transcript into memory.

import { openSync, readSync, closeSync } from 'node:fs';

const READ_CAP_BYTES = 1024 * 1024; // safety bound for the early scan

// Lazily yield lines from a file using bounded chunked reads.
function* iterLines(path, { maxBytes = READ_CAP_BYTES } = {}) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return; // missing/unreadable file -> no lines
  }
  try {
    const CHUNK = 65536;
    const buf = Buffer.alloc(CHUNK);
    let leftover = '';
    let total = 0;
    while (true) {
      let bytes;
      try {
        bytes = readSync(fd, buf, 0, CHUNK, null);
      } catch {
        break;
      }
      if (bytes <= 0) break;
      total += bytes;
      leftover += buf.toString('utf8', 0, bytes);
      let idx;
      while ((idx = leftover.indexOf('\n')) !== -1) {
        yield leftover.slice(0, idx);
        leftover = leftover.slice(idx + 1);
      }
      if (total >= maxBytes) break;
    }
    if (leftover.length) yield leftover;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

function parse(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isUserRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.type === 'user') return true;
  if (rec.role === 'user') return true;
  if (rec.message && rec.message.role === 'user') return true;
  return false;
}

// Pull plain text out of a record's content, which may be a string or an array
// of content blocks. tool_result-only content yields no text.
function contentText(rec) {
  const content = rec.message?.content ?? rec.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block === 'object') {
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
        else if (block.type === undefined && typeof block.text === 'string') parts.push(block.text);
      }
    }
    return parts.join(' ');
  }
  return '';
}

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Slash commands and tag/system noise are not the user's "first question".
function isNoise(text) {
  if (!text) return true;
  if (text.startsWith('/')) return true;
  if (text.startsWith('<')) return true;
  return false;
}

export function extractFirstUserText(path) {
  for (const line of iterLines(path)) {
    const rec = parse(line);
    if (!isUserRecord(rec)) continue;
    const text = collapse(contentText(rec));
    if (isNoise(text)) continue;
    return text;
  }
  return null;
}

// Best-effort Claude-generated title. Transcripts may carry a `summary` record.
export function extractSessionTitle(path) {
  for (const line of iterLines(path)) {
    const rec = parse(line);
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type === 'summary' && typeof rec.summary === 'string' && rec.summary.trim()) {
      return rec.summary.trim();
    }
    if (typeof rec.title === 'string' && rec.title.trim()) {
      return rec.title.trim();
    }
  }
  return null;
}

function sessionSlice(sessionId) {
  const id = String(sessionId || 'session');
  return `${id.slice(0, 8)} Claude session`;
}

export function resolveIdentity({ sessionId, transcriptPath, env = {} }) {
  if (env.CUE_NAME && env.CUE_NAME.trim()) return env.CUE_NAME.trim();

  if (transcriptPath) {
    const title = extractSessionTitle(transcriptPath);
    if (title) return title;

    const text = extractFirstUserText(transcriptPath);
    if (text) {
      const words = text.split(' ').slice(0, 3).join(' ');
      return `${words} — Claude session`;
    }
  }

  return sessionSlice(sessionId);
}
