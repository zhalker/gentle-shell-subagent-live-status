import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension, { readChildCall } from '../index.js';

// Test the parent tool even when the runner itself is a verifier subagent.
delete process.env.GENTLE_PI_AGENTS_CHILD;

const CREATED = Date.UTC(2026, 10, 9, 15, 19, 12, 469);
const REG_AT = Date.parse('2026-11-09T15:19:14.000Z');
const UUID = '11111111-1111-4111-8111-111111111111';
const IN_WINDOW = `2026-11-09T15-19-12-469Z_${UUID}.jsonl`;
const OUT_OF_WINDOW = `2026-11-09T15-30-00-000Z_22222222-2222-4222-8222-222222222222.jsonl`;
const IN_WINDOW_2 = `2026-11-09T15-19-11-000Z_33333333-3333-4333-8333-333333333333.jsonl`;

const line = value => JSON.stringify(value);
const callLine = (id = 'c1', extra = {}) => line({
  timestamp: '2026-11-09T15:19:14.000Z',
  message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: 'npm test', timeout: 120000, ...extra } }] },
});
const promptLine = prompt => line({ timestamp: '2026-11-09T15:19:13.000Z', message: { role: 'user', content: prompt } });
const resultLine = id => line({ timestamp: '2026-11-09T15:19:20.000Z', message: { role: 'toolResult', toolCallId: id, content: [] } });

const DEFAULT_PROMPT = 'do the thing';
const DEFAULT_LOG = [promptLine(DEFAULT_PROMPT), callLine()].join('\n') + '\n';

function makeProfile({ task = {}, prompt = DEFAULT_PROMPT, log = DEFAULT_LOG, file = IN_WINDOW, sessionPath = 'inside' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'child-call-'));
  const tasks = join(root, 'gentle-agents', 'tasks');
  const sessions = join(root, 'gentle-agents', 'sessions');
  mkdirSync(tasks, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const resolvedPath = sessionPath === 'inside' ? join(sessions, file)
    : sessionPath === 'escape' ? join(sessions, '..', 'tasks', 't1.json')
    : null;
  writeFileSync(join(tasks, 't1.json'), JSON.stringify({
    task: { id: 't1', parentSessionId: 'own', createdAt: CREATED, prompt, sessionPath: resolvedPath, ...task }, thread: {},
  }));
  if (log) writeFileSync(join(sessions, file), log);
  return { root, tasks, sessions };
}

const lookup = (profile, extra = {}) => readChildCall({ profile: profile.root, sessionId: 'own', taskId: 't1', callId: 'c1', now: CREATED + 5000, ...extra });

function harness({ activity = { tasks: [row()] }, status = 'running', now = 1000, deps = {} } = {}) {
  const tools = new Map();
  const pi = { registerTool: t => tools.set(t.name, t), on: () => {} };
  extension(pi, { now: () => now, activity: async () => activity, ...deps });
  const ctx = { sessionManager: { getSessionId: () => 'own' }, executeTool: async (name, args) => ({
    toolCall: { name, arguments: args }, isError: false, durationMs: 1,
    result: { content: [{ type: 'text', text: 'status' }], details: { gentleAgents: { taskId: args.task_id, status } } } }) };
  return { run: async (args = {}) => {
    const result = await tools.get('subagent_live_status').execute('query', { task_id: 't1', ...args }, undefined, undefined, ctx);
    return { result, value: JSON.parse(result.content[0].text) };
  } };
}
const row = (items = [{ kind: 'tool', callId: 'c1', name: 'bash', output: 'abcdef', running: true }]) => ({
  summary: { id: 't1', status: 'running', startedAt: 100, lastActivityAt: 900 }, thread: { items },
});

test('S7 success: command, timeout, registration and pending from own child-session log', () => {
  const profile = makeProfile();
  const result = lookup(profile);
  // call registration (15:19:14.000Z) is 1531 ms after task.createdAt; now = createdAt + 5000 ms.
  assert.deepEqual(result, { call: {
    name: 'bash', command: 'npm test', commandTruncated: false, timeoutSeconds: 120000,
    callRegisteredAt: REG_AT, resultRecorded: false, pendingMs: 3469, pendingBasis: 'call-registered-in-child-log',
  } });
  assert.ok(!JSON.stringify(result).includes(DEFAULT_PROMPT), 'prompt text must never be output');
});

test('S7 already-recorded result: pendingMs is null', () => {
  const profile = makeProfile({ log: `${DEFAULT_LOG}${resultLine('c1')}\n` });
  const call = lookup(profile).call;
  assert.equal(call.resultRecorded, true);
  assert.equal(call.pendingMs, null);
  assert.equal(call.pendingBasis, null);
});

test('S7 prompt optionally suffixed with context matches', () => {
  const profile = makeProfile({ log: `${promptLine(`${DEFAULT_PROMPT}\n\n## Context\nextra stuff`)}\n${callLine()}\n` });
  assert.equal(lookup(profile).call.command, 'npm test');
});

test('S7 parentSession mismatch is unavailable, never a guessed command', () => {
  assert.equal(lookup(makeProfile(), { sessionId: 'someone-else' }).unavailable, 'task-not-owned');
});

test('S7 task id mismatch is unavailable', () => {
  const profile = makeProfile();
  writeFileSync(join(profile.tasks, 't1.json'), JSON.stringify({
    task: { id: 't2', parentSessionId: 'own', createdAt: CREATED, prompt: DEFAULT_PROMPT, sessionPath: null }, thread: {},
  }));
  assert.equal(lookup(profile).unavailable, 'task-not-owned');
});

test('S7 task id outside the allowed pattern is rejected before any read', () => {
  assert.equal(readChildCall({ profile: 'x', sessionId: 'own', taskId: '../escape', callId: 'c1' }).unavailable, 'invalid-task-id');
});

test('S7 prompt mismatch is unavailable', () => {
  const profile = makeProfile({ log: `${promptLine('a different prompt')}\n${callLine()}\n` });
  assert.equal(lookup(profile).unavailable, 'child-session-not-found');
});

test('S7 callId absent from the log is unavailable', () => {
  assert.equal(lookup(makeProfile(), { callId: 'cX' }).unavailable, 'child-session-not-found');
});

test('S7 explicit sessionPath ignores other matching candidates', () => {
  const profile = makeProfile();
  writeFileSync(join(profile.sessions, IN_WINDOW_2), DEFAULT_LOG);
  assert.equal(lookup(profile).call.command, 'npm test');
});

test('S7 explicit sessionPath does not depend on the filename timestamp', () => {
  const profile = makeProfile({ log: DEFAULT_LOG, file: OUT_OF_WINDOW });
  assert.equal(lookup(profile).call.command, 'npm test');
});

test('S7 oversized candidate is not read', () => {
  const profile = makeProfile({ log: 'x'.repeat(17 * 1024 * 1024), file: IN_WINDOW });
  assert.equal(lookup(profile).unavailable, 'child-session-not-found');
});

test('S7 malformed JSONL lines are skipped, valid ones still match', () => {
  const profile = makeProfile({ log: `not json\n{oops\n${DEFAULT_LOG}${resultLine('c1')}\n` });
  const call = lookup(profile).call;
  assert.equal(call.command, 'npm test');
  assert.equal(call.resultRecorded, true);
});

test('S7 symlinked candidate is rejected (skipped when the OS cannot create one)', t => {
  const profile = makeProfile({ log: '', file: IN_WINDOW });
  writeFileSync(join(profile.sessions, 'target.jsonl'), DEFAULT_LOG);
  try {
    symlinkSync(join(profile.sessions, 'target.jsonl'), join(profile.sessions, IN_WINDOW));
  } catch {
    return t.skip('symlink creation not permitted on this OS/user');
  }
  assert.equal(lookup(profile).unavailable, 'child-session-not-found');
});

test('S7 string sessionPath is used exclusively when it resolves under sessions; traversal rejected', () => {
  // The only log file sits outside the ±120s filename window; sessionPath must bypass it.
  const inside = makeProfile({ log: DEFAULT_LOG, file: OUT_OF_WINDOW, sessionPath: 'inside' });
  assert.equal(lookup(inside).call.command, 'npm test');
  const escape = makeProfile({ log: DEFAULT_LOG, file: OUT_OF_WINDOW, sessionPath: 'escape' });
  assert.equal(lookup(escape).unavailable, 'session-path-rejected');
});

test('S7 canaries in thinking blocks and prompt never appear in output', () => {
  const profile = makeProfile({
    prompt: 'PROMPT-CANARY-a1',
    log: `${promptLine('PROMPT-CANARY-a1')}\n${line({ timestamp: '2026-11-09T15:19:13.500Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'THINKING-CANARY-b2' }] } })}\n${callLine()}\n`,
  });
  const result = lookup(profile);
  const json = JSON.stringify(result);
  assert.ok(!json.includes('PROMPT-CANARY-a1'));
  assert.ok(!json.includes('THINKING-CANARY-b2'));
  assert.equal(result.call.command, 'npm test');
});

test('S7 redaction: Bearer tokens and secret-style assignments are hidden', () => {
  const profile = makeProfile({ log: `${promptLine(DEFAULT_PROMPT)}\n${callLine('c1', { command: 'deploy --password hunter2 TOKEN=abc123 curl -H "Authorization: Bearer topsecret" https://x' })}\n` });
  const command = lookup(profile).call.command;
  assert.ok(!command.includes('hunter2') && !command.includes('abc123') && !command.includes('topsecret'));
  assert.ok(command.includes('--password [redacted]'));
  assert.ok(command.includes('TOKEN=[redacted]'));
  assert.ok(command.includes('[redacted]'));
});

test('S7 command truncation counts Unicode code points and flags it', () => {
  const long = 'a'.repeat(3900) + '😀'.repeat(150);
  const profile = makeProfile({ log: `${promptLine(DEFAULT_PROMPT)}\n${callLine('c1', { command: long })}\n` });
  const call = lookup(profile).call;
  assert.equal(Array.from(call.command).length, 4000);
  assert.equal(call.commandTruncated, true);
  const exact = makeProfile({ log: `${promptLine(DEFAULT_PROMPT)}\n${callLine('c1', { command: 'b'.repeat(4000) })}\n` });
  assert.equal(lookup(exact).call.commandTruncated, false);
});

test('S7 non-bash tool without command arguments still reports name and registration', () => {
  // JSON.stringify drops undefined keys, so arguments is {} in the fixture log.
  const profile = makeProfile({ log: `${promptLine(DEFAULT_PROMPT)}\n${callLine('c1', { command: undefined, timeout: undefined })}\n` });
  const call = lookup(profile).call;
  assert.equal(call.name, 'bash');
  assert.equal(call.command, null);
  assert.equal(call.commandTruncated, false);
  assert.equal(call.timeoutSeconds, null);
  assert.equal(call.callRegisteredAt, REG_AT);
  assert.equal(call.resultRecorded, false);
});

test('S7 invalid declared timeout (non-positive integer) is reported null', () => {
  const profile = makeProfile({ log: `${promptLine(DEFAULT_PROMPT)}\n${callLine('c1', { timeout: -5 })}\n` });
  assert.equal(lookup(profile).call.timeoutSeconds, null);
});

test('S7 wiring: running tool triggers one lookup with the caller identity and populates additive fields', async () => {
  const calls = [];
  const h = harness({ now: 5000, deps: { readChildCall: async o => {
    calls.push(o);
    return { call: { name: 'bash', command: 'npm test', commandTruncated: false, timeoutSeconds: 120000,
      callRegisteredAt: 500, resultRecorded: false, pendingMs: 4500, pendingBasis: 'call-registered-in-child-log' } };
  } } });
  const { value, result } = await h.run();
  assert.deepEqual(calls, [{ sessionId: 'own', taskId: 't1', callId: 'c1', now: 5000 }]);
  assert.equal(result.isError, false);
  assert.deepEqual({
    command: value.currentTool.command, commandTruncated: value.currentTool.commandTruncated,
    commandIsUntrusted: value.currentTool.commandIsUntrusted, commandSource: value.currentTool.commandSource,
    callRegisteredAt: value.currentTool.callRegisteredAt, pendingMs: value.currentTool.pendingMs,
    pendingBasis: value.currentTool.pendingBasis, timeoutSeconds: value.currentTool.timeoutSeconds,
    resultRecorded: value.currentTool.resultRecorded, commandUnavailable: value.currentTool.commandUnavailable,
  }, { command: 'npm test', commandTruncated: false, commandIsUntrusted: true, commandSource: 'child-session-log',
    callRegisteredAt: 500, pendingMs: 4500, pendingBasis: 'call-registered-in-child-log',
    timeoutSeconds: 120000, resultRecorded: false, commandUnavailable: null });
});

test('S7 wiring: unavailable and throwing lookups degrade without failing the status call', async () => {
  const off = harness({ deps: { readChildCall: async () => ({ unavailable: 'task-not-owned' }) } });
  const offRun = await off.run();
  assert.equal(offRun.result.isError, false);
  assert.equal(offRun.value.currentTool.commandUnavailable, 'task-not-owned');
  assert.equal(offRun.value.currentTool.command, null);
  const boom = harness({ deps: { readChildCall: async () => { throw new Error('leaky stack /secret/path'); } } });
  const boomRun = await boom.run();
  assert.equal(boomRun.result.isError, false);
  assert.equal(boomRun.value.currentTool.commandUnavailable, 'command-lookup-failed');
  assert.ok(!JSON.stringify(boomRun.value).includes('/secret/path'), 'no error text may leak');
});

test('S7 wiring: terminal tasks and absent running tools never trigger the lookup', async () => {
  let calls = 0;
  const terminal = harness({ status: 'completed', deps: { readChildCall: async () => { calls++; return { unavailable: 'task-not-owned' }; } } });
  assert.equal((await terminal.run()).value.currentTool, null);
  const idle = harness({ activity: { tasks: [row([])] }, deps: { readChildCall: async () => { calls++; return { unavailable: 'task-not-owned' }; } } });
  assert.equal((await idle.run()).value.currentTool, null);
  assert.equal(calls, 0);
});

test('S7 default dependency: real fs against an injected profile home end to end', async () => {
  const profile = makeProfile({
    prompt: 'PROMPT-CANARY-a1',
    log: `${promptLine('PROMPT-CANARY-a1')}\n${line({ timestamp: '2026-11-09T15:19:13.500Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'THINKING-CANARY-b2' }] } })}\n${callLine()}\n`,
  });
  const previous = process.env.GENTLE_PI_AGENT_HOME;
  process.env.GENTLE_PI_AGENT_HOME = profile.root;
  try {
    const h = harness({ now: REG_AT + 5000 });
    const { value, result } = await h.run();
    assert.equal(result.isError, false);
    assert.deepEqual({
      command: value.currentTool.command, commandSource: value.currentTool.commandSource,
      timeoutSeconds: value.currentTool.timeoutSeconds, callRegisteredAt: value.currentTool.callRegisteredAt,
      pendingMs: value.currentTool.pendingMs, commandUnavailable: value.currentTool.commandUnavailable,
    }, { command: 'npm test', commandSource: 'child-session-log', timeoutSeconds: 120000,
      callRegisteredAt: REG_AT, pendingMs: 5000, commandUnavailable: null });
    const json = JSON.stringify(value);
    assert.ok(!json.includes('PROMPT-CANARY-a1') && !json.includes('THINKING-CANARY-b2'));
  } finally {
    if (previous === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
    else process.env.GENTLE_PI_AGENT_HOME = previous;
  }
});
