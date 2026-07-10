import type { WalkableRect, Vec2 } from './types';
import { SpatialHash } from './spatial-hash';

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

// An obstacle is a real 3D volume: a footprint (circle = cylinder, aabb = box)
// extruded from the floor up to `yTop` — the world-Y top of the SOLID part.
//
// `yTop` is REQUIRED. A finite value is the prop's actual top: the projectile
// pass lets a shot flying ABOVE it sail over (a headshot clears a waist-high
// altar). `Infinity` means a full-height, floor-to-ceiling blocker (walls,
// structural columns) — written DELIBERATELY, never by omission. Making the
// field required is the point: a prop can't silently become a wall by a
// forgotten height. Producers fold the ground height under the prop (groundYAt)
// into a finite `yTop` so the comparison stays correct in elevated rooms.
//
// Only the projectile pass (containsProjectile) reads `yTop`. Movement
// (contains), the nav grid, and LOS are 2D — agents are floor-bound, so they
// test the footprint alone (you still can't walk through a waist-high altar).
// The footprint must MATCH the geometry that draws it (a round column = a
// circle, not a square that eats shots grazing past it).
export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number; yTop: number; dashable?: boolean }
  | { kind: 'aabb'; minX: number; maxX: number; minZ: number; maxZ: number; yTop: number; dashable?: boolean };

// Scratch buffers for the spatial-hash queries — module-level so the hot
// paths (clampMove per mob per frame, LOS per perception check) allocate
// nothing. Safe because queries never nest: each loop body below is pure
// math, and the wall pass completes before the obstacle pass begins.
const WALL_SCRATCH: WallSegment[] = [];
const OBS_SCRATCH: Obstacle[] = [];

// Items are inserted with this AABB inflation so a query segment running
// exactly along a cell boundary still finds walls touching the boundary.
const GRID_EPS = 0.01;
const GRID_CELL = 4;   // metres — room-scale; a wall spans a handful of cells

export class WalkableRegion {
  /** Bumped on every wall/obstacle mutation. NavGrid compares this against
   *  the version it was built from and lazily rebuilds when they diverge —
   *  so runtime blockers (door seals, cobweb curtains, boss mist) and their
   *  removals are FELT by pathfinding, not just by physical collision.
   *  Before this, mobs pathed straight through closed doors and webs and
   *  wedged against the seal. */
  version = 0;

  // Broad-phase acceleration over walls/obstacles. The arrays stay the
  // source of truth (debug capture reads them; identity add/remove works on
  // them); the grids mirror membership so queries touch only nearby items.
  private readonly wallGrid = new SpatialHash<WallSegment>(GRID_CELL);
  private readonly obstacleGrid = new SpatialHash<Obstacle>(GRID_CELL);

  constructor(
    private readonly rects: WalkableRect[],
    private readonly obstacles: Obstacle[] = [],
    private readonly walls: WallSegment[] = [],
  ) {
    for (const w of walls) this.indexWall(w);
    for (const o of obstacles) this.indexObstacle(o);
  }

  private indexWall(w: WallSegment): void {
    this.wallGrid.insert(
      w,
      Math.min(w.ax, w.bx) - GRID_EPS, Math.min(w.az, w.bz) - GRID_EPS,
      Math.max(w.ax, w.bx) + GRID_EPS, Math.max(w.az, w.bz) + GRID_EPS,
    );
  }

  private indexObstacle(o: Obstacle): void {
    if (o.kind === 'circle') {
      this.obstacleGrid.insert(o, o.x - o.r - GRID_EPS, o.z - o.r - GRID_EPS, o.x + o.r + GRID_EPS, o.z + o.r + GRID_EPS);
    } else {
      this.obstacleGrid.insert(o, o.minX - GRID_EPS, o.minZ - GRID_EPS, o.maxX + GRID_EPS, o.maxZ + GRID_EPS);
    }
  }

  /**
   * Add a wall segment. Used by closed doors to plug a doorway gap; the
   * door removes its segment again when it opens. Identity is by reference
   * so the same WallSegment object can be added once and removed once.
   */
  addWall(seg: WallSegment) {
    this.walls.push(seg);
    this.indexWall(seg);
    this.version++;
  }

  /** Remove a previously-added wall segment by reference. */
  removeWall(seg: WallSegment) {
    const idx = this.walls.indexOf(seg);
    if (idx >= 0) { this.walls.splice(idx, 1); this.wallGrid.remove(seg); this.version++; }
  }

  /** Push an obstacle in at runtime (e.g. boss-mist sealing the
   *  entrance behind the player). Identity-based add/remove like
   *  walls — caller holds the reference. */
  addObstacle(o: Obstacle) {
    this.obstacles.push(o);
    this.indexObstacle(o);
    this.version++;
  }

  /** Remove a previously-added obstacle by reference. */
  removeObstacle(o: Obstacle) {
    const idx = this.obstacles.indexOf(o);
    if (idx >= 0) { this.obstacles.splice(idx, 1); this.obstacleGrid.remove(o); this.version++; }
  }

  /** Projectile-only barriers — segments that stop PROJECTILES but never
   *  affect movement. The boss-mist curtain uses this: a flying shot can't
   *  cross the mist even while the gate is open for the player to walk
   *  through (or when an enemy has slipped to the far side). Movement
   *  sealing is the separate addWall/removeWall channel. */
  private readonly projectileBarriers: WallSegment[] = [];
  addProjectileBarrier(seg: WallSegment) {
    this.projectileBarriers.push(seg);
  }
  removeProjectileBarrier(seg: WallSegment) {
    const idx = this.projectileBarriers.indexOf(seg);
    if (idx >= 0) this.projectileBarriers.splice(idx, 1);
  }
  /** True when a projectile of the given radius at (x,z) is touching a
   *  projectile barrier — independent of the walkable/movement test. */
  projectileBlocked(x: number, z: number, radius: number): boolean {
    const r2 = radius * radius;
    for (const w of this.projectileBarriers) {
      if (distSqPointToSegment(x, z, w.ax, w.az, w.bx, w.bz) < r2) return true;
    }
    return false;
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
  contains(x: number, z: number, radius: number, opts?: { ignoreObstacles?: boolean; ignoreDashable?: boolean }): boolean {
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
    const nw = this.wallGrid.queryAabb(x - radius, z - radius, x + radius, z + radius, WALL_SCRATCH);
    for (let i = 0; i < nw; i++) {
      const w = WALL_SCRATCH[i];
      if (distSqPointToSegment(x, z, w.ax, w.az, w.bx, w.bz) < r2) return false;
    }

    // (3) Outside every obstacle — unless the caller is a phasing mob.
    if (opts?.ignoreObstacles) return true;
    const no = this.obstacleGrid.queryAabb(x - radius, z - radius, x + radius, z + radius, OBS_SCRATCH);
    for (let i = 0; i < no; i++) {
      const o = OBS_SCRATCH[i];
      // DASHABLE obstacles (fallen pillars, 1-wide gaps) don't block while the
      // player is DASHING — they vault/dash over. Still block a normal walk.
      if (opts?.ignoreDashable && o.dashable) continue;
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

  /** Projectile containment: like contains(), but obstacles only block if
   *  they're as TALL as the projectile's current height `y`. A shot flying
   *  over a waist-high altar/chest sails through; walls, full-height pillars,
   *  and structural columns (height undefined) always block. Room rects +
   *  wall segments apply exactly as for movement. */
  containsProjectile(x: number, z: number, radius: number, y: number): boolean {
    let inside = false;
    for (const r of this.rects) {
      const hw = r.w / 2;
      const hd = r.d / 2;
      if (x >= r.x - hw && x <= r.x + hw && z >= r.z - hd && z <= r.z + hd) { inside = true; break; }
    }
    if (!inside) return false;

    const r2 = radius * radius;
    const nw = this.wallGrid.queryAabb(x - radius, z - radius, x + radius, z + radius, WALL_SCRATCH);
    for (let i = 0; i < nw; i++) {
      const w = WALL_SCRATCH[i];
      if (distSqPointToSegment(x, z, w.ax, w.az, w.bx, w.bz) < r2) return false;
    }
    const no = this.obstacleGrid.queryAabb(x - radius, z - radius, x + radius, z + radius, OBS_SCRATCH);
    for (let i = 0; i < no; i++) {
      const o = OBS_SCRATCH[i];
      if (y > o.yTop) continue;   // shot flies above this prop's solid top (Infinity = full-height, never clears)
      if (o.kind === 'circle') {
        const dx = x - o.x;
        const dz = z - o.z;
        const rr = o.r + radius;
        if (dx * dx + dz * dz < rr * rr) return false;
      } else {
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
    opts?: { ignoreObstacles?: boolean; ignoreDashable?: boolean },
  ): Vec2 {
    return this.clampMoveInto({ x: 0, z: 0 }, oldX, oldZ, newX, newZ, radius, opts);
  }

  /** clampMove writing into a caller-owned scratch — the per-frame form
   *  (player movement, every awake mob's walk step) so resolving a move
   *  allocates nothing. Returns `out`. */
  clampMoveInto(
    out: Vec2,
    oldX: number, oldZ: number, newX: number, newZ: number, radius: number,
    opts?: { ignoreObstacles?: boolean; ignoreDashable?: boolean },
  ): Vec2 {
    let cx = newX;
    let cz = oldZ;
    if (!this.contains(cx, cz, radius, opts)) cx = oldX;
    cz = newZ;
    if (!this.contains(cx, cz, radius, opts)) cz = oldZ;
    out.x = cx;
    out.z = cz;
    return out;
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
    const nw = this.wallGrid.querySegment(ax, az, bx, bz, WALL_SCRATCH);
    for (let i = 0; i < nw; i++) {
      const w = WALL_SCRATCH[i];
      if (segmentsIntersect(ax, az, bx, bz, w.ax, w.az, w.bx, w.bz)) return false;
    }
    // For movement LOS (not perception), props ALSO block — otherwise a
    // mob will beeline through a pillar and clampMove stops it dead.
    // Default off so existing sight-cone callers keep their behaviour.
    if (opts?.includeObstacles) {
      const no = this.obstacleGrid.querySegment(ax, az, bx, bz, OBS_SCRATCH);
      for (let i = 0; i < no; i++) {
        const o = OBS_SCRATCH[i];
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
   * Can the player DASH from (fromX,fromZ) to (toX,toZ)? True iff the LANDING is
   * valid floor AND the straight path crosses ONLY dashable obstacles — no wall,
   * no solid pillar/chest. This is the dash-over gate (decided at dash START):
   * you only vault a fallen pillar / clear a 1-wide gap when you'd actually land
   * safe on the far side. If it returns false, the caller runs a NORMAL dash so
   * you stop AT the obstacle's edge — never inside it, never teleported.
   */
  canDashOver(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean {
    // (1) The landing must be real floor — obstacles + walls both respected, so a
    // landing INSIDE a dashable obstacle (undershoot) fails and we don't vault.
    if (!this.contains(toX, toZ, radius)) return false;
    // (2) No WALL across the path (you can't dash through stone).
    const nw = this.wallGrid.querySegment(fromX, fromZ, toX, toZ, WALL_SCRATCH);
    for (let i = 0; i < nw; i++) {
      const w = WALL_SCRATCH[i];
      if (segmentsIntersect(fromX, fromZ, toX, toZ, w.ax, w.az, w.bx, w.bz)) return false;
    }
    // (3) No SOLID (non-dashable) obstacle across the path — a normal pillar or a
    // chest still stops you. Dashable ones are exactly what we're clearing.
    const no = this.obstacleGrid.querySegment(fromX, fromZ, toX, toZ, OBS_SCRATCH);
    for (let i = 0; i < no; i++) {
      const o = OBS_SCRATCH[i];
      if (o.dashable) continue;
      if (o.kind === 'circle') {
        if (distSqPointToSegment(o.x, o.z, fromX, fromZ, toX, toZ) < o.r * o.r) return false;
      } else {
        if (segmentHitsAabb(fromX, fromZ, toX, toZ, o.minX, o.maxX, o.minZ, o.maxZ)) return false;
      }
    }
    return true;
  }

  /**
   * Self-heal for a dash-over that undershot. If (x,z) is blocked ONLY by a
   * DASHABLE obstacle — the lunge died with the player standing inside a fallen
   * pillar / over a gap — resolve them forward along (dirX,dirZ) onto the first
   * valid floor, completing the vault they committed to. Returns null when
   * there's nothing to fix: already on floor, or stuck on a WALL / solid prop
   * (not our business — normal collision owns that). Bounded search, so it's a
   * short step to the obstacle's far edge, never a teleport.
   */
  resolveDashUndershoot(x: number, z: number, dirX: number, dirZ: number, radius: number): Vec2 | null {
    if (this.contains(x, z, radius)) return null;                          // already safe
    if (!this.contains(x, z, radius, { ignoreDashable: true })) return null;  // a wall holds them, not a dashable
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len, uz = dirZ / len;
    const STEP = 0.1, MAX = 3.0;
    // Forward to the far edge — the intended landing.
    for (let d = STEP; d <= MAX; d += STEP) {
      if (this.contains(x + ux * d, z + uz * d, radius)) return { x: x + ux * d, z: z + uz * d };
    }
    // Forward somehow blocked (shouldn't happen after canDashOver) — back out
    // the way we came so the player is never wedged inside geometry.
    for (let d = STEP; d <= MAX; d += STEP) {
      if (this.contains(x - ux * d, z - uz * d, radius)) return { x: x - ux * d, z: z - uz * d };
    }
    return null;
  }

  /**
   * Distance from (ox,oz) along unit direction (dx,dz) to the nearest wall,
   * capped at maxDist. Used to sample "what surface am I looking at" (e.g. the
   * dark-adaptation gaze probe). Ignores obstacles — walls only.
   */
  rayWallDistance(ox: number, oz: number, dx: number, dz: number, maxDist: number): number {
    let best = maxDist;
    // Duplicates from the grid are fine here — min() folds them away.
    const nw = this.wallGrid.querySegment(ox, oz, ox + dx * maxDist, oz + dz * maxDist, WALL_SCRATCH);
    for (let i = 0; i < nw; i++) {
      const w = WALL_SCRATCH[i];
      const ex = w.bx - w.ax;
      const ez = w.bz - w.az;
      const denom = dx * ez - dz * ex;
      if (Math.abs(denom) < 1e-9) continue;       // parallel
      const rx = w.ax - ox;
      const rz = w.az - oz;
      const t = (rx * ez - rz * ex) / denom;       // distance along the ray
      const u = (rx * dz - rz * dx) / denom;       // position along the segment
      if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
    }
    return best;
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
