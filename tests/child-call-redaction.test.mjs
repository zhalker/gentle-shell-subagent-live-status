import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readChildCall } from '../index.js';

// S7 "known secrets hidden": env-style secret assignments must be redacted like TOKEN=.
delete process.env.GENTLE_PI_AGENTS_CHILD;
const CREATED = Date.UTC(2026, 10, 9, 15, 19, 12, 469);
const FILE = '2026-11-09T15-19-12-469Z_11111111-1111-4111-8111-111111111111.jsonl';
const L = v => JSON.stringify(v);
function commandFrom(command) {
  const root = mkdtempSync(join(tmpdir(), 'redact-'));
  mkdirSync(join(root, 'gentle-agents', 'tasks'), { recursive: true });
  mkdirSync(join(root, 'gentle-agents', 'sessions'), { recursive: true });
  writeFileSync(join(root, 'gentle-agents', 'tasks', 't1.json'), L({
    task: { id: 't1', parentSessionId: 'own', createdAt: CREATED, prompt: 'do it', sessionPath: join(root, 'gentle-agents', 'sessions', FILE) }, thread: {},
  }));
  writeFileSync(join(root, 'gentle-agents', 'sessions', FILE), [
    L({ timestamp: '2026-11-09T15:19:13.000Z', message: { role: 'user', content: 'do it' } }),
    L({ timestamp: '2026-11-09T15:19:14.000Z', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command, timeout: 60000 } }] } }),
  ].join('\n') + '\n');
  return readChildCall({ profile: root, sessionId: 'own', taskId: 't1', callId: 'c1', now: CREATED + 5000 }).call?.command;
}
const VALUE = 'zzv-77012345';
const ENV_NAME = ['TOKEN', 'GITHUB_' + 'TOKEN', 'DB_' + 'PASS' + 'WORD', 'SECRET_' + 'KEY',
  'AWS_' + 'SECRET_' + 'ACCESS_' + 'KEY'];
const COMMANDS = ENV_NAME.map(n => `export ${n}=${VALUE} node app.js`);
for (let i = 0; i < COMMANDS.length; i++) {
  test(`S7 redaction hides env-style secret assignment (${ENV_NAME[i]})`, () => {
    const out = commandFrom(COMMANDS[i]);
    assert.ok(typeof out === 'string', 'command should be resolved');
    assert.ok(!out.includes(VALUE), `secret value leaked: ${out}`);
  });
}
test('S7 redaction keeps non-secret env text readable', () => {
  const out = commandFrom('NODE_ENV=production npm run build');
  assert.ok(out.includes('NODE_ENV=production'), out);
  assert.ok(out.includes('npm run build'), out);
});
test('S7 redaction hides URL userinfo passwords and quoted env secrets', () => {
  const url = commandFrom('git clone https://deploy:' + VALUE + '@example.invalid/repo.git');
  assert.ok(!url.includes(VALUE), url);
  assert.ok(url.includes('https://deploy:'), url);
  const quoted = commandFrom('API_' + 'TOKEN="' + VALUE + ' with space" ./run');
  assert.ok(!quoted.includes(VALUE), quoted);
});
