import type { LevelSpec, PropSpec, RoomSpec, PropFacing, WalkableRect } from './types';
import { findContainingRect } from './geometry-cull';

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
  const allRects = [...spec.rooms.map((r) => r.rect), ...spec.corridors.map((r) => r.rect)];
  for (const prop of spec.props) {
    if (!('facing' in prop) || !prop.facing) continue;
    const rotY = resolveFacing(prop, prop.facing, allRects);
    // Write back as concrete rotY. Strip the directive so
    // downstream code doesn't try to re-resolve.
    (prop as { rotY?: number }).rotY = rotY;
    delete (prop as { facing?: PropFacing }).facing;
  }
}

function resolveFacing(
  prop: PropSpec & { x: number; z: number },
  f: PropFacing,
  rects: WalkableRect[],
): number {
  switch (f.kind) {
    case 'fixed':
      return f.rotY;
    case 'wall-away': {
      const dir = nearestWall(prop.x, prop.z, rects);
      return rotForWallAway(dir);
    }
    case 'wall-toward': {
      const dir = nearestWall(prop.x, prop.z, rects);
      // Add π to "away" rotation to flip the front toward the wall.
      return wrapAngle(rotForWallAway(dir) + Math.PI);
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

type WallDir = 'N' | 'S' | 'W' | 'E';

/** Find the nearest wall side of the containing rect to a point.
 *  If the point sits outside any rect (shouldn't happen, but be
 *  safe) return 'N' as a deterministic default. */
function nearestWall(x: number, z: number, rects: WalkableRect[]): WallDir {
  const rect = findContainingRect(x, z, rects, 0.05);
  if (!rect) return 'N';
  const dN = z - (rect.z - rect.d / 2);
  const dS = (rect.z + rect.d / 2) - z;
  const dW = x - (rect.x - rect.w / 2);
  const dE = (rect.x + rect.w / 2) - x;
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
