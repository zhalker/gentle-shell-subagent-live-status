import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readChildCall } from '../index.js';

// A directory junction/symlink inside sessions/ must not let sessionPath escape it:
// the leaf lstat cannot see parent components, so the real path is compared.
delete process.env.GENTLE_PI_AGENTS_CHILD;
const CREATED = Date.UTC(2026, 10, 9, 15, 19, 12, 469);
const L = v => JSON.stringify(v);

test('sessionPath through a directory junction cannot escape the sessions directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'junction-'));
  const sessions = join(root, 'gentle-agents', 'sessions');
  const outside = join(root, 'outside');
  mkdirSync(join(root, 'gentle-agents', 'tasks'), { recursive: true });
  mkdirSync(sessions, { recursive: true });
  mkdirSync(outside);
  try { symlinkSync(outside, join(sessions, 'junc'), 'junction'); }
  catch { t.skip('junction/symlink creation not permitted for this OS user'); return; }
  writeFileSync(join(outside, 'x.jsonl'), [
    L({ timestamp: '2026-11-09T15:19:13.000Z', message: { role: 'user', content: 'do it' } }),
    L({ timestamp: '2026-11-09T15:19:14.000Z', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'JUNCTION-ESCAPE' } }] } }),
  ].join('\n') + '\n');
  writeFileSync(join(root, 'gentle-agents', 'tasks', 't1.json'), L({
    task: { id: 't1', parentSessionId: 'own', createdAt: CREATED, prompt: 'do it',
      sessionPath: join(sessions, 'junc', 'x.jsonl') }, thread: {},
  }));
  const result = readChildCall({ profile: root, sessionId: 'own', taskId: 't1', callId: 'c1', now: CREATED + 5000 });
  assert.equal(result.call, undefined);
  assert.equal(result.unavailable, 'session-path-rejected');
});
