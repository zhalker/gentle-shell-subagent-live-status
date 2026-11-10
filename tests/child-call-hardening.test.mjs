import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readChildCall } from '../index.js';

delete process.env.GENTLE_PI_AGENTS_CHILD;
const CREATED = Date.UTC(2026, 10, 9, 15, 19, 12, 469);
const FILE = '2026-11-09T15-19-12-469Z_11111111-1111-4111-8111-111111111111.jsonl';
const L = v => JSON.stringify(v);
const callLine = command => L({ timestamp: '2026-11-09T15:19:14.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command } }] } });
const promptLine = () => L({ timestamp: '2026-11-09T15:19:13.000Z', message: { role: 'user', content: 'do it' } });
const log = command => [promptLine(), callLine(command)].join('\n') + '\n';
function profile({ command = 'npm test', sessionPath, sessions = true, file = FILE } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hardening-'));
  const tasks = join(root, 'gentle-agents', 'tasks'), dir = join(root, 'gentle-agents', 'sessions');
  mkdirSync(tasks, { recursive: true });
  if (sessions) mkdirSync(dir, { recursive: true });
  writeFileSync(join(tasks, 't1.json'), L({ task: { id: 't1', parentSessionId: 'own', createdAt: CREATED, prompt: 'do it', sessionPath: sessionPath === undefined ? join(dir, file) : sessionPath }, thread: {} }));
  if (command !== null) writeFileSync(join(dir, file), log(command));
  return { root, dir };
}
const look = (p, extra = {}) => readChildCall({ profile: p.root, sessionId: 'own', taskId: 't1', callId: 'c1', now: CREATED + 5000, ...extra });
const V = 'zzv-77012345';

test('S7 env-style names redact with prefixes, suffixes and case variants', () => {
  for (const name of ['GITHUB_TOKEN', 'DB_PASSWORD', 'SECRET_KEY', 'AWS_SECRET_ACCESS_KEY', 'github_token', 'GitHub_Token', 'MY_APP_DB_PASSWORD_OLD', 'X_MY_TOKEN', 'B_TOKEN']) {
    const out = look(profile({ command: `export A=1 ${name}=${V} node app.js` })).call.command;
    assert.ok(!out.includes(V), `${name} leaked: ${out}`);
    assert.ok(out.startsWith('export A=1 '), out);
  }
});

test('S7 quoted, spaced and = -containing values are hidden', () => {
  const out = look(profile({ command: `API_TOKEN="a b ${V}" DB_PASSWORD='${V} x' SECRET_KEY=x=y ./run` })).call.command;
  assert.ok(!out.includes(V) && !out.includes('x=y'), out);
});

test('S7 URL userinfo is hidden; user-only, host.port and ipv6 URLs stay byte-identical', () => {
  const redacted = look(profile({ command: `curl https://user:${V}@host.invalid:8443/x postgres://u:${V}@db:5432/x` })).call.command;
  assert.ok(!redacted.includes(V), redacted);
  for (const same of ['curl https://[2001:db8::1]:8443/x', 'curl https://user@host.invalid:8443/x', 'git clone ssh://git@host.invalid/x', 'curl http://127.0.0.1:3000/api']) {
    assert.equal(look(profile({ command: same })).call.command, same);
  }
});

test('S7 junction outside sessions is rejected, junction inside sessions is followed', t => {
  const p = profile({ command: null, sessionPath: 'PLACEHOLDER' });
  const outside = join(p.root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'x.jsonl'), log('ESCAPE'));
  try { symlinkSync(outside, join(p.dir, 'junc'), 'junction'); } catch { return t.skip('junction creation not permitted'); }
  writeFileSync(join(p.root, 'gentle-agents', 'tasks', 't1.json'), L({ task: { id: 't1', parentSessionId: 'own', createdAt: CREATED, prompt: 'do it', sessionPath: join(p.dir, 'junc', 'x.jsonl') }, thread: {} }));
  assert.equal(look(p).unavailable, 'session-path-rejected');
  const inner = join(p.dir, 'sub');
  mkdirSync(inner);
  writeFileSync(join(inner, 'y.jsonl'), log('INSIDE'));
  try { symlinkSync(inner, join(p.dir, 'link'), 'junction'); } catch { return t.skip('junction creation not permitted'); }
  writeFileSync(join(p.root, 'gentle-agents', 'tasks', 't1.json'), L({ task: { id: 't1', parentSessionId: 'own', createdAt: CREATED, prompt: 'do it', sessionPath: join(p.dir, 'link', 'y.jsonl') }, thread: {} }));
  assert.equal(look(p).call.command, 'INSIDE');
});

test('S7 hardlinked candidate is not read', t => {
  const p = profile({ command: null });
  const outside = join(p.root, 'outside.jsonl');
  writeFileSync(outside, log('HARD'));
  try { linkSync(outside, join(p.dir, FILE)); } catch { return t.skip('hardlink not permitted'); }
  assert.equal(look(p).unavailable, 'child-session-not-found');
});

test('S7 unrelated session logs do not affect explicit sessionPath', () => {
  const p = profile({ command: 'ONLY' });
  for (let i = 0; i < 16; i++) writeFileSync(join(p.dir, `2026-11-09T15-19-${String(i).padStart(2, '0')}-000Z_9999-9999-4999-8999-10000000000${i}.jsonl`), 'noise\n');
  assert.equal(look(p).call.command, 'ONLY');
});
