// Package entry loaded by Pi's extension loader (Jiti) when installed with
// `pi install npm:@zhalker/gentle-shell-subagent-live-status`.
//
// gentle-pi ships its presence API as TypeScript at lib/orchestrator-presence.ts
// with no package exports map, so the subpath resolves from the shared agent
// node_modules tree where Pi installs every package. The import is lazy and
// cached: a missing or incompatible gentle-pi degrades the presence bridge to an
// unavailable reason instead of failing the whole package load; native
// subagent_status/subagent_result dispatch and the child-log command lookup
// keep working without it.
import register, { readOwnActivity, agentProfile } from '../index.js';

let presencePromise = null;

function presenceModule() {
  presencePromise ??= import('gentle-pi/lib/orchestrator-presence.ts').catch(() => null);
  return presencePromise;
}

export default function (pi) {
  register(pi, {
    activity: async (sessionId, now) => {
      const presence = await presenceModule();
      return presence
        ? readOwnActivity(presence, agentProfile(), sessionId, now)
        : { unavailable: 'presence-bridge-not-configured' };
    },
  });
}
