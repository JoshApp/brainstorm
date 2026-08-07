import { pointInPoly } from './room-shape';
import type { RoomSpec } from './types';

// Wall-opening geometry math, extracted from builder.ts. Pure range/coord
// helpers used when baking room shells (where to leave doorway gaps) and
// when placing threshold drafts. No THREE, no game state.

// Find segments where another rect MEETS this wall edge, which happens two ways:
//
//   ABUTS   — the other rect's edge lies on the same line (same perpendicular
//             coord) and overlaps in the running-axis direction. This is how
//             the vault composer connects everything: it lays rooms and
//             corridors on a grid so their edges coincide exactly.
//
//   CROSSES — the wall line runs THROUGH the other rect's interior. A wall
//             buried inside another walkable rect is not a wall; it is a
//             doorway, for exactly the same reason an abutting edge is.
//
// The crossing case only started happening with polygon rooms. A polygon's
// real wall sits back from its bounding box — a notch or a chamfer can set it
// back by metres — so a corridor that MEETS THE WALL necessarily ENDS INSIDE
// THE RECT rather than on its edge. Under the abut-only rule those corridors
// got a solid end cap and sealed themselves: `delve reach` flooded the
// entrance room and reported every other room "never entered", on every
// polygon floor sampled.
//
// Measured before generalising, on the real generator: across 240 vault floors
// and 13048 wall edges, ZERO wall lines run through another rect's interior.
// The composer's grid makes the crossing case unreachable there, so this rule
// cannot change a vault floor — it only describes a situation the old
// generator could not produce.
//
// ── AND IT MUST BE ON THE FAR SIDE ───────────────────────────────────────────
//
// Josh, walking a polygon floor: *"L corridors have missing wall faces."*
//
// ABUTS assumed something the vault's grid guarantees and a dogleg does not:
// that a rect sharing this wall's line is on the OTHER side of it. A dogleg is
// three rects that OVERLAP — the cross piece is laid across the end of a leg,
// so its outer edge is collinear with the leg's outer wall while sitting
// entirely on the same side. Under abut-alone that leg's wall was opened onto
// the void, and you could see straight out of the dungeon.
//
// Measured on the corridor perimeter: 18% of it was open to nothing.
//
// So a neighbour has to actually offer floor BEYOND the wall. Crossing rects
// pass by construction (they have interior on both sides); abutting ones now
// have to prove which side they are on. The vault path is unaffected — on a
// grid every abutting neighbour is on the far side already, which is the
// assumption that was being made implicitly.
//
// ── AND A POLYGON IS NOT ITS BOUNDING BOX ────────────────────────────────────
//
// Josh, still: *"z shaped corridors that are aligned diagonal have still
// missing walls and leak into nothing."*
//
// Everything above reasons about RECTS. For a polygon room the rect is its
// BOUNDING BOX, and the floor inside it can sit metres back from that box — an
// apse, a notch, a chamfered corner. CROSSES was added precisely because a
// corridor meeting a polygon wall ends inside the box; the same rule then
// punched a doorway wherever a corridor's wall merely PASSED THROUGH the box
// with no polygon behind it. The corridor opened its flank onto a bounding box
// and you could walk up to it and look out of the world.
//
// Measured on 300 generated floors: 13 openings, 34.2m of corridor wall opening
// onto nothing — every one of them justified by a polygon room's box.
//
// So a polygon neighbour is asked the question the rect could not answer: is
// there FLOOR just past this wall, here? The candidate range is walked and only
// the covered part of it survives, which also trims a doorway back to the part
// the room can actually receive — the "connection to the rooms can be a bit
// broken if it's angled" half of the same report.
//
// Rect neighbours take exactly the path they took before; there is no polygon,
// so there is nothing to clip and the vault floors cannot notice this.
export function findOpenings(
  we: { perpAxis: 'x' | 'z'; perpCoord: number; wallStart: number; wallEnd: number },
  allRects: RoomSpec[],
  selfRoom: RoomSpec,
): Array<{ start: number; end: number }> {
  const EPS = 0.01;
  const openings: Array<{ start: number; end: number }> = [];
  // Which way is THROUGH? The wall is on one side of its own room's centre;
  // everything a doorway leads to is on the other.
  const selfPerp = we.perpAxis === 'z' ? selfRoom.rect.z : selfRoom.rect.x;
  const farIsPositive = we.perpCoord > selfPerp;
  for (const other of allRects) {
    if (other === selfRoom) continue;
    // Sub-rooms (logical-only) are INSIDE their parent vault rect —
    // their edges often coincide with the parent's exterior walls,
    // which would spuriously punch openings through them. Skip.
    if (other.logicalOnly) continue;
    const o = other.rect;
    if (we.perpAxis === 'z') {
      // wall runs along X; coincide if any of other's Z-edges == we.perpCoord
      const oSouth = o.z + o.d / 2;
      const oNorth = o.z - o.d / 2;
      const coincides = Math.abs(oSouth - we.perpCoord) < EPS || Math.abs(oNorth - we.perpCoord) < EPS;
      const crosses = oNorth < we.perpCoord - EPS && oSouth > we.perpCoord + EPS;
      if (!coincides && !crosses) continue;
      // Does it actually reach past the wall? A neighbour flush against this
      // line from the INSIDE is not a way through — it is the same room.
      if (!(farIsPositive ? oSouth > we.perpCoord + EPS : oNorth < we.perpCoord - EPS)) continue;
      const a = Math.max(we.wallStart, o.x - o.w / 2);
      const b = Math.min(we.wallEnd, o.x + o.w / 2);
      if (b > a + EPS) {
        openings.push(...clipToFloor(other, a, b, (t) => [t, we.perpCoord + (farIsPositive ? PROBE : -PROBE)]));
      }
    } else {
      // wall runs along Z; coincide if any of other's X-edges == we.perpCoord
      const oEast = o.x + o.w / 2;
      const oWest = o.x - o.w / 2;
      const coincides = Math.abs(oEast - we.perpCoord) < EPS || Math.abs(oWest - we.perpCoord) < EPS;
      const crosses = oWest < we.perpCoord - EPS && oEast > we.perpCoord + EPS;
      if (!coincides && !crosses) continue;
      if (!(farIsPositive ? oEast > we.perpCoord + EPS : oWest < we.perpCoord - EPS)) continue;
      const a = Math.max(we.wallStart, o.z - o.d / 2);
      const b = Math.min(we.wallEnd, o.z + o.d / 2);
      if (b > a + EPS) {
        openings.push(...clipToFloor(other, a, b, (t) => [we.perpCoord + (farIsPositive ? PROBE : -PROBE), t]));
      }
    }
  }
  return openings;
}

/** How far past the wall to ask "is there floor here". Comfortably inside the
 *  neighbour and comfortably clear of its boundary, so a sample exactly on the
 *  polygon edge doesn't decide the answer. */
const PROBE = 0.12;
/** Sampling step along the wall. Finer than a doorway is wide by an order of
 *  magnitude, so no real opening is missed or ragged. */
const STEP = 0.12;

/**
 * Keep only the part of [a, b] that has the neighbour's FLOOR behind it.
 *
 * A rect neighbour has floor everywhere in its box, so the range passes through
 * untouched and the vault path is bit-identical to before this existed. A
 * polygon neighbour gets walked: `probe(t)` returns the world point just past
 * the wall at position t, and the covered runs are stitched back into ranges.
 */
function clipToFloor(
  other: RoomSpec, a: number, b: number,
  probe: (t: number) => [number, number],
): Array<{ start: number; end: number }> {
  const poly = other.poly;
  if (!poly || poly.length < 3) return [{ start: a, end: b }];
  const n = Math.max(2, Math.ceil((b - a) / STEP));
  const out: Array<{ start: number; end: number }> = [];
  let runStart: number | null = null;
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n;
    const [px, pz] = probe(t);
    const covered = pointInPoly(poly, px, pz);
    if (covered && runStart === null) runStart = t;
    if (!covered && runStart !== null) {
      if (t - runStart > 0.01) out.push({ start: runStart, end: t });
      runStart = null;
    }
  }
  if (runStart !== null && b - runStart > 0.01) out.push({ start: runStart, end: b });
  return out;
}

// Subtract a set of [start, end] openings from a [start, end] range.
export function subtractRanges(start: number, end: number, openings: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = [...openings].sort((a, b) => a.start - b.start);
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const op of sorted) {
    if (op.start > cursor) segments.push({ start: cursor, end: Math.min(op.start, end) });
    cursor = Math.max(cursor, op.end);
    if (cursor >= end) break;
  }
  if (cursor < end) segments.push({ start: cursor, end });
  return segments;
}

export function torchYawForWall(wall: 'N' | 'S' | 'E' | 'W'): number {
  switch (wall) {
    case 'N': return 0;
    case 'S': return Math.PI;
    case 'E': return -Math.PI / 2;
    case 'W': return Math.PI / 2;
  }
}
