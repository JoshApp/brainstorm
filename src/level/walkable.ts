import type { WalkableRect, Vec2 } from './types';

// Walkable region = union of axis-aligned rectangles MINUS obstacles, MINUS
// proximity to wall segments.
//
// Multi-room rule: a position is walkable iff
//   (1) it lies inside the UNION of rects (unshrunken — the player can be
//       at any point inside any rect), AND
//   (2) the player's collision circle does NOT cross any wall segment, AND
//   (3) the player is outside every obstacle (circle OR axis-aligned box).
//
// Obstacles support two shapes: 'circle' for round things (skip for now —
// we currently use AABB for everything), and 'aabb' for boxy things. Box
// pillars + altar + chests are far more accurate as AABBs than as circles
// (a circle inscribing a square allows the player to clip the corners; a
// circle CIRCUMSCRIBING a square pushes the player further out than the
// box's actual extent).
//
// Movement uses an axis-decomposed slide: try the X delta alone; if blocked,
// try Z alone. This gives "slide along walls / pillars" behavior for free.

export interface WallSegment {
  ax: number; az: number;
  bx: number; bz: number;
}

export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'aabb'; minX: number; maxX: number; minZ: number; maxZ: number };

export class WalkableRegion {
  constructor(
    private readonly rects: WalkableRect[],
    private readonly obstacles: Obstacle[] = [],
    private readonly walls: WallSegment[] = [],
  ) {}

  /**
   * Add a wall segment. Used by closed doors to plug a doorway gap; the
   * door removes its segment again when it opens. Identity is by reference
   * so the same WallSegment object can be added once and removed once.
   */
  addWall(seg: WallSegment) {
    this.walls.push(seg);
  }

  /** Remove a previously-added wall segment by reference. */
  removeWall(seg: WallSegment) {
    const idx = this.walls.indexOf(seg);
    if (idx >= 0) this.walls.splice(idx, 1);
  }

  /** Is the agent center at (x, z) (with given radius) currently walkable? */
  contains(x: number, z: number, radius: number): boolean {
    // (1) Inside the union of rects (unshrunken). Doorways are inside both
    // adjacent rects' union; the player can cross them.
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
    const r2 = radius * radius;
    for (const w of this.walls) {
      if (distSqPointToSegment(x, z, w.ax, w.az, w.bx, w.bz) < r2) return false;
    }

    // (3) Outside every obstacle.
    for (const o of this.obstacles) {
      if (o.kind === 'circle') {
        const dx = x - o.x;
        const dz = z - o.z;
        const rr = o.r + radius;
        if (dx * dx + dz * dz < rr * rr) return false;
      } else {
        // AABB: distance from circle center to closest point on box.
        if (distSqPointToAabb(x, z, o.minX, o.maxX, o.minZ, o.maxZ) < r2) return false;
      }
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
    if (!this.contains(cx, cz, radius)) cx = oldX;
    cz = newZ;
    if (!this.contains(cx, cz, radius)) cz = oldZ;
    return { x: cx, z: cz };
  }

  /**
   * Line-of-sight check: is the straight 2D path from (ax, az) to (bx, bz)
   * clear of every wall segment? Used by enemy AI to decide if an enemy
   * can see the player. Obstacles (pillars, altar) are intentionally NOT
   * counted as sight-blockers — they block movement but the player can
   * see/be-seen around them, which matches how a real low-profile pillar
   * would feel in a dungeon.
   */
  hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    for (const w of this.walls) {
      if (segmentsIntersect(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return false;
    }
    return true;
  }
}

// 2D segment-segment intersection (excluding shared endpoints — pure cross
// counts as intersecting). Standard orientation test.
function segmentsIntersect(
  p0x: number, p0z: number, p1x: number, p1z: number,
  p2x: number, p2z: number, p3x: number, p3z: number,
): boolean {
  const s1x = p1x - p0x;
  const s1z = p1z - p0z;
  const s2x = p3x - p2x;
  const s2z = p3z - p2z;
  const denom = -s2x * s1z + s1x * s2z;
  if (denom === 0) return false;  // parallel; treat as non-intersecting
  const s = (-s1z * (p0x - p2x) + s1x * (p0z - p2z)) / denom;
  const t = ( s2x * (p0z - p2z) - s2z * (p0x - p2x)) / denom;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

// Squared distance from point (px, pz) to segment (ax,az)-(bx,bz).
function distSqPointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  if (len2 === 0) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2));
  const cx = ax + t * abx;
  const cz = az + t * abz;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

// Squared distance from point (px, pz) to axis-aligned box [minX..maxX, minZ..maxZ].
// 0 if the point is inside the box.
function distSqPointToAabb(px: number, pz: number, minX: number, maxX: number, minZ: number, maxZ: number): number {
  const cx = Math.max(minX, Math.min(maxX, px));
  const cz = Math.max(minZ, Math.min(maxZ, pz));
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}
