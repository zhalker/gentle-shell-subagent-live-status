import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readChildCall } from '../index.js';

function fixture(sessionPath) {
  const profile = mkdtempSync(join(tmpdir(), 'privacy-boundary-'));
  const tasks = join(profile, 'gentle-agents', 'tasks');
  const sessions = join(profile, 'gentle-agents', 'sessions');
  mkdirSync(tasks, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const now = Date.UTC(2026, 0, 1);
  const path = sessionPath?.(sessions);
  const task = { id: 't1', parentSessionId: 'owner', prompt: 'test', createdAt: now, sessionPath: path ?? null };
  writeFileSync(join(tasks, 't1.json'), JSON.stringify({ task }));
  const log = [
    { message: { role: 'user', content: 'test' } },
    { timestamp: new Date(now).toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'echo peer' } }] } },
  ].map(JSON.stringify).join('\n');
  return { profile, sessions, now, path, log };
}
const lookup = f => readChildCall({ profile: f.profile, sessionId: 'owner', taskId: 't1', callId: 'c1', now: f.now });

test('missing child session path never scans candidate peer logs', () => {
  const f = fixture();
  writeFileSync(join(f.sessions, '2026-01-01T00-00-00-000Z_peer.jsonl'), f.log);
  assert.equal(lookup(f).unavailable, 'child-session-not-found');
  assert.equal(lookup(f).call, undefined);
});

test('alternate data stream path is rejected before reading', () => {
  const f = fixture(s => join(s, 'base.txt:evil.jsonl'));
  writeFileSync(join(f.sessions, 'base.txt'), 'base');
  writeFileSync(f.path, f.log);
  assert.equal(lookup(f).unavailable, 'session-path-rejected');
  assert.equal(lookup(f).call, undefined);
});
