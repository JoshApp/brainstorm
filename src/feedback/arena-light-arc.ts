import { on } from '../broadcast/event-bus';
import { getActiveLevel } from '../level/active-level';
import type { Torch } from '../scene/torchlight';

// Arena light-state arc — the room's torches BREATHE around an encounter:
//
//   activate → INHALE  (gutter down — the held breath before)
//            → SURGE   (whoom up, brighter; also lets you READ the fight)
//            → HOLD    (stay hot for the duration)
//   complete → FLARE   (a brief over-bright triumph)
//            → EXHALE  (ease back DOWN, slower than the surge — relief, not shock)
//            → settle at a faint RESIDUAL afterglow (the room remembers a thing
//              happened here, until the floor unloads).
//
// This is the temporal half of the "lighting as signal" doctrine: the room's
// brightness narrates the encounter's lifecycle. It drives each torch's
// envBoost (layered OVER the live flicker — see torchlight.ts), so it never
// fights the flicker or the global env multiplier. Works for BOTH trap arenas
// (gate-slam) and challenge arenas — in the latter it composes with the
// room-mood RED tint (colour there, brightness here). One envelope per room;
// subscribes to encounter:activated/complete; ticked by the engine; cleared on
// level load.

const PREFIX = 'arena:';   // arenaEncounterId(roomId) = `arena:${roomId}`

// Envelope shape — boost multipliers + phase lengths (seconds). INHALE is tuned
// to ~match the gate's 0.30s drop, so the room bottoms out the instant the
// grate slams and the surge then reveals the arena.
const INHALE_S = 0.35, INHALE_BOOST = 0.35;   // gutter down
const SURGE_S = 0.55;                          // whoom up to HOLD
const HOLD_BOOST = 1.4;                        // sustained "hot room"
const FLARE_S = 0.18, FLARE_BOOST = 2.0;       // the finish pop
const EXHALE_S = 2.6;                          // slow ease down (slower than surge)
const RESIDUAL_BOOST = 1.08;                   // faint afterglow left behind

type Phase = 'inhale' | 'surge' | 'hold' | 'flare' | 'exhale' | 'done';

interface Arc {
  torches: Torch[];
  phase: Phase;
  t: number;       // seconds into the current phase
  from: number;    // boost captured at the start of flare/exhale (smooth handoff)
}

const arcs = new Map<string, Arc>();
let subscribed = false;

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeIn = (x: number) => x * x;

function roomTorches(roomId: string): Torch[] {
  const level = getActiveLevel();
  if (!level) return [];
  const room = level.spec.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const hw = room.rect.w / 2, hd = room.rect.d / 2;
  return level.torches.filter((t) => {
    const dx = t.position.x - room.rect.x;
    const dz = t.position.z - room.rect.z;
    return Math.abs(dx) <= hw && Math.abs(dz) <= hd;
  });
}

/** The boost the arc applies right now, for the current phase + elapsed t. */
function currentBoost(arc: Arc): number {
  switch (arc.phase) {
    case 'inhale': return 1 + (INHALE_BOOST - 1) * easeIn(Math.min(1, arc.t / INHALE_S));
    case 'surge':  return INHALE_BOOST + (HOLD_BOOST - INHALE_BOOST) * easeOut(Math.min(1, arc.t / SURGE_S));
    case 'hold':   return HOLD_BOOST;
    case 'flare':  return arc.from + (FLARE_BOOST - arc.from) * easeOut(Math.min(1, arc.t / FLARE_S));
    case 'exhale': return arc.from + (RESIDUAL_BOOST - arc.from) * easeOut(Math.min(1, arc.t / EXHALE_S));
    default:       return RESIDUAL_BOOST;
  }
}

function setBoost(arc: Arc, boost: number): void {
  for (const t of arc.torches) t.envBoost = boost;
}

/** Subscribe once at boot. */
export function initArenaLightArc(): void {
  if (subscribed) return;
  subscribed = true;
  on((e) => {
    if (e.type === 'encounter:activated' && e.id.startsWith(PREFIX)) {
      const torches = roomTorches(e.id.slice(PREFIX.length));
      if (torches.length) arcs.set(e.id, { torches, phase: 'inhale', t: 0, from: 1 });
    } else if (e.type === 'encounter:complete' && e.id.startsWith(PREFIX)) {
      const arc = arcs.get(e.id);
      if (!arc) return;
      arc.from = currentBoost(arc);   // flare starts from wherever the hold left us
      arc.phase = 'flare';
      arc.t = 0;
    }
  });
}

export function tickArenaLightArc(dt: number): void {
  if (!arcs.size) return;
  for (const [id, arc] of arcs) {
    arc.t += dt;
    if (arc.phase === 'inhale' && arc.t >= INHALE_S) { arc.phase = 'surge'; arc.t = 0; }
    else if (arc.phase === 'surge' && arc.t >= SURGE_S) { arc.phase = 'hold'; arc.t = 0; }
    else if (arc.phase === 'flare' && arc.t >= FLARE_S) { arc.from = FLARE_BOOST; arc.phase = 'exhale'; arc.t = 0; }
    else if (arc.phase === 'exhale' && arc.t >= EXHALE_S) { arc.phase = 'done'; }

    setBoost(arc, currentBoost(arc));

    // Settled: leave the torches at the residual afterglow and stop ticking.
    // The faint glow persists (the cleared-arena scar) until the floor unloads.
    if (arc.phase === 'done') arcs.delete(id);
  }
}

/** Level load: drop every envelope and restore boosts. Belt-and-braces — the
 *  torches are rebuilt per level anyway, but a stale arc must not outlive them. */
export function clearArenaLightArc(): void {
  for (const arc of arcs.values()) setBoost(arc, 1);
  arcs.clear();
}
