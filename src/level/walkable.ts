import type { WalkableRect, ObstacleCircle, Vec2 } from './types';

// Walkable region = union of axis-aligned rectangles MINUS circular obstacles.
//
// A position is walkable iff it lies inside at least one rect (shrunk by the
// agent's radius) AND lies outside every obstacle circle (expanded by the
// agent's radius).
//
// Movement uses an axis-decomposed slide: try the X delta alone; if blocked,
// try Z alone. This gives "slide along walls / pillars" behavior for free
// without resolving full continuous collision response.

export class WalkableRegion {
  constructor(
    private readonly rects: WalkableRect[],
    private readonly obstacles: ObstacleCircle[] = [],
  ) {}

  /** Is the agent center at (x, z) (with given radius) currently walkable? */
  contains(x: number, z: number, radius: number): boolean {
    // Must be inside at least one rect (shrunk by radius)
    let inside = false;
    for (const r of this.rects) {
      const hw = r.w / 2 - radius;
      const hd = r.d / 2 - radius;
      if (hw < 0 || hd < 0) continue; // agent too big for this rect
      if (x >= r.x - hw && x <= r.x + hw && z >= r.z - hd && z <= r.z + hd) {
        inside = true;
        break;
      }
    }
    if (!inside) return false;

    // Must be outside every obstacle (expanded by radius)
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
