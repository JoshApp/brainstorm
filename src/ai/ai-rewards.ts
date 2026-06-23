// Wires the common AI transport to in-game award moments (PROTOTYPE, dev-only).
//
// Demonstrates the prefetch → claim loop end-to-end with ZERO loot-system
// surgery, using events that already fire:
//   - level:loaded   → warm a small pool of "find" reactions for this floor
//                      (request ahead so the next find is ready to go)
//   - item:picked-up → on the FIRST notable find of the floor, the deep
//                      remarks on it; claimed from the pool (instant), the
//                      pickup itself is the cover, a baked line is the fallback
//
// Restraint: at most one remark per floor — silence is the default; the deep
// speaks rarely. Best-effort: silent if no backend answers. Dev-only for now,
// like the rest of the Phase-5 prototype (flip the gate when the Worker ships).
//
// This is the template for the real surfaces (bonfire fate cards, chest loot,
// unidentified-item naming): prefetch on a predictable trigger, claim at a
// delivery animation, fall back to a baked artifact. See src/ai/ai-client.ts.

import { on } from '../broadcast/event-bus';
import { broadcastPop } from '../ui/broadcast-pop';
import { getRunState } from '../state/run-state';
import { RewardPool } from './ai-client';
import { describePlayer } from './player-profile';

const FALLBACK_FINDS = [
  'The dark let you keep that one. It is not certain why.',
  'A trinket. The deep has swallowed grander things, and grander fools.',
  'You found it because it was left. Consider who left it.',
];
function fallbackLine(): { line: string } {
  return { line: FALLBACK_FINDS[Math.floor(Math.random() * FALLBACK_FINDS.length)] };
}

let pool: RewardPool | null = null;
let remarkedThisFloor = false;

export function initAIRewards(): void {
  if (!import.meta.env.DEV) return; // prototype: dev-only

  // Pool size 1: we deliver exactly one remark per floor (restraint), so one
  // prefetched line is all we need — no point generating a spare we discard.
  pool = new RewardPool('item-skin', () => ({
    event: 'find',
    depth: getRunState()?.depth ?? 1,
    player: describePlayer(), // the dossier — so the remark fits who they are
  }), 1);

  // The handler is wrapped: a rewards bug must NEVER throw into emit() and break
  // the game systems (level loading, pickups) that fire these events.
  on((e) => {
    try {
      if (e.type === 'level:loaded') {
        remarkedThisFloor = false;
        pool?.warm(); // request the floor's reactions ahead of time
      } else if (e.type === 'item:picked-up' && !remarkedThisFloor) {
        remarkedThisFloor = true;
        void deliverFind(e.displayName ?? e.itemId);
      }
    } catch { /* never break the emitter */ }
  });
}

async function deliverFind(itemName: string): Promise<void> {
  const art = await pool?.take({ coverMs: 800, fallback: fallbackLine() });
  const line = art?.line ?? art?.flavor;
  if (line) broadcastPop(line, itemName, 'THE DEEP REGARDS YOUR FIND');
}
