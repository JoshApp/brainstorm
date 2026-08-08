import type { LevelSpec, StairsSpec, WalkableRect } from './types';
import { STAIRWELL_TOTAL_DEPTH, STAIRWELL_HALF_WIDTH } from '../interactables/stairs';

// Unified geometry culling.
//
// Anything that CHANGES the shape of a room — a corridor carved
// through a wall, a stair hole punched in the floor — is the
// source of truth for which prop placements are valid. This
// module centralises that knowledge:
//
//   - wallOpenings(rect, side, allRects): the sub-ranges of one
//     wall of `rect` that have been carved away because another
//     rect (corridor or adjacent room) sits flush on the other
//     side.
//   - stairFootprints(spec): rotated AABBs covering each stair
//     body + approach corridor.
//   - point/wall helpers that consume the above.
//
// Both the clutter scatter pass and the composer's torch filter
// query this module so the rules stay consistent. When the
// builder later carves the actual hole / cuts / wall openings it
// uses the same rect math, so what gets culled here matches
// what gets rendered.

export interface Opening {
  /** Position along the wall's running axis where the opening starts. */
  start: number;
  /** End of the opening along the wall's running axis. */
  end: number;
}

export interface StairFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Find sub-ranges of one wall of `self` where another rect sits
 * flush on the opposite side. The builder will carve those ranges
 * out so the corridor / adjoining room joins on. Props mounted
 * inside an opening would float in mid-air post-carve.
 */
export function wallOpenings(
  self: WalkableRect,
  side: 'N' | 'S' | 'E' | 'W',
  allRects: WalkableRect[],
): Opening[] {
  const EPS = 0.05;
  const out: Opening[] = [];
  for (const other of allRects) {
    if (other === self) continue;
    // Same identity check — same centre + same size means same room
    // (allRects can include duplicates depending on caller).
    if (Math.abs(other.x - self.x) < 1e-6
        && Math.abs(other.z - self.z) < 1e-6
        && other.w === self.w && other.d === self.d) continue;

    if (side === 'N' || side === 'S') {
      const wallZ = side === 'N' ? self.z - self.d / 2 : self.z + self.d / 2;
      const oN = other.z - other.d / 2;
      const oS = other.z + other.d / 2;
      const coincides = Math.abs(oS - wallZ) < EPS || Math.abs(oN - wallZ) < EPS;
      if (!coincides) continue;
      const a = Math.max(self.x - self.w / 2, other.x - other.w / 2);
      const b = Math.min(self.x + self.w / 2, other.x + other.w / 2);
      if (b > a + EPS) out.push({ start: a, end: b });
    } else {
      const wallX = side === 'W' ? self.x - self.w / 2 : self.x + self.w / 2;
      const oW = other.x - other.w / 2;
      const oE = other.x + other.w / 2;
      const coincides = Math.abs(oE - wallX) < EPS || Math.abs(oW - wallX) < EPS;
      if (!coincides) continue;
      const a = Math.max(self.z - self.d / 2, other.z - other.d / 2);
      const b = Math.min(self.z + self.d / 2, other.z + other.d / 2);
      if (b > a + EPS) out.push({ start: a, end: b });
    }
  }
  return out;
}

/** True if `pos` falls within any of the given openings (with
 *  optional slack so positions a hair outside still count — the
 *  geometry edge is a thin wall slab, anything within slack of an
 *  opening is effectively floating once the slab is removed). */
export function inOpening(pos: number, openings: Opening[], slack: number = 0.4): boolean {
  for (const o of openings) {
    if (pos >= o.start - slack && pos <= o.end + slack) return true;
  }
  return false;
}

/** AABB covering the full stair body in its descent direction +
 *  a generous approach zone in front of the mouth so props don't
 *  spawn where the player has to walk to reach the stair. For
 *  cardinal stair rotations (the only ones the parser produces)
 *  the rotated body is itself axis-aligned, so the AABB is exact. */
export function stairFootprint(s: StairsSpec): StairFootprint {
  const rotY = s.rotY ?? 0;
  const dirX = Math.sin(rotY);
  const dirZ = Math.cos(rotY);
  const APPROACH = 1.6;
  const SIDE = STAIRWELL_HALF_WIDTH + 0.55;
  const bx = s.x + dirX * STAIRWELL_TOTAL_DEPTH;
  const bz = s.z + dirZ * STAIRWELL_TOTAL_DEPTH;
  const fx = s.x - dirX * APPROACH;
  const fz = s.z - dirZ * APPROACH;
  const sideDx = Math.abs(dirZ) * SIDE;
  const sideDz = Math.abs(dirX) * SIDE;
  return {
    minX: Math.min(bx, fx) - sideDx,
    maxX: Math.max(bx, fx) + sideDx,
    minZ: Math.min(bz, fz) - sideDz,
    maxZ: Math.max(bz, fz) + sideDz,
  };
}

/** Convenience: all stair footprints in a level. */
export function allStairFootprints(spec: LevelSpec): StairFootprint[] {
  return (spec.stairs ?? []).map(stairFootprint);
}

/** True if a point falls in any of the given footprints. */
export function inAnyStair(x: number, z: number, footprints: StairFootprint[]): boolean {
  for (const f of footprints) {
    if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) return true;
  }
  return false;
}

/**
 * The first rect whose BOX contains a point. RECT-ERA FLOORS ONLY.
 *
 * ── DO NOT USE THIS ON A POLYGON FLOOR ───────────────────────────────────────
 *
 * It answers "which box am I in" with the first box that matches, and on a
 * polygon floor that is wrong twice over. A corridor rect deliberately ends
 * INSIDE the room it serves, so a point a metre inside a room is in TWO boxes;
 * and a room's box is not its floor. `level/rect-at.ts` owns the real rule —
 * polygon beats box, smallest box among equals — and everything that has to be
 * right about a polygon floor asks it.
 *
 * Measured when `facing.ts` was still asking this one: 269 of 1841 props, 15%,
 * were attributed to the wrong space, so a prop standing in a corridor took its
 * facing from the enclosing room's wall.
 *
 * What is left here is the vault path (`clutter.ts`), where a room's box IS its
 * floor and there are no polygons to disagree with. That is the only case this
 * is correct for, and it stays only because that pipeline still exists.
 */
export function findContainingRect(
  x: number, z: number,
  rects: WalkableRect[],
  slack: number = 0.01,
): WalkableRect | null {
  for (const r of rects) {
    if (x > r.x - r.w / 2 - slack && x < r.x + r.w / 2 + slack
        && z > r.z - r.d / 2 - slack && z < r.z + r.d / 2 + slack) {
      return r;
    }
  }
  return null;
}
