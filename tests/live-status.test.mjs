import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension, { readOwnActivity } from '../index.js';

// Test the parent tool even when the runner itself is a verifier subagent.
delete process.env.GENTLE_PI_AGENTS_CHILD;

const row = (items = [{ kind: 'tool', callId: 'c1', name: 'bash', output: 'abcdef', running: true }]) => ({
  summary: { id: 't1', status: 'running', startedAt: 100, lastActivityAt: 900 }, thread: { items },
});
function harness(activity = { tasks: [row()] }, status = 'running', error, deps = {}) {
  const tools = new Map();
  const events = new Map();
  let now = 1000;
  const calls = [];
  const pi = { registerTool: t => tools.set(t.name, t), on: (n, f) => events.set(n, f) };
  extension(pi, { now: () => now, activity: async () => activity, readChildCall: async () => ({ unavailable: 'task-not-owned' }), ...deps });
  const ctx = { sessionManager: { getSessionId: () => 'own' }, executeTool: async (name, args) => {
    calls.push(name);
    // Real Pi contract: ctx.executeTool resolves to AgentToolCallOutcome,
    // { toolCall, result: { content, details }, isError, durationMs? }, not a bare result.
    return { toolCall: { name, arguments: args }, isError: false, durationMs: 1,
      result: { content: [{ type: 'text', text: name === 'subagent_result' ? 'final answer' : 'original status' }],
        details: { gentleAgents: { taskId: args.task_id, status, error } } } };
  } };
  return { calls, events, ctx, time: n => { now = n; }, run: async (args = {}) => {
    const result = await tools.get('subagent_live_status').execute('query', { task_id: 't1', ...args }, undefined, undefined, ctx);
    return { result, value: JSON.parse(result.content[0].text) };
  } };
}

test('S7: existing currentTool fields are unchanged after the command-lookup addition', async () => {
  const h = harness();
  const { value } = await h.run();
  const { name, callId, elapsedMs, elapsedBasis } = value.currentTool;
  assert.deepEqual({ name, callId, elapsedMs, elapsedBasis },
    { name: 'bash', callId: 'c1', elapsedMs: 0, elapsedBasis: 'since-first-observation' });
});

test('children do not receive an extra tool or observers', () => {
  const previous = process.env.GENTLE_PI_AGENTS_CHILD;
  process.env.GENTLE_PI_AGENTS_CHILD = '1';
  try {
    extension({ registerTool() { assert.fail('child tool registration'); }, on() { assert.fail('child hook registration'); } });
  } finally {
    if (previous === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD;
    else process.env.GENTLE_PI_AGENTS_CHILD = previous;
  }
});

test('S1: current tool and honest observed elapsed; session lifecycle clears observations', async () => {
  const h = harness();
  let { value } = await h.run();
  assert.equal(value.currentTool.name, 'bash');
  assert.equal(value.currentTool.elapsedMs, 0);
  assert.equal(value.currentTool.elapsedBasis, 'since-first-observation');
  assert.equal(value.taskElapsedMs, 900);
  h.time(2500);
  assert.equal((await h.run()).value.currentTool.elapsedMs, 1500);
  h.events.get('session_shutdown')();
  assert.equal((await h.run()).value.currentTool.elapsedMs, 0);
});

test('S2: Unicode tail is bounded, explicitly truncated, and does not replace native status', async () => {
  const h = harness({ tasks: [row([{ kind: 'tool', callId: 'x', name: 'bash', output: 'abc😀de', running: true }])] });
  const { value } = await h.run({ tail_chars: 3 });
  assert.equal(value.outputTail, '😀de');
  assert.equal(value.outputTruncated, true);
  assert.equal(value.outputIsUntrusted, true);
  assert.deepEqual(h.calls, ['subagent_status']);
  assert.equal((await h.ctx.executeTool('subagent_status', { task_id: 't1' })).result.content[0].text, 'original status');
  const large = harness({ tasks: [row([{ kind: 'tool', callId: 'max', name: 'bash', output: 'x'.repeat(16001), running: true }])] });
  assert.equal((await large.run()).value.outputTail.length, 2000);
  const maximum = (await large.run({ tail_chars: 16000 })).value;
  assert.equal(maximum.outputTail.length, 16000);
  assert.equal(maximum.outputTruncated, true);
});

test('S3: reports actual last activity, not the query time; stale feed is unavailable', async () => {
  assert.equal((await harness().run()).value.lastUpdateAt, 900);
  const { value } = await harness({ unavailable: 'stale-presence' }).run();
  assert.equal(value.liveUnavailable, 'stale-presence');
  assert.equal(value.currentTool, null);
  assert.equal(value.lastUpdateAt, null);
});

test('S4: final result bounded; never invent successful command/process exit codes', async () => {
  const h = harness({ tasks: [] }, 'completed');
  const { value } = await h.run({ tail_chars: 6 });
  assert.equal(value.status, 'completed');
  assert.equal(value.resultTail, 'answer');
  assert.equal(value.resultTruncated, true);
  assert.equal(value.currentTool, null);
  assert.equal(value.exitCode, null);
  assert.deepEqual(h.calls, ['subagent_status', 'subagent_result']);
  const failure = harness({ tasks: [] }, 'failed', 'pi exited with code 7 before agent_settled');
  assert.equal((await failure.run()).value.exitCode, 7);
  assert.equal((await failure.run()).value.exitCodeSource, 'child-process-error');
});

test('invalid input and unknown task fail without reading result or changing data', async () => {
  const h = harness();
  for (const tail_chars of [0, -1, 16001, 1.5, '2', '', [], {}, true]) assert.equal((await h.run({ tail_chars })).result.isError, true);
  assert.deepEqual(h.calls, []);
  const unknown = harness();
  unknown.ctx.executeTool = async (name, args) => {
    unknown.calls.push(name);
    return { toolCall: { name, arguments: args }, isError: true, durationMs: 1,
      result: { content: [{ type: 'text', text: 'Unknown task' }], details: {} } };
  };
  assert.equal((await unknown.run()).result.isError, true);
  assert.deepEqual(unknown.calls, ['subagent_status']);
});

test('real outcome envelope: genuine native error and unknown-task outcomes keep structured errors', async () => {
  const outcome = (isError, details, textMsg) => ({ toolCall: { name: 'subagent_status', arguments: { task_id: 't1' } },
    isError, durationMs: 1, result: { content: [{ type: 'text', text: textMsg }], details } });
  const nativeError = harness();
  nativeError.ctx.executeTool = async (name, args) => { nativeError.calls.push(name); return outcome(true, {}, 'boom'); };
  const err = await nativeError.run();
  assert.equal(err.result.isError, true);
  assert.equal(err.value.error, 'Native subagent status unavailable.');
  assert.deepEqual(nativeError.calls, ['subagent_status']);
  const mismatch = harness();
  mismatch.ctx.executeTool = async (name, args) => { mismatch.calls.push(name); return outcome(false, { gentleAgents: { taskId: 'other', status: 'running' } }, 'status'); };
  const mm = await mismatch.run();
  assert.equal(mm.result.isError, true);
  assert.deepEqual(mismatch.calls, ['subagent_status']);
  const failedResult = harness({ tasks: [] }, 'completed');
  failedResult.ctx.executeTool = async (name, args) => {
    failedResult.calls.push(name);
    return name === 'subagent_status'
      ? outcome(false, { gentleAgents: { taskId: 't1', status: 'completed' } }, 'status')
      : { toolCall: { name, arguments: args }, isError: true, durationMs: 1, result: { content: [{ type: 'text', text: 'result unavailable' }], details: {} } };
  };
  const fr = await failedResult.run();
  assert.equal(fr.result.isError, true);
  assert.equal(fr.value.error, 'Native final result unavailable.');
  assert.equal(fr.value.status, 'completed');
  assert.deepEqual(failedResult.calls, ['subagent_status', 'subagent_result']);
});

test('native failure diagnosis: short native text, error flag and data presence are surfaced', async () => {
  const outcome = (isError, details, textMsg) => ({ toolCall: { name: 'subagent_status', arguments: { task_id: 't1' } },
    isError, durationMs: 1, result: { content: [{ type: 'text', text: textMsg }], details } });
  // Nested dispatch miss: inactive tool, Pi short-circuits with isError and a tool-not-found text.
  const notFound = harness();
  notFound.ctx.executeTool = async (name, args) => { notFound.calls.push(name); return outcome(true, {}, 'Tool subagent_status not found'); };
  const nf = await notFound.run();
  assert.equal(nf.result.isError, true);
  assert.equal(nf.value.nativeError, true);
  assert.equal(nf.value.nativeDataPresent, false);
  assert.equal(nf.value.nativeDetail, 'Tool subagent_status not found');
  // Foreign task: gentle-pi answers without error but with no gentleAgents data.
  const foreign = harness();
  foreign.ctx.executeTool = async (name, args) => { foreign.calls.push(name); return outcome(false, { error: 'unknown task' }, 'Error: no task t1. Launch it from its owning session.'); };
  const fg = await foreign.run();
  assert.equal(fg.value.nativeError, false);
  assert.equal(fg.value.nativeDataPresent, false);
  assert.ok(fg.value.nativeDetail.includes('no task t1'));
  // Diagnostic text is bounded.
  const long = harness();
  long.ctx.executeTool = async (name, args) => { long.calls.push(name); return outcome(true, {}, 'x'.repeat(2000)); };
  const lg = await long.run();
  assert.equal(lg.value.nativeDetail.length, 300);
  // Empty native text yields no nativeDetail key at all.
  const silent = harness();
  silent.ctx.executeTool = async (name, args) => { silent.calls.push(name); return outcome(true, {}, ''); };
  const sn = await silent.run();
  assert.equal(sn.value.nativeDetail, undefined);
  assert.deepEqual(silent.calls, ['subagent_status']);
});

test('presence reader reads only own header, rejects stale and ambiguous incarnations', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-status-'));
  const own = 'a'.repeat(64), peer = 'b'.repeat(64), incarnation = '00000000-0000-4000-8000-000000000001';
  const filename = hash => `${hash}.${incarnation}.header.json`;
  writeFileSync(join(root, filename(own)), JSON.stringify({ sessionHash: own, incarnation, heartbeat: 1000 }));
  writeFileSync(join(root, filename(peer)), 'private-invalid-json');
  const read = [];
  const api = { rootFor: () => root, sessionHash: () => own, boundedRead: path => {
    read.push(path); return readFileSync(path);
  }, readActivity: () => ({ activity: { tasks: [row()] } }) };
  assert.equal(readOwnActivity(api, root, 'own', 1000).tasks[0].summary.id, 't1');
  assert.deepEqual(read, [join(root, filename(own))]);
  assert.equal(readOwnActivity(api, root, 'own', 17000).unavailable, 'stale-presence');
  const second = '00000000-0000-4000-8000-000000000002';
  writeFileSync(join(root, `${own}.${second}.header.json`), JSON.stringify({ sessionHash: own, incarnation: second, heartbeat: 1000 }));
  assert.equal(readOwnActivity(api, root, 'own', 1000).unavailable, 'ambiguous-presence');
});
