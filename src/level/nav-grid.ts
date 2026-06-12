import type { WalkableRegion } from './walkable';
import type { NavGate } from './types';

// Grid pathfinder for enemy AI. Queried per chase target by enemy.ts.
// A* with 8-way movement on a coarse (0.5m) grid is plenty for
// room-scale dungeons — sub-millisecond queries for the cell counts we
// see (<1000 cells per floor).
//
// LIVE, not static: the grid tracks WalkableRegion.version and lazily
// rebuilds (~1ms) on the next query after any wall/obstacle mutation.
// Door seals, cobweb curtains, and boss mist therefore exist for
// pathfinding the moment they exist for collision — and stop existing
// when they open/clear. (They used to be invisible: mobs pathed through
// closed doors and wedged against the seal.)
//
// Two grids are built per level:
//   - standard:  cells walkable if a mob-sized circle fits without
//                overlapping walls OR obstacles. Used by every
//                physical mob (ghoul, rat, skirmisher, acolyte).
//   - phasing:   ignores obstacles — walls only. Used by phasing mobs
//                (wraith) so a ghost routes THROUGH the pillar instead
//                of around it.
//
// TWO CLEARANCE TIERS per cell. FULL cells fit any typical mob
// (0.42m). TIGHT cells only guarantee 0.26m — these are the centres of
// 1m doorways and framed chokes, where a 0.5m-pitch grid used to mark
// the whole gap blocked unless a cell centre happened to align with
// it. Small mobs route through tight cells at a cost penalty (they
// prefer open ground); mobs whose collisionRadius exceeds the tight
// guarantee treat them as walls — a wide body honestly cannot use a
// narrow door, and now it knows that instead of wedging in the jamb.
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

export interface FindPathOptions {
  /** The pathing mob's collision radius. Above TIGHT_CLEARANCE the
   *  tight tier is excluded — narrow doorways are honest walls for a
   *  body that can't fit them. Omitted = tight cells allowed. */
  radius?: number;
}

export interface Waypoint {
  x: number;
  z: number;
}

const CELL_SIZE = 0.5;
// FULL-tier clearance from any wall/obstacle — the upper end of typical
// mob radii, so any common mob can occupy a full cell without collision.
const CELL_CLEARANCE = 0.42;
// TIGHT-tier clearance, sized for the 1m doorway guarantee: cell
// centres sit on a 0.5m pitch, so whatever the grid phase, some cell
// centre lies within 0.25m of the gap centre and therefore has at
// least 0.5 − 0.25 = 0.25m of clearance. A 0.24 threshold makes every
// 1m doorway pathable ALWAYS — it used to depend on whether the grid
// happened to drop a cell centre near the gap centre.
const TIGHT_CLEARANCE = 0.24;
// Entering a tight cell costs this multiplier on distance — paths
// prefer open ground and only thread chokes when they pay off.
const TIGHT_COST_MUL = 2.5;

// Cell tiers in the walkable array.
const BLOCKED = 0;
const FULL = 1;
const TIGHT = 2;
const GATE = 3;

export class NavGrid {
  private walkable: Uint8Array;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  private readonly cellSize = CELL_SIZE;
  private readonly region: WalkableRegion;
  private readonly ignoreObstacles: boolean;
  private builtVersion = -1;
  /** Framed-opening funnel points (see NavGate in level/types.ts). */
  private readonly gates: NavGate[];
  /** Cell index → the gate whose centre lies in that cell. */
  private gateCells = new Map<number, NavGate>();

  constructor(
    region: WalkableRegion,
    bbox: { minX: number; maxX: number; minZ: number; maxZ: number },
    ignoreObstacles: boolean = false,
    gates: NavGate[] = [],
  ) {
    this.cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / CELL_SIZE));
    this.rows = Math.max(1, Math.ceil((bbox.maxZ - bbox.minZ) / CELL_SIZE));
    this.originX = bbox.minX;
    this.originZ = bbox.minZ;
    this.region = region;
    this.ignoreObstacles = ignoreObstacles;
    this.gates = gates;
    this.walkable = new Uint8Array(this.cols * this.rows);
    this.rebuild();
  }

  /** Re-scan the region into the tier grid. ~1ms at our cell counts;
   *  called lazily when the region's version has moved. */
  private rebuild(): void {
    const { region, ignoreObstacles } = this;
    for (let r = 0; r < this.rows; r++) {
      const cz = this.originZ + r * CELL_SIZE + CELL_SIZE / 2;
      for (let c = 0; c < this.cols; c++) {
        const cx = this.originX + c * CELL_SIZE + CELL_SIZE / 2;
        const tier = region.contains(cx, cz, CELL_CLEARANCE, { ignoreObstacles }) ? FULL
          : region.contains(cx, cz, TIGHT_CLEARANCE, { ignoreObstacles }) ? TIGHT
          : BLOCKED;
        this.walkable[r * this.cols + c] = tier;
      }
    }
    // Gate centres are guaranteed-passable BY CONSTRUCTION (the frame's
    // blockers flank a centre band wider than any mob the gate admits) —
    // but a 0.5m sampling grid often can't see that band. Mark the cell
    // holding each gate centre as GATE tier so a path can always route
    // through a framed opening; per-query radius gating (passable) keeps
    // it honest for bodies wider than the band.
    this.gateCells.clear();
    for (const g of this.gates) {
      // The gate claims a one-cell-deep STRIP across its whole band, not
      // just its centre cell — otherwise neighbouring FULL cells in a
      // wide doorway let an oversized body route around the honesty
      // check. Every crossing of the mouth now passes a GATE cell whose
      // per-body fit test (passable) is the band, and the funnel pass
      // pulls the actual walk through the centre.
      const bxAxis = Math.cos(g.rotY), bzAxis = -Math.sin(g.rotY);
      const nx = Math.sin(g.rotY), nz = Math.cos(g.rotY);
      const reach = g.halfBand + CELL_SIZE;
      const c0 = this.worldToCell(g.x - Math.abs(bxAxis) * reach - Math.abs(nx) * CELL_SIZE,
        g.z - Math.abs(bzAxis) * reach - Math.abs(nz) * CELL_SIZE);
      const c1 = this.worldToCell(g.x + Math.abs(bxAxis) * reach + Math.abs(nx) * CELL_SIZE,
        g.z + Math.abs(bzAxis) * reach + Math.abs(nz) * CELL_SIZE);
      for (let r = Math.max(0, c0.r); r <= Math.min(this.rows - 1, c1.r); r++) {
        for (let c = Math.max(0, c0.c); c <= Math.min(this.cols - 1, c1.c); c++) {
          const w = this.cellToWorld(c, r);
          const lateral = (w.x - g.x) * bxAxis + (w.z - g.z) * bzAxis;
          const normal = (w.x - g.x) * nx + (w.z - g.z) * nz;
          if (Math.abs(lateral) > g.halfBand + CELL_SIZE / 2 || Math.abs(normal) > CELL_SIZE * 0.75) continue;
          const i = r * this.cols + c;
          if (this.walkable[i] === BLOCKED) continue;   // walls/columns stay walls
          this.walkable[i] = GATE;
          this.gateCells.set(i, g);
        }
      }
    }
    this.builtVersion = region.version;
  }

  /** Lazy freshness check — every public query funnels through this. */
  private ensureFresh(): void {
    if (this.builtVersion !== this.region.version) this.rebuild();
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
    return this.walkable[r * this.cols + c] !== BLOCKED;
  }

  /** Tier-aware passability: tight cells count as walls when the mob's
   *  radius exceeds the FULL clearance (a wide body can't thread a
   *  choke; pretending otherwise wedges it in the jamb). Gate cells
   *  admit exactly the bodies that fit their band. */
  private passable(c: number, r: number, allowTight: boolean, radius: number): boolean {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    const tier = this.walkable[r * this.cols + c];
    if (tier === FULL) return true;
    if (tier === TIGHT) return allowTight;
    if (tier === GATE) {
      const g = this.gateCells.get(r * this.cols + c);
      return !!g && radius <= g.halfBand - 0.03;
    }
    return false;
  }

  /** Nearest WALKABLE cell to (x, z) — spirals outward up to 6 cells.
   *  Used to "snap" a request whose start/end is in a blocked cell
   *  (e.g. the player just stepped right against a wall). */
  nearestWalkable(x: number, z: number): { c: number; r: number } | null {
    this.ensureFresh();
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
  findPath(startX: number, startZ: number, endX: number, endZ: number, opts?: FindPathOptions): Waypoint[] {
    this.ensureFresh();
    const radius = opts?.radius ?? 0;
    const allowTight = radius <= CELL_CLEARANCE;
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
        return this.funnel(path, startX, startZ);
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
        if (!this.passable(nc, nr, allowTight, radius)) continue;
        // Diagonal: also require both cardinal neighbors walkable so
        // we don't cut through wall corners — EXCEPT when the step
        // touches a GATE cell (its band is ground truth; its cardinal
        // neighbours are often blocked-looking cells beside columns).
        if (dc !== 0 && dr !== 0) {
          const gateStep = this.walkable[nr * this.cols + nc] === GATE
            || this.walkable[cr * this.cols + cc] === GATE;
          if (!gateStep) {
            if (!this.passable(cc + dc, cr, allowTight, radius)) continue;
            if (!this.passable(cc, cr + dr, allowTight, radius)) continue;
          }
        }
        const ni = nr * this.cols + nc;
        if (closed.has(ni)) continue;
        // FULL cells (clearance 0.42 > half the 0.5m pitch) can never sit
        // on opposite sides of a wall, so full→full steps need no check.
        // TIGHT cells CAN straddle one — 0.24m clearance fits two cells
        // 0.25m either side of a seal — so any step touching a tight cell
        // must prove the actual segment between cell centres crosses no
        // wall/obstacle. Tight cells are rare (doorway centres), so the
        // exact check costs nothing in practice.
        const nTier = this.walkable[ni];
        if (nTier === TIGHT || this.walkable[current] === TIGHT) {
          const a = this.cellToWorld(cc, cr);
          const b = this.cellToWorld(nc, nr);
          if (!this.region.hasLineOfSight(a.x, a.z, b.x, b.z,
            { includeObstacles: !this.ignoreObstacles })) continue;
        }
        // Threading a choke costs extra — paths prefer open ground and
        // only squeeze a doorway when it genuinely pays off.
        const stepCost = nTier === TIGHT ? cost * TIGHT_COST_MUL : cost;
        const tentativeG = gScore.get(current)! + stepCost;
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

  /** Funnel pass — pull the path through gate CENTRES. Cell-centre
   *  waypoints near a framed opening can sit up to 0.35m off the gap's
   *  centre line; steering through them grazes the columns and clampMove
   *  pins the mob (the "stuck on the archway" bug). Wherever a path
   *  segment crosses a gate's wall line inside its band, the crossing is
   *  replaced with the gate centre itself. */
  private funnel(path: Waypoint[], startX: number, startZ: number): Waypoint[] {
    if (this.gates.length === 0 || path.length === 0) return path;
    const out: Waypoint[] = [];
    let prev: Waypoint = { x: startX, z: startZ };
    for (const wp of path) {
      for (const g of this.gates) {
        const hit = gateCrossing(prev, wp, g, g.halfBand + 0.6);
        if (hit !== null) {
          const last = out[out.length - 1];
          if (!last || Math.hypot(last.x - g.x, last.z - g.z) > 0.05) {
            out.push({ x: g.x, z: g.z });
          }
        }
      }
      out.push(wp);
      prev = wp;
    }
    return out;
  }

  /** True when the straight segment A→B would pass a gate too close to
   *  its blockers for a body of `radius` (or through a gate it cannot
   *  fit at all). enemy.ts uses this to demote a direct-LOS beeline to
   *  pathing — the beeline aims at the TARGET, not the gap centre, and
   *  grazing a column pins the mob. */
  directRouteGrazesGate(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
    for (const g of this.gates) {
      const s = gateCrossing({ x: ax, z: az }, { x: bx, z: bz }, g, g.halfBand + 1.5);
      if (s === null) continue;
      if (radius > g.halfBand - 0.03) return true;          // cannot fit at all
      if (Math.abs(s) > g.halfBand - radius - 0.05) return true;   // would graze a blocker
    }
    return false;
  }
}

/** Where segment A→B crosses the gate's wall line: returns the lateral
 *  offset from the gate centre (along the gate's band axis), or null if
 *  the segment doesn't cross within `maxBand` of the centre. */
function gateCrossing(
  a: Waypoint, b: Waypoint, g: NavGate, maxBand: number,
): number | null {
  // Gate band axis (local +X under rotY) and normal (local +Z).
  const bxAxis = Math.cos(g.rotY), bzAxis = -Math.sin(g.rotY);
  const nx = Math.sin(g.rotY), nz = Math.cos(g.rotY);
  const da = (a.x - g.x) * nx + (a.z - g.z) * nz;
  const db = (b.x - g.x) * nx + (b.z - g.z) * nz;
  if ((da > 0 && db > 0) || (da < 0 && db < 0)) return null;   // no crossing
  const denom = da - db;
  if (Math.abs(denom) < 1e-9) return null;
  const t = da / denom;
  const cx = a.x + (b.x - a.x) * t;
  const cz = a.z + (b.z - a.z) * t;
  const lateral = (cx - g.x) * bxAxis + (cz - g.z) * bzAxis;
  return Math.abs(lateral) <= maxBand ? lateral : null;
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
