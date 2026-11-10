import { copyFileSync, constants, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Explicit absolute targets: never change settings, existing extensions or vendor files.
const [home, gentleRoot] = process.argv.slice(2);
try {
  if (!home || !gentleRoot || !isAbsolute(home) || !isAbsolute(gentleRoot)) {
    throw new Error('Usage: node install.mjs <absolute-agent-home> <absolute-gentle-pi-root>');
  }
  const source = dirname(fileURLToPath(import.meta.url));
  const presence = join(gentleRoot, 'lib', 'orchestrator-presence.ts');
  if (!existsSync(presence)) throw new Error('Missing Gentle Shell presence API.');
  const extensions = join(home, 'extensions');
  if (!existsSync(extensions)) throw new Error('Missing Pi extensions directory.');
  const target = join(extensions, 'subagent-live-status');
  mkdirSync(target); // EEXIST is intentional: never update or overwrite an installation.
  copyFileSync(join(source, 'index.js'), join(target, 'live-status.js'), constants.COPYFILE_EXCL);
  copyFileSync(join(source, 'README.md'), join(target, 'README.md'), constants.COPYFILE_EXCL);
  writeFileSync(join(target, 'package.json'), JSON.stringify({ private: true, type: 'module', pi: { extensions: ['./index.ts'] } }, null, 2), { flag: 'wx' });
  // Static imports go through Pi's Jiti loader. Node dynamic imports cannot strip
  // TypeScript inside node_modules; avoid extra dependencies or vendor patches.
  const entry = `import * as presence from ${JSON.stringify(pathToFileURL(presence).href)};\n`
    + `import register, { readOwnActivity, agentProfile } from './live-status.js';\n`
    + `export default function (pi) {\n`
    + `  register(pi, { activity: async (sessionId, now) => readOwnActivity(presence, agentProfile(), sessionId, now) });\n`
    + `}\n`;
  writeFileSync(join(target, 'index.ts'), entry, { flag: 'wx' });
  console.log(target);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
