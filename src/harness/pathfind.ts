// Grid pathfinding for the harness bot.
//
// The bot used greedy local wall-avoidance (bot.ts avoidWalls): pick the target's
// compass direction, else the nearest clear one. That dead-ends on any non-convex
// route — a target behind a wall, around a corner, through a doorway offset from
// the bearing — so the bot idled on walled-off floors. This does real pathfinding:
// BFS over the walkable region (the same collision test movement uses), routing to
// the nearest reachable cell to the target, and hands the bot the compass toward the
// next waypoint. Cheap enough to run per-step on these small floors (a few thousand
// cells); the full BFS only re-runs when the target moves to a new cell.

import type { WalkableRegion } from '../level/walkable';
import type { Direction8 } from './types';

interface Vec2 { x: number; z: number }
interface Rect { x: number; z: number; w: number; d: number }
interface LevelLike {
  walkable: WalkableRegion;
  spec: {
    rooms: ReadonlyArray<{ rect: Rect; logicalOnly?: boolean }>;
    corridors: ReadonlyArray<{ rect: Rect }>;
  };
}

const CELL = 0.4;          // grid resolution (m) — a hair above the player radius
const R = 0.3;             // player collision radius (controls/camera PLAYER_RADIUS)
const EIGHTH = Math.PI / 8;

/** Delta → 8-compass (matches observation.ts compassFor: 0 = N, +π/2 = E). */
function dir8(dx: number, dz: number): Direction8 {
  const a = Math.atan2(dx, -dz);
  if (a >= -EIGHTH && a < EIGHTH) return 'N';
  if (a >= EIGHTH && a < 3 * EIGHTH) return 'NE';
  if (a >= 3 * EIGHTH && a < 5 * EIGHTH) return 'E';
  if (a >= 5 * EIGHTH && a < 7 * EIGHTH) return 'SE';
  if (a >= 7 * EIGHTH || a < -7 * EIGHTH) return 'S';
  if (a >= -7 * EIGHTH && a < -5 * EIGHTH) return 'SW';
  if (a >= -5 * EIGHTH && a < -3 * EIGHTH) return 'W';
  return 'NW';
}

export interface Nav {
  /** Compass toward the next waypoint from `from` toward `to`, routing around
   *  walls. null if `to` is essentially reached, or no route exists at all. */
  dirToward(from: Vec2, to: Vec2): Direction8 | null;
}

export function createNav(level: LevelLike): Nav {
  const W = level.walkable;
  const rects = [
    ...level.spec.rooms.filter((r) => !r.logicalOnly).map((r) => r.rect),
    ...level.spec.corridors.map((c) => c.rect),
  ];
  let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const b of rects) {
    mnX = Math.min(mnX, b.x - b.w / 2); mxX = Math.max(mxX, b.x + b.w / 2);
    mnZ = Math.min(mnZ, b.z - b.d / 2); mxZ = Math.max(mxZ, b.z + b.d / 2);
  }
  // Pad a cell so edge positions round inside the grid.
  const cols = Math.max(1, Math.ceil((mxX - mnX) / CELL) + 2);
  const rows = Math.max(1, Math.ceil((mxZ - mnZ) / CELL) + 2);
  const wx = (cx: number) => mnX + (cx - 1) * CELL;
  const wz = (cz: number) => mnZ + (cz - 1) * CELL;
  const toCol = (x: number) => Math.round((x - mnX) / CELL) + 1;
  const toRow = (z: number) => Math.round((z - mnZ) / CELL) + 1;
  const inGrid = (cx: number, cz: number) => cx >= 0 && cx < cols && cz >= 0 && cz < rows;
  const walk = (cx: number, cz: number) => inGrid(cx, cz) && W.contains(wx(cx), wz(cz), R);

  // Nearest walkable cell to a world point (targets/starts can sit in a wall —
  // an enemy pressed against masonry, the bot clipping an edge, OR a stair that
  // sits over a carved floor VOID like a boss-arena stairwell). Spiral out far
  // enough to clear a stairwell void and reach its walkable rim (~6.4m).
  function nearestWalkable(x: number, z: number): [number, number] | null {
    const cx = toCol(x), cz = toRow(z);
    if (walk(cx, cz)) return [cx, cz];
    for (let ring = 1; ring <= 16; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          if (walk(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        }
      }
    }
    return null;
  }

  const NEI: ReadonlyArray<[number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  // Cache: the last computed path + the target cell it was for. Reused while the
  // target stays in the same cell; the next-waypoint pick re-runs each call (cheap).
  let cachePath: Vec2[] = [];
  let cacheGoalKey = -1;

  function computePath(from: Vec2, to: Vec2): Vec2[] {
    const s = nearestWalkable(from.x, from.z);
    const g = nearestWalkable(to.x, to.z);
    if (!s || !g) return [];
    // BFS from the START across the walkable grid, tracking came-from; then pick the
    // reached cell CLOSEST to the goal (handles a target that's not itself reachable
    // — path as far toward it as the walls allow).
    const cameFrom = new Int32Array(cols * rows).fill(-1);
    const idx = (cx: number, cz: number) => cz * cols + cx;
    const start = idx(s[0], s[1]);
    cameFrom[start] = start;
    const q: number[] = [start];
    let head = 0;
    let bestCell = start;
    let bestD2 = Infinity;
    const gx = wx(g[0]), gz = wz(g[1]);
    while (head < q.length) {
      const cur = q[head++];
      const ccx = cur % cols, ccz = (cur / cols) | 0;
      const d2 = (wx(ccx) - gx) ** 2 + (wz(ccz) - gz) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestCell = cur; }
      if (cur === idx(g[0], g[1])) { bestCell = cur; break; }   // reached the goal cell
      for (const [dx, dz] of NEI) {
        const ncx = ccx + dx, ncz = ccz + dz;
        if (!walk(ncx, ncz)) continue;
        // Diagonal: require both orthogonal cells open so we don't clip a corner.
        if (dx !== 0 && dz !== 0 && (!walk(ccx + dx, ccz) || !walk(ccx, ccz + dz))) continue;
        const ni = idx(ncx, ncz);
        if (cameFrom[ni] !== -1) continue;
        cameFrom[ni] = cur;
        q.push(ni);
      }
    }
    // Reconstruct start→bestCell.
    const cells: number[] = [];
    let c = bestCell;
    while (c !== start) { cells.push(c); c = cameFrom[c]; if (c < 0) break; }
    cells.push(start);
    cells.reverse();
    return cells.map((ci) => ({ x: wx(ci % cols), z: wz((ci / cols) | 0) }));
  }

  return {
    dirToward(from: Vec2, to: Vec2): Direction8 | null {
      const g = nearestWalkable(to.x, to.z);
      if (!g) return null;
      const goalKey = g[1] * cols + g[0];
      // Recompute the path when the target moved cell, or the bot drifted well off
      // the cached path (blocked / knocked away).
      let offPath = cachePath.length === 0;
      if (!offPath) {
        let min = Infinity;
        for (const p of cachePath) { const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2; if (d < min) min = d; }
        offPath = min > (1.2 * 1.2);
      }
      if (goalKey !== cacheGoalKey || offPath) {
        cachePath = computePath(from, to);
        cacheGoalKey = goalKey;
      }
      const path = cachePath;
      if (path.length < 2) return null;   // already at/adjacent to the goal
      // Track the path TIGHTLY: aim at the waypoint just past our closest point on
      // it. A fixed far look-ahead averaged local turns away — near a doorway offset
      // from the straight-line bearing, the 8-way rounding then dropped the small
      // lateral step (SE → S) and walked us into the wall beside the door. Stepping
      // to the next cell keeps the lateral component so we thread the opening.
      let ci = 0, cd = Infinity;
      for (let i = 0; i < path.length; i++) {
        const d = (path[i].x - from.x) ** 2 + (path[i].z - from.z) ** 2;
        if (d < cd) { cd = d; ci = i; }
      }
      let ti = ci + 1;
      // Skip a waypoint we're already sitting on so the direction stays meaningful.
      while (ti < path.length - 1 && (path[ti].x - from.x) ** 2 + (path[ti].z - from.z) ** 2 < 0.2 * 0.2) ti++;
      if (ti >= path.length) return null;
      const target = path[ti];
      return dir8(target.x - from.x, target.z - from.z);
    },
    // DEV forensics: the last computed path (set by dirToward). Not part of Nav.
    get _debugPath() { return cachePath; },
  } as Nav & { _debugPath: Vec2[] };
}
