import type { LevelSpec, PropSpec, RoomSpec, PropFacing } from './types';
import { rectAtIn, type RectLike } from './rect-at';

/** A space the cardinal fallback can be standing in — a room with its floor
 *  polygon, or a corridor, whose box IS its floor. */
type SpaceBox = RectLike;
import { describeWalls, nearestSurface, type WallSurface } from './wall-surfaces';
import { pointInPoly } from './room-shape';

// Facing resolver.
//
// Props declare their facing intent via the optional `facing`
// directive (see types.ts PropFacing). The composer calls
// resolveAllFacings() once after parsing, before the rest of the
// decoration pipeline runs. This module walks every prop with a
// `facing` directive, computes the concrete rotY based on the
// directive + the prop's position + the surrounding rooms, and
// writes that rotY back onto the prop (clearing the directive).
//
// Convention: a prop's FRONT is its local +Z direction. At
// rotY=0 the prop's front faces world +Z (south). The resolver
// rotates the prop so the front lines up with the directive's
// target.
//
// Directives:
//   fixed         → use the explicit rotY
//   wall-away     → front faces away from the nearest wall of
//                   the containing room (back against wall)
//   wall-toward   → front faces the nearest wall
//   point-away    → front points opposite of (x, z)
//   point-toward  → front points at (x, z)
//
// rotY for cardinal walls (assuming nearest wall is named):
//   N → 0       (back at N, front at S)
//   S → π       (back at S, front at N)
//   W → π/2     (back at W, front at E)
//   E → -π/2    (back at E, front at W)

export function resolveAllFacings(spec: LevelSpec): void {
  // ── WHICH SPACE IS THIS PROP IN? ────────────────────────────────────────────
  //
  // Carried as `RectLike` nodes so the cardinal fallback can ask `rectAtIn` —
  // the ONE place that owns the rule, polygon beating box and smallest box
  // among equals. It used to ask `findContainingRect`, which returned the FIRST
  // rect whose box contained the point.
  //
  // That is wrong here for the reason rect-at.ts exists: a corridor rect
  // deliberately ends INSIDE the room it serves, so at a point a metre inside a
  // room TWO boxes contain you. First-match handed a prop standing in a
  // corridor the ROOM's 10.5x10.5 box, and `nearestWall` then computed its
  // facing off a wall that prop is nowhere near. Measured before this change:
  // 269 of 1841 props that reach the fallback, 15%, attributed to the wrong
  // space.
  const spaces = [
    ...spec.rooms.map((r) => ({ cx: r.rect.x, cz: r.rect.z, hw: r.rect.w / 2, hd: r.rect.d / 2, poly: r.poly })),
    ...spec.corridors.map((r) => ({ cx: r.rect.x, cz: r.rect.z, hw: r.rect.w / 2, hd: r.rect.d / 2, poly: undefined })),
  ];
  // POLYGON ROOMS can answer "which wall" exactly, so they get the exact answer.
  // The cardinal path below quantises every facing to a right angle, which is
  // correct for a rectangle and wrong the moment a wall is chamfered or
  // diagonal: a chest set `wall-away` against a 45° wall comes out 45° off, and
  // it reads as somebody having placed it badly rather than as the model being
  // unable to express that wall. Nothing crashes, nothing looks broken in a
  // screenshot of a dark room, and the "fix" is a number a human nudges by hand
  // forever. Built only for rooms that HAVE a polygon; every existing floor is
  // rects and takes the old road unchanged.
  const polyWalls = new Map<RoomSpec, WallSurface[]>();
  for (const r of spec.rooms) {
    if (r.poly && r.poly.length >= 3) {
      polyWalls.set(r, describeWalls({ poly: r.poly, height: r.height, elevation: r.elevation }));
    }
  }
  for (const prop of spec.props) {
    if (!('facing' in prop) || !prop.facing) continue;
    const rotY = resolveFacing(prop, prop.facing, spaces, polyWalls);
    // Write back as concrete rotY. Strip the directive so
    // downstream code doesn't try to re-resolve.
    (prop as { rotY?: number }).rotY = rotY;
    delete (prop as { facing?: PropFacing }).facing;
  }
}

function resolveFacing(
  prop: PropSpec & { x: number; z: number },
  f: PropFacing,
  spaces: SpaceBox[],
  polyWalls: Map<RoomSpec, WallSurface[]>,
): number {
  switch (f.kind) {
    case 'fixed':
      return f.rotY;
    case 'wall-away': {
      // A surface's `facingY` already points INTO the room from that wall, which
      // is precisely "back against the stone, front to the room".
      const s = polySurfaceFor(prop.x, prop.z, polyWalls);
      if (s) return s.facingY;
      return rotForWallAway(nearestWall(prop.x, prop.z, spaces));
    }
    case 'wall-toward': {
      const s = polySurfaceFor(prop.x, prop.z, polyWalls);
      if (s) return wrapAngle(s.facingY + Math.PI);
      // Add π to "away" rotation to flip the front toward the wall.
      return wrapAngle(rotForWallAway(nearestWall(prop.x, prop.z, spaces)) + Math.PI);
    }
    case 'point-away': {
      const dx = prop.x - f.x;
      const dz = prop.z - f.z;
      // Front (+Z) should align with (dx, dz). Local +Z after
      // Y-rotation θ becomes (sin θ, cos θ) in world XZ. So
      // sin θ = dx/mag, cos θ = dz/mag → θ = atan2(dx, dz).
      return Math.atan2(dx, dz);
    }
    case 'point-toward': {
      const dx = f.x - prop.x;
      const dz = f.z - prop.z;
      return Math.atan2(dx, dz);
    }
  }
}

/** The nearest wall FACE, when the prop stands in a polygon room. Null in every
 *  rect room, which falls through to the cardinal path below. */
function polySurfaceFor(
  x: number, z: number, polyWalls: Map<RoomSpec, WallSurface[]>,
): WallSurface | null {
  for (const [room, walls] of polyWalls) {
    if (!pointInPoly(room.poly!, x, z)) continue;
    return nearestSurface(walls, x, z);
  }
  return null;
}

type WallDir = 'N' | 'S' | 'W' | 'E';

/** Find the nearest wall side of the containing rect to a point.
 *  If the point sits outside any rect (shouldn't happen, but be
 *  safe) return 'N' as a deterministic default. */
function nearestWall(x: number, z: number, spaces: SpaceBox[]): WallDir {
  const rect = rectAtIn(spaces, x, z);
  if (!rect) return 'N';
  const dN = z - (rect.cz - rect.hd);
  const dS = (rect.cz + rect.hd) - z;
  const dW = x - (rect.cx - rect.hw);
  const dE = (rect.cx + rect.hw) - x;
  const dMin = Math.min(dN, dS, dW, dE);
  if (dMin === dN) return 'N';
  if (dMin === dS) return 'S';
  if (dMin === dW) return 'W';
  return 'E';
}

function rotForWallAway(dir: WallDir): number {
  switch (dir) {
    case 'N': return 0;
    case 'S': return Math.PI;
    case 'W': return Math.PI / 2;
    case 'E': return -Math.PI / 2;
  }
}

/** Normalise an angle to (-π, π]. */
function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
