import type { TorchSpec } from './types';
import { mountPoints, type Mount, type WallSurface } from './wall-surfaces';

// ── LIGHTING A ROOM BY ASKING ITS WALLS ──────────────────────────────────────
//
// This is the module the whole polygon effort started from. The starter
// chamber's stair sconce sat at `{ x: -3.95, z: -3.5, wall: 'W' }` for months.
// The room became an apse, the west wall stopped existing at that Z, and the
// sconce hung in the void — and nothing in the code could have noticed, because
// a hand-measured coordinate and a compass letter contain no claim that can be
// checked. I fixed it by hand, which fixes one sconce and none of the others
// that will do the same thing next time a room changes shape.
//
// So a sconce is no longer placed AT a coordinate. It is placed ON a wall, and
// the wall supplies the position, the facing and the guarantee.
//
// ART DIRECTION SURVIVES THIS. A room is not lit uniformly — the point of a
// sconce is what it says about the space it's in. A plan is a PREDICATE over
// walls plus a palette, so "the sanctuary is lit cold and the nave is lit warm"
// stays authorable, it just stops being fourteen magic numbers.

export interface SconcePlan {
  /** Which walls this plan claims. Plans are tried in order and each wall goes
   *  to the FIRST that claims it, so a room can't be lit twice over. */
  pick: (s: WallSurface) => boolean;
  /** Interval band between fixtures on a claimed wall. */
  spacing: [number, number];
  /** Metres above the floor. */
  height: number;
  /** A single colour, or a function of the mount — which is how a long wall can
   *  run warm at one end and cold at the other without being split in two. */
  tint?: number | ((m: Mount) => number);
  intensity?: number | ((m: Mount) => number);
  /** Shortest wall this plan will light. A sconce on a 1m return is a lamp in a
   *  cupboard. */
  minWall?: number;
  fixtureKind?: TorchSpec['fixtureKind'];
}

/**
 * Turn a room's walls into torch specs.
 *
 * Every returned sconce is ON a wall by construction: `mountPoints` guarantees
 * it sits along the run with stone behind it and clear of both ends, and
 * `facingY` gives the bracket an exact angle — including on a chamfer or a
 * diagonal, which the four compass letters could not name at all.
 */
export function sconcesOn(
  surfaces: readonly WallSurface[],
  plans: readonly SconcePlan[],
): TorchSpec[] {
  const out: TorchSpec[] = [];
  for (const s of surfaces) {
    // A doorway jamb is the worst place in the room to bolt a light: the
    // fixture reads as being in the passage, and the passage geometry usually
    // eats it. mountPoints already keeps clear of the ENDS of a run; this drops
    // the run entirely when a doorway made it.
    if (s.jambA && s.jambB) continue;
    const plan = plans.find((p) => (s.length >= (p.minWall ?? 1.6)) && p.pick(s));
    if (!plan) continue;
    for (const m of mountPoints(s, {
      spacing: plan.spacing,
      y: plan.height,
      minRun: plan.minWall ?? 1.6,
      inset: 0.02,
    })) {
      out.push({
        x: m.x,
        z: m.z,
        height: plan.height,
        // `wall` stays for everything downstream that still reads it (the
        // opening filter, the lighting budget). It is now DERIVED — the nearest
        // cardinal to the true facing — and `rotY` carries the exact angle.
        wall: cardinalOf(s),
        rotY: m.rotY,
        colorTint: pick(plan.tint, m),
        intensityMul: pick(plan.intensity, m),
        fixtureKind: plan.fixtureKind,
      });
    }
  }
  return out;
}

function pick<T>(v: T | ((m: Mount) => T) | undefined, m: Mount): T | undefined {
  return typeof v === 'function' ? (v as (m: Mount) => T)(m) : v;
}

/**
 * The compass letter closest to this wall's true facing.
 *
 * Kept only as a LOSSY LABEL for the passes that still think in cardinals.
 * Anything that needs the real angle reads `rotY`; a wall at 45° gets a letter
 * here that is up to 45° wrong, which is exactly why the letter stopped being
 * the source of truth.
 */
function cardinalOf(s: WallSurface): 'N' | 'S' | 'E' | 'W' {
  const [ix, iz] = s.inward;
  if (Math.abs(ix) > Math.abs(iz)) return ix > 0 ? 'W' : 'E';
  return iz > 0 ? 'N' : 'S';
}
