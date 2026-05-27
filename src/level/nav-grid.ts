import type { WalkableRegion } from './walkable';

// Grid pathfinder for enemy AI. Built once at level construction; queried
// per chase target by enemy.ts. A* with 8-way movement on a coarse
// (0.5m) grid is plenty for room-scale dungeons — sub-millisecond queries
// for the cell counts we see (<1000 cells per floor).
//
// Two grids are built per level:
//   - standard:  cells walkable if a maxMobRadius-sized circle fits
//                without overlapping walls OR obstacles. Used by every
//                physical mob (ghoul, rat, skirmisher, acolyte).
//   - phasing:   ignores obstacles — walls only. Used by phasing mobs
//                (wraith) so a ghost routes THROUGH the pillar instead
//                of around it.
//
// Cell occupancy uses WalkableRegion.contains() so the grid stays in
// lockstep with collision rules — there's no separate "is this passable"
// definition to drift out of sync with movement code.
//
// Path queries return waypoints in WORLD coordinates (the cell centers
// along the route). Callers steer toward the first waypoint, pop it
// when close, repeat. Empty result = no path (caller should fall back
// to direct steering at their own risk).

export interface PathOptions {
  ignoreObstacles?: boolean;
}

export interface Waypoint {
  x: number;
  z: number;
}

const CELL_SIZE = 0.5;
// Cell-center clearance from any wall/obstacle. Picked at the upper end
// of typical mob radii so any mob can occupy any walkable cell center
// without collision. Cells closer than this to walls are marked blocked.
const CELL_CLEARANCE = 0.42;

export class NavGrid {
  private readonly walkable: Uint8Array;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  private readonly cellSize = CELL_SIZE;

  constructor(
    region: WalkableRegion,
    bbox: { minX: number; maxX: number; minZ: number; maxZ: number },
    ignoreObstacles: boolean = false,
  ) {
    this.cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / CELL_SIZE));
    this.rows = Math.max(1, Math.ceil((bbox.maxZ - bbox.minZ) / CELL_SIZE));
    this.originX = bbox.minX;
    this.originZ = bbox.minZ;
    this.walkable = new Uint8Array(this.cols * this.rows);

    for (let r = 0; r < this.rows; r++) {
      const cz = this.originZ + r * CELL_SIZE + CELL_SIZE / 2;
      for (let c = 0; c < this.cols; c++) {
        const cx = this.originX + c * CELL_SIZE + CELL_SIZE / 2;
        const ok = region.contains(cx, cz, CELL_CLEARANCE, { ignoreObstacles });
        this.walkable[r * this.cols + c] = ok ? 1 : 0;
      }
    }
  }

  /** World-space (x, z) → cell coords. May return out-of-bounds values;
   *  callers should bounds-check via isInBounds. */
  worldToCell(x: number, z: number): { c: number; r: number } {
    return {
      c: Math.floor((x - this.originX) / this.cellSize),
      r: Math.floor((z - this.originZ) / this.cellSize),
    };
  }

  /** Cell coords → world-space center of that cell. */
  cellToWorld(c: number, r: number): Waypoint {
    return {
      x: this.originX + c * this.cellSize + this.cellSize / 2,
      z: this.originZ + r * this.cellSize + this.cellSize / 2,
    };
  }

  isWalkable(c: number, r: number): boolean {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    return this.walkable[r * this.cols + c] !== 0;
  }

  /** Nearest WALKABLE cell to (x, z) — spirals outward up to 6 cells.
   *  Used to "snap" a request whose start/end is in a blocked cell
   *  (e.g. the player just stepped right against a wall). */
  nearestWalkable(x: number, z: number): { c: number; r: number } | null {
    const { c, r } = this.worldToCell(x, z);
    if (this.isWalkable(c, r)) return { c, r };
    for (let rad = 1; rad <= 6; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          // Only check the OUTER ring of this radius (skip inner cells
          // we already checked at smaller rad).
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          if (this.isWalkable(c + dc, r + dr)) return { c: c + dc, r: r + dr };
        }
      }
    }
    return null;
  }

  /**
   * A* path from (startX, startZ) to (endX, endZ). Returns waypoints in
   * WORLD coordinates (excluding the start cell; includes a cell at the
   * end). Empty array = no path found.
   *
   * Diagonal moves are allowed but only when BOTH cardinal neighbors of
   * the diagonal are also walkable — prevents corner-cutting through
   * wall corners.
   */
  findPath(startX: number, startZ: number, endX: number, endZ: number): Waypoint[] {
    const startCell = this.nearestWalkable(startX, startZ);
    const endCell = this.nearestWalkable(endX, endZ);
    if (!startCell || !endCell) return [];
    if (startCell.c === endCell.c && startCell.r === endCell.r) return [];

    const startIdx = startCell.r * this.cols + startCell.c;
    const endIdx = endCell.r * this.cols + endCell.c;

    // Open set as a tiny heap — full priority-queue is overkill for
    // <1000-cell grids, a sorted-on-insert array is fine.
    const open: number[] = [startIdx];
    const inOpen = new Set<number>([startIdx]);
    const closed = new Set<number>();
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();
    gScore.set(startIdx, 0);
    fScore.set(startIdx, octileHeuristic(startCell, endCell));

    while (open.length > 0) {
      // Linear scan for min f — for small open sets (always <500 in
      // practice) this is faster than maintaining a heap.
      let bestI = 0;
      let bestF = fScore.get(open[0])!;
      for (let i = 1; i < open.length; i++) {
        const f = fScore.get(open[i])!;
        if (f < bestF) {
          bestF = f;
          bestI = i;
        }
      }
      const current = open[bestI];
      if (current === endIdx) {
        // Reconstruct path.
        const path: Waypoint[] = [];
        let n = current;
        while (n !== startIdx) {
          const cc = n % this.cols;
          const cr = Math.floor(n / this.cols);
          path.push(this.cellToWorld(cc, cr));
          n = cameFrom.get(n)!;
        }
        path.reverse();
        return path;
      }
      // Pop
      open[bestI] = open[open.length - 1];
      open.pop();
      inOpen.delete(current);
      closed.add(current);

      const cc = current % this.cols;
      const cr = Math.floor(current / this.cols);

      for (let i = 0; i < 8; i++) {
        const dc = NEIGHBOR_DC[i];
        const dr = NEIGHBOR_DR[i];
        const cost = NEIGHBOR_COST[i];
        const nc = cc + dc;
        const nr = cr + dr;
        if (!this.isWalkable(nc, nr)) continue;
        // Diagonal: also require both cardinal neighbors walkable so
        // we don't cut through wall corners.
        if (dc !== 0 && dr !== 0) {
          if (!this.isWalkable(cc + dc, cr)) continue;
          if (!this.isWalkable(cc, cr + dr)) continue;
        }
        const ni = nr * this.cols + nc;
        if (closed.has(ni)) continue;
        const tentativeG = gScore.get(current)! + cost;
        const existingG = gScore.get(ni);
        if (existingG !== undefined && tentativeG >= existingG) continue;
        cameFrom.set(ni, current);
        gScore.set(ni, tentativeG);
        fScore.set(ni, tentativeG + octileHeuristic({ c: nc, r: nr }, endCell));
        if (!inOpen.has(ni)) {
          open.push(ni);
          inOpen.add(ni);
        }
      }
    }
    return [];
  }
}

const NEIGHBOR_DC = [-1, 0, 1, -1, 1, -1, 0, 1];
const NEIGHBOR_DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const SQRT2 = Math.SQRT2;
const NEIGHBOR_COST = [SQRT2, 1, SQRT2, 1, 1, SQRT2, 1, SQRT2];

function octileHeuristic(a: { c: number; r: number }, b: { c: number; r: number }): number {
  const dx = Math.abs(a.c - b.c);
  const dy = Math.abs(a.r - b.r);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}
