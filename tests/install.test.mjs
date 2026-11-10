import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
// Resolve the installer from this test's location so npm test works from the project root
// and from any working directory (the handoff layout kept tests under projects/).
const installerPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'install.mjs');

// Generated entries are parent-side extensions; isolate inherited child flags.
delete process.env.GENTLE_PI_AGENTS_CHILD;

test('S5: installed entry loads static TS bridge; reinstall refuses to overwrite', async () => {
  const home = mkdtempSync(join(tmpdir(), 'live-install-'));
  const gentle = join(home, 'gentle');
  mkdirSync(join(home, 'extensions'));
  mkdirSync(join(gentle, 'lib'), { recursive: true });
  writeFileSync(join(gentle, 'lib', 'orchestrator-presence.ts'), 'export const sessionHash = () => "own";');
  const run = () => spawnSync(process.execPath, [installerPath, home, gentle], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, '');
  const target = join(home, 'extensions', 'subagent-live-status');
  assert.equal(first.stdout.trim(), target);
  const entry = join(target, 'index.ts');
  const before = readFileSync(entry, 'utf8');
  let tool;
  (await import(pathToFileURL(entry).href)).default({ on() {}, registerTool(t) { tool = t; } });
  assert.equal(tool.name, 'subagent_live_status');
  const second = run();
  assert.equal(second.status, 1);
  assert.equal(second.stdout, '');
  assert.match(second.stderr, /EEXIST/);
  assert.equal(readFileSync(entry, 'utf8'), before);
});
