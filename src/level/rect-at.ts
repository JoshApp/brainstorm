import { pointInPoly, type Poly } from './room-shape';

// ── WHICH SPACE IS THIS POINT IN? ────────────────────────────────────────────
//
// One question, asked by every system that has to decide what a thing belongs to: the culler
// (what do I draw), the nav/room graph (what is next to what), the frame-boundary resolver
// (which two rooms does this doorway join), the light pool, the signal layer.
//
// ── IT USED TO ASK ABOUT BOUNDING BOXES, AND THAT WAS THE BUG ────────────────
//
// This file was written when rooms WERE rects: a room's box was its floor, so "which rect
// contains this point" had one honest answer. Rooms then became polygons and `rect` was
// demoted — the type contract now requires it to be "the polygon's BOUNDING BOX" — but this
// lookup kept asking about boxes, and a room's box is far larger than its floor.
//
// So a corridor that stops CLEANLY at a room's wall still overlapped that room's box, by
// 3-5 m² routinely. Two spaces claimed the point, a tie-break was needed, and smallest-box
// -wins handed a room's own sconce to the corridor behind it. Then every consumer that could
// not live with that answer invented its OWN tie-break — nearest-rect, generous-overlap —
// and they disagreed with each other. A torch's stone, its light and its flame could each
// end up in a different room. Josh: *"why do corridor rects reach inside the room it serves
// — didn't we get rid of that?"* We did. This lookup never found out.
//
// Measured over twenty floors (scripts/measure-space-overlap.ts, tests/space-attribution):
// 190 m² of box overlap against 1.0 m² of real shared floor, and 341 ambiguous floor points
// against 25. NINETY-THREE PERCENT of the ambiguity every tie-break existed to resolve was
// manufactured by asking the wrong question.
//
// ── SO IT ASKS ABOUT FOOTPRINTS ─────────────────────────────────────────────
//
// A room's footprint is its polygon. A corridor's is its rect, and that is not a
// compromise — an axis-aligned box genuinely IS a corridor's floor, which is why corridors
// carry no polygon at all (measured: 0 of 212).
//
// The box is kept as a broad phase, because it is a cheap reject and correct as one.
//
// Two questions, named apart, because they are not the same question and folding them
// together is how the tie-break got in:
//
//   spaceAt   — a point ON a floor. Exact. Returns null in a wall, and null MEANS null.
//   spaceNear — a point mounted ON THE ARCHITECTURE, which is outside every floor by
//               design. Steps inward to the nearest real floor.
//
// Pure, THREE-free, and exported so an audit can ask the shipping question rather than
// re-implement it and launder a guess as a measurement.

/** Slack on the broad-phase box, metres. */
export const RECT_EPS = 0.05;

export interface RectLike {
  cx: number; cz: number; hw: number; hd: number;
  /** The real floor, when the space has one. Absent for corridors, whose rect IS their
   *  floor, and for the rect-era rooms that predate polygons. */
  poly?: Poly;
}

/**
 * How strong is this space's claim on the point? Assumes the broad phase already passed.
 *
 *   2  DECLARED — it has a polygon and the polygon contains the point. The space has stated
 *      its floor exactly, and a statement beats an assumption.
 *   1  ASSUMED — it has no polygon, so its rect is taken to be its floor. True of every
 *      corridor, and honest: an axis-aligned box IS a corridor's floor.
 *   0  NO CLAIM — it has a polygon and the polygon does NOT contain the point. The box
 *      reaching here means nothing; this is the case that used to hand a room's own sconce
 *      to the corridor behind it.
 */
function claim(n: RectLike, x: number, z: number): 0 | 1 | 2 {
  if (!n.poly || n.poly.length < 3) return 1;
  return pointInPoly(n.poly, x, z) ? 2 : 0;
}

function area(n: RectLike): number {
  return n.hw * n.hd;
}

/**
 * The space whose FLOOR this point stands on, or null.
 *
 * Generic over the node type so the culler keeps its `RectNode` and the graph keeps its
 * `GraphNode` — this owns the RULE, not their data.
 *
 * Two spaces can still both claim a point where their floors genuinely overlap, which
 * measures at 0.1% of floor area rather than the 1.3% the box test produced. The order is:
 * a DECLARED floor beats an ASSUMED one, and among equals the tighter floor wins. Both are
 * documented rules rather than a coin toss decided fresh every frame.
 */
export function rectAtIn<T extends RectLike>(nodes: Iterable<T>, x: number, z: number): T | null {
  let best: T | null = null;
  let bestClaim = 0;
  for (const n of nodes) {
    if (x < n.cx - n.hw - RECT_EPS || x > n.cx + n.hw + RECT_EPS
      || z < n.cz - n.hd - RECT_EPS || z > n.cz + n.hd + RECT_EPS) continue;
    const c = claim(n, x, z);
    if (c === 0) continue;                       // a box that merely reaches here
    if (c > bestClaim) { best = n; bestClaim = c; continue; }
    if (c < bestClaim) continue;                 // a declared floor is never beaten by a box
    if (!best || area(n) < area(best)) best = n; // among equals, the tighter floor
  }
  return best;
}

/** Metres to step looking for floor around a mounted point. Clears the 0.25m masonry band
 *  with room to spare, and is far short of anything that could reach a different room. */
export const MOUNT_BAND_M = 0.6;

/**
 * The space a thing MOUNTED ON THE ARCHITECTURE belongs to — a sconce, a wall rune, a
 * doorway fitting.
 *
 * Its position sits in the masonry, which is outside every floor by construction, so an
 * exact lookup correctly returns null and a caller that treats null as "nowhere" hides it.
 * The honest rule is to step inward and ask again: the floor a mounted thing FACES is the
 * space it belongs to.
 *
 * Samples a ring rather than guessing a direction, and takes the nearest hit, so a torch in
 * an inside corner resolves to the room it lights rather than to whichever neighbour a
 * single probe happened to point at.
 */
export function rectNearIn<T extends RectLike>(
  nodes: Iterable<T>, x: number, z: number, band = MOUNT_BAND_M,
): T | null {
  const exact = rectAtIn(nodes, x, z);
  if (exact) return exact;
  const list = [...nodes];
  // Two rings: most sconces clear the band in a short step, and trying that first keeps the
  // common answer to eight point-in-polygon tests.
  for (const r of [band * 0.5, band]) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const hit = rectAtIn(list, x + Math.cos(ang) * r, z + Math.sin(ang) * r);
      if (hit) return hit;
    }
  }
  return null;
}
