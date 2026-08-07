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
      if (b > a + EPS) openings.push({ start: a, end: b });
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
      if (b > a + EPS) openings.push({ start: a, end: b });
    }
  }
  return openings;
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
