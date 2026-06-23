// The voice in the deep — death remark (PROTOTYPE, dev-only).
//
// Now a thin caller of the common AI transport (src/ai/ai-client.ts): the
// death is just one `kind` of AI request. Best-effort + fire-and-forget — if
// nothing answers (no shim, offline, prod-without-worker), it silently no-ops
// and the game is unaffected. See docs/ALPHA-AND-BACKEND.md.

import { broadcastPop } from '../ui/broadcast-pop';
import { requestNow } from '../ai/ai-client';
import { describePlayer } from '../ai/player-profile';

export interface DeathVoiceContext {
  depth: number;
  kills: number;
  killedBy: string;
}

/** Ask the deep to remark on a death. Never throws; never blocks the game. */
export function speakDeath(ctx: DeathVoiceContext): void {
  void (async () => {
    const art = await requestNow('voice', {
      event: 'death',
      depth: ctx.depth, // explicit: run state may be mid-clear at death time
      kills: ctx.kills,
      killedBy: ctx.killedBy || 'the dark',
      player: describePlayer(), // the dossier — who the deep knows them to be
    });
    const line = art?.line?.trim();
    if (line) broadcastPop(line, '', 'THE VOICE IN THE DEEP');
  })();
}
