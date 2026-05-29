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

  /** Debug-only: the live wall segment set (read-only) for the debug
   *  capture's geometry-overlay screenshot. Not for gameplay use. */
  getWallsForDebug(): readonly WallSegment[] {
    return this.walls;
  }

  /** Is the agent center at (x, z) (with given radius) currently walkable?
   *  Options:
   *    ignoreObstacles — skip the obstacle check (props like pillars,
   *                       altars, fountains, chests). Used by phasing
   *                       mobs (ghosts) who pass through props but are
   *                       still bounded by room walls. */
  contains(x: number, z: number, radius: number, opts?: { ignoreObstacles?: boolean }): boolean {
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

    // (3) Outside every obstacle — unless the caller is a phasing mob.
    if (opts?.ignoreObstacles) return true;
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
  clampMove(
    oldX: number, oldZ: number, newX: number, newZ: number, radius: number,
    opts?: { ignoreObstacles?: boolean },
  ): Vec2 {
    let cx = newX;
    let cz = oldZ;
    if (!this.contains(cx, cz, radius, opts)) cx = oldX;
    cz = newZ;
    if (!this.contains(cx, cz, radius, opts)) cz = oldZ;
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
  hasLineOfSight(
    ax: number, az: number, bx: number, bz: number,
    opts?: { includeObstacles?: boolean },
  ): boolean {
    for (const w of this.walls) {
      if (segmentsIntersect(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return false;
    }
    // For movement LOS (not perception), props ALSO block — otherwise a
    // mob will beeline through a pillar and clampMove stops it dead.
    // Default off so existing sight-cone callers keep their behaviour.
    if (opts?.includeObstacles) {
      for (const o of this.obstacles) {
        if (o.kind === 'circle') {
          if (distSqPointToSegment(o.x, o.z, ax, az, bx, bz) < o.r * o.r) return false;
        } else {
          if (segmentHitsAabb(ax, az, bx, bz, o.minX, o.maxX, o.minZ, o.maxZ)) return false;
        }
      }
    }
    return true;
  }

  /**
   * Find a valid spawn position near (x, z). If the requested position
   * is already free, returns it unchanged. Otherwise spirals outward in
   * concentric rings of sample points and returns the nearest free one.
   * If nothing's free within MAX_RADIUS, returns the original — the mob
   * gets visibly stuck, which is at least clearly a bug to report rather
   * than a silent gameplay failure.
   *
   * Used at level build time when an authored or procgen spawn lands on
   * top of a fountain / altar / pillar — without this, the mob spawns
   * inside the prop and can't move.
   */
  resolveSpawn(x: number, z: number, radius: number, opts?: { ignoreObstacles?: boolean }): Vec2 {
    if (this.contains(x, z, radius, opts)) return { x, z };
    const STEP = 0.25;
    const MAX_RADIUS = 3.0;
    for (let r = STEP; r <= MAX_RADIUS; r += STEP) {
      // Sample ~one point per 0.25m of circumference so coverage is
      // roughly uniform regardless of ring size.
      const n = Math.max(8, Math.round((2 * Math.PI * r) / STEP));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const tx = x + Math.cos(a) * r;
        const tz = z + Math.sin(a) * r;
        if (this.contains(tx, tz, radius, opts)) return { x: tx, z: tz };
      }
    }
    return { x, z };
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

// Does segment (ax,az)–(bx,bz) intersect the axis-aligned box?
// Slab method: parametrise the segment, find the entry/exit t-range
// against each slab, return true if the ranges overlap inside [0,1].
function segmentHitsAabb(
  ax: number, az: number, bx: number, bz: number,
  minX: number, maxX: number, minZ: number, maxZ: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  // X slab
  if (dx === 0) {
    if (ax < minX || ax > maxX) return false;
  } else {
    const t1 = (minX - ax) / dx;
    const t2 = (maxX - ax) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }
  // Z slab
  if (dz === 0) {
    if (az < minZ || az > maxZ) return false;
  } else {
    const t1 = (minZ - az) / dz;
    const t2 = (maxZ - az) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }
  return true;
}
