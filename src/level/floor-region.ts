// ── WHAT A ROOM'S FLOOR CAN BE ASKED ─────────────────────────────────────────
//
// Companion to wall-surfaces.ts. That one answers "which wall"; this one answers
// "where in the open floor", which is the other half of every placement.
//
// THE BUG IT EXISTS TO KILL. Every placer in the game treats `rect.x, rect.z` as
// "the middle of the room" — the altar, the centrepiece, the boss spawn, the
// fate fire. For a rectangle that is true. For an L-shaped room the centre of
// the bounding box is IN THE WALL, and for a cross or an apse it can be in a
// part of the room nobody stands in. The failure is silent and it looks like a
// content mistake: the altar is "badly placed", so somebody nudges it, and the
// next seed puts it back.
//
// The right notion of "the middle" is not the centroid and not the bbox centre.
// It is the POLE OF INACCESSIBILITY — the interior point furthest from any wall.
// That is also, not coincidentally, exactly what a centrepiece wants: the spot
// with the most room around it.
//
// From the same primitive (distance to the nearest edge) falls out the general
// query the rest of placement needs: give me somewhere with at least r metres of
// clearance, in this band of distance-from-wall, and let me seed more candidates
// than I will fill.
//
// Pure and Three-free — askable in a test or an audit without a renderer.

import { pointInPoly, polyBounds, type Poly } from './room-shape';

export type Vec2 = { x: number; z: number };

/**
 * Distance from (x, z) to the nearest wall — NEGATIVE outside the room.
 *
 * The signed convention matters: it lets one number answer both "am I inside"
 * and "how much room is around me", so a caller can't check one and forget the
 * other. (Every "is it in the room" bug in this codebase has been someone
 * checking containment and not clearance, or the reverse.)
 */
export function clearance(poly: Poly, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = distPointSeg(x, z, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return pointInPoly(poly, x, z) ? best : -best;
}

function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * THE MIDDLE OF THE ROOM: the interior point furthest from any wall.
 *
 * Coarse grid, then a shrinking local search around the best cell — a poor
 * man's pole of inaccessibility. Not the published quadtree algorithm, because
 * a room is 10m across and half a centimetre of precision is far below what any
 * placement cares about; the grid alone already beats the bbox centre by the
 * only measure that matters (it is always actually inside the room).
 */
export function roomCenter(poly: Poly): Vec2 {
  const b = polyBounds(poly);
  const step0 = Math.max(0.25, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 16);
  let best: Vec2 = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  let bestC = clearance(poly, best.x, best.z);
  for (let x = b.minX + step0 / 2; x < b.maxX; x += step0) {
    for (let z = b.minZ + step0 / 2; z < b.maxZ; z += step0) {
      const c = clearance(poly, x, z);
      if (c > bestC) { bestC = c; best = { x, z }; }
    }
  }
  // Refine: halve the radius each round, sample the eight neighbours.
  for (let step = step0 / 2; step > 0.02; step /= 2) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = best.x + Math.cos(a) * step, z = best.z + Math.sin(a) * step;
      const c = clearance(poly, x, z);
      if (c > bestC) { bestC = c; best = { x, z }; }
    }
  }
  return best;
}

export interface SpotOpts {
  /** Minimum clearance the thing needs — its own radius plus elbow room. */
  radius: number;
  /**
   * Where in the room it belongs, as a distance-from-wall band in metres.
   * `[0.4, 1.2]` is the clutter band (against the walls); `[2.5, Infinity]` is
   * the centrepiece band. Omit for anywhere with enough clearance.
   */
  band?: [number, number];
  /** Grid pitch. Finer = more candidates, not better ones. */
  pitch?: number;
  /** Things already placed; candidates must clear each by its radius. */
  taken?: ReadonlyArray<Vec2 & { r: number }>;
}

/**
 * Every spot in the room that could hold this thing.
 *
 * CANDIDATES, not a decision. Per docs/LEVEL-ARCHITECTURE.md the reason
 * placement reads as chosen rather than regular is that we seed far more
 * candidates than we fill and then pick — so this deliberately returns a lot,
 * sorted by clearance (roomiest first) so a caller that just takes the head
 * gets a sensible answer without thinking about it.
 */
export function candidateSpots(poly: Poly, o: SpotOpts): Array<Vec2 & { clearance: number }> {
  const b = polyBounds(poly);
  const pitch = o.pitch ?? 0.5;
  const [lo, hi] = o.band ?? [0, Infinity];
  const out: Array<Vec2 & { clearance: number }> = [];
  for (let x = b.minX + pitch / 2; x < b.maxX; x += pitch) {
    for (let z = b.minZ + pitch / 2; z < b.maxZ; z += pitch) {
      const c = clearance(poly, x, z);
      if (c < o.radius || c < lo || c > hi) continue;
      if (o.taken?.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + o.radius)) continue;
      out.push({ x, z, clearance: c });
    }
  }
  out.sort((p, q) => q.clearance - p.clearance);
  return out;
}

/**
 * Is there an unobstructed straight line between two points inside the room?
 *
 * Sightline is what "the player can SEE this event from the door" means, and it
 * is a question a rectangle could never answer — it had no idea where its own
 * walls were. Here it is one segment-vs-polygon test.
 *
 * Walls only. Props do not block it, deliberately: an event you can see over a
 * chest is still an event you can see.
 */
export function hasSightline(poly: Poly, from: Vec2, to: Vec2): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (segmentsCross(from.x, from.z, to.x, to.z, a[0], a[1], b[0], b[1])) return false;
  }
  return true;
}

function segmentsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const s = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = s(ax, az, bx, bz, cx, cz), d2 = s(ax, az, bx, bz, dx, dz);
  const d3 = s(cx, cz, dx, dz, ax, az), d4 = s(cx, cz, dx, dz, bx, bz);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
         ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
