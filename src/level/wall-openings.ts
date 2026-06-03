import type { RoomSpec } from './types';

// Wall-opening geometry math, extracted from builder.ts. Pure range/coord
// helpers used when baking room shells (where to leave doorway gaps) and
// when placing threshold drafts. No THREE, no game state.

// Find segments where another rect's edge coincides with this wall edge.
// "Coincides" = on the same line (same perpendicular coord) AND overlapping
// in the running-axis direction.
export function findOpenings(
  we: { perpAxis: 'x' | 'z'; perpCoord: number; wallStart: number; wallEnd: number },
  allRects: RoomSpec[],
  selfRoom: RoomSpec,
): Array<{ start: number; end: number }> {
  const EPS = 0.01;
  const openings: Array<{ start: number; end: number }> = [];
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
      if (!coincides) continue;
      const a = Math.max(we.wallStart, o.x - o.w / 2);
      const b = Math.min(we.wallEnd, o.x + o.w / 2);
      if (b > a + EPS) openings.push({ start: a, end: b });
    } else {
      // wall runs along Z; coincide if any of other's X-edges == we.perpCoord
      const oEast = o.x + o.w / 2;
      const oWest = o.x - o.w / 2;
      const coincides = Math.abs(oEast - we.perpCoord) < EPS || Math.abs(oWest - we.perpCoord) < EPS;
      if (!coincides) continue;
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
