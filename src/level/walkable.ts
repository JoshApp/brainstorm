import type { WalkableRect, ObstacleCircle, Vec2 } from './types';

// Walkable region = union of axis-aligned rectangles MINUS circular obstacles,
// MINUS proximity to explicit wall segments.
//
// Multi-room rule: a position is walkable iff
//   (1) it lies inside the UNION of rects (unshrunken — the player can be at
//       any point inside any rect, including right up against a shared edge
//       that has a doorway through it), AND
//   (2) the player's collision circle does NOT cross any wall segment, AND
//   (3) the player is outside every obstacle circle.
//
// Wall segments come from the level builder, which already computes them by
// chopping each room's 4 edges into pieces around shared-edge doorways. So
// the doorways have no wall segments and the player can walk through them.
//
// Movement uses an axis-decomposed slide: try the X delta alone; if blocked,
// try Z alone. This gives "slide along walls / pillars" behavior for free.

export interface WallSegment {
  ax: number; az: number;
  bx: number; bz: number;
}

export class WalkableRegion {
  constructor(
    private readonly rects: WalkableRect[],
    private readonly obstacles: ObstacleCircle[] = [],
    private readonly walls: WallSegment[] = [],
  ) {}

  /** Is the agent center at (x, z) (with given radius) currently walkable? */
  contains(x: number, z: number, radius: number): boolean {
    // (1) Inside the union of rects — unshrunken. Doorways at shared edges
    // are inside two rects' union, so the player can pass through them.
    let inside = false;
    for (const r of this.rects) {
      const hw = r.w / 2;
      const hd = r.d / 2;
      if (x >= r.x - hw && x <= r.x + hw && z >= r.z - hd && z <= r.z + hd) {
        inside = true;
        break;
      }
    }
    if (!inside) return false;

    // (2) No wall segment is closer than `radius` to the player center.
    // Walls form barriers around rects EXCEPT at doorways — the doorways
    // have no wall segments, so the player can cross those gaps.
    const r2 = radius * radius;
    for (const w of this.walls) {
      if (distSqPointToSegment(x, z, w.ax, w.az, w.bx, w.bz) < r2) return false;
    }

    // (3) Outside every obstacle circle (expanded by radius).
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      const rr = o.r + radius;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  }

  /**
   * Move an agent from oldPos toward newPos, sliding along walls and obstacles.
   * Returns the resolved position the agent should occupy this frame.
   */
  clampMove(oldX: number, oldZ: number, newX: number, newZ: number, radius: number): Vec2 {
    let cx = newX;
    let cz = oldZ;
    // Try X alone
    if (!this.contains(cx, cz, radius)) cx = oldX;
    // Try Z from the (possibly clamped) X
    cz = newZ;
    if (!this.contains(cx, cz, radius)) cz = oldZ;
    return { x: cx, z: cz };
  }
}

// Squared distance from point (px, pz) to segment (ax,az)-(bx,bz).
// Uses squared distances throughout to avoid sqrt in the hot path.
function distSqPointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  if (len2 === 0) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  // Project p onto the line, clamp to [0,1]
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2));
  const cx = ax + t * abx;
  const cz = az + t * abz;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}
