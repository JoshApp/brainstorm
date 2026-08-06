import { polyBounds, type Poly } from './room-shape';
import {
  circulates, walkableCells, areaLoss,
  type BlockRect, type CirculationAsk,
} from './room-circulation';

// ── CUTTING A HOLE IN THE FLOOR ──────────────────────────────────────────────
//
// The polygon generator had no voids at all. The vault path did — `carve-pass`
// sprinkles rifts through ASCII vaults — which meant chasms were a thing that
// existed on the OLD floors and vanished on the new ones. This closes that.
//
// It is deliberately NOT a port of the carve pass. That one sprinkles by palette
// density and had to be fenced off staged rooms after it put chasms through the
// middle of troves and shops. The rule it learned is the rule this starts from:
//
//   A HOLE IN THE FLOOR MEANS SOMETHING, OR IT ISN'T THERE.
//
// A void is the single strongest geometry statement the game can make about a
// room — it removes floor, it blocks a line, it is the only thing here you
// cannot walk through — and spending it at random is the floor's equivalent of
// decorating with god rays (docs/VISUAL-LANGUAGE.md, "lighting as signal").
//
// ── WHY A RIFT AND NOT A PIT ─────────────────────────────────────────────────
//
// A pit in the middle of a room is a donut: it splits the floor into a ring you
// walk around, which reads as an obstacle course and plays as a detour. A RIFT —
// long, narrow, running off toward a wall — cuts the room into two halves that
// still meet at one end, which is a CHOICE about which side you take and a line
// an archer can hold. Same area removed, completely different room.
//
// So the proposal is always a rift, laid across the room's SHORT axis (so it
// spans something) and stopped short of both walls (so it never seals).
//
// ── AND IT NEVER SHIPS UNVERIFIED ────────────────────────────────────────────
//
// Same shape as room-interior.ts: propose, then verify with the shared check in
// room-circulation.ts. `planVoids` cannot return a rift it has not flooded —
// the verify is not the caller's job. A sealed room is a dead run, and a void
// seals a room far more easily than a pillar does.

export interface VoidOpts {
  /** Doorway centres. Circulation is judged between these. */
  doorways: ReadonlyArray<{ x: number; z: number }>;
  /** Points that must stay reachable — centrepiece, stair, spawns. */
  mustReach?: ReadonlyArray<{ x: number; z: number }>;
  /** Circles already spoken for (piers, lamps, the thing the room is about).
   *  A rift may not open under any of them. */
  avoid?: ReadonlyArray<{ x: number; z: number; r: number }>;
  rand: () => number;
}

/** Below this a room has no business having a hole in it — the rift would BE
 *  the room. Larger than the interior planner's floor for the same reason a
 *  chasm is a bigger statement than a pillar. */
const MIN_AREA = 58;
/** A rift is this share of the room's short span, at most. */
const SPAN_SHARE = 0.62;
/** Rift width, metres. Wide enough to read as impassable from the far side;
 *  narrow enough that the room is still one room. */
const WIDTH_M: readonly number[] = [1.3, 1.8, 2.4];
/** Kept clear at both ends, so the rift never touches a wall and never seals. */
const END_MARGIN = 1.6;
/** Most floor a rift may cost. Tighter than the interior planner's third —
 *  removed floor is removed, where a pillar you can at least walk around. */
const MAX_AREA_LOSS = 0.22;
/** Tries before giving up. A room that will not take a rift simply doesn't. */
const ATTEMPTS = 12;

/**
 * Propose a rift for this room, or null.
 *
 * Null is the common and correct answer — most rooms should not have a hole in
 * the floor. The caller decides HOW OFTEN to ask; this decides whether the room
 * can take one at all.
 */
export function planVoids(poly: Poly, opts: VoidOpts): BlockRect[] | null {
  const b = polyBounds(poly);
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const baseline = walkableCells(poly, {});
  if (baseline.size * 0.25 * 0.25 < MIN_AREA) return null;

  const ask: CirculationAsk = {
    doorways: opts.doorways,
    mustReach: opts.mustReach,
    maxAreaLoss: MAX_AREA_LOSS,
  };

  // Across the SHORT axis, so the rift spans the room rather than running
  // alongside it. A rift parallel to the long walls is a kerb; a rift across
  // them is a decision.
  const acrossX = w <= d;
  const span = (acrossX ? w : d) * SPAN_SHARE;
  if (span < 2.4) return null;

  for (let i = 0; i < ATTEMPTS; i++) {
    const width = WIDTH_M[Math.floor(opts.rand() * WIDTH_M.length)];
    // Offset from the middle — a rift on the centre line splits the room evenly,
    // which is the least interesting of every possible cut.
    const t = 0.28 + opts.rand() * 0.44;
    const rift: BlockRect = acrossX
      ? { x: b.minX + w * 0.5, z: b.minZ + d * t, w: span, d: width }
      : { x: b.minX + w * t, z: b.minZ + d * 0.5, w: width, d: span };

    // Never under something already placed.
    if ((opts.avoid ?? []).some((a) =>
      Math.abs(a.x - rift.x) <= rift.w / 2 + a.r && Math.abs(a.z - rift.z) <= rift.d / 2 + a.r)) continue;
    // Never touching a doorway — you would step out of a corridor into air.
    if (opts.doorways.some((dw) =>
      Math.abs(dw.x - rift.x) <= rift.w / 2 + END_MARGIN
      && Math.abs(dw.z - rift.z) <= rift.d / 2 + END_MARGIN)) continue;

    if (!circulates(poly, { rects: [rift] }, ask, baseline.size)) continue;
    return [rift];
  }
  return null;
}

/** Exported for the audit + tests: how much floor these rifts cost. */
export function voidAreaLoss(poly: Poly, rects: readonly BlockRect[]): number {
  return areaLoss(poly, { rects });
}
