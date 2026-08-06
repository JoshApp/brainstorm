import { pointInPoly, polyBounds, type Poly } from './room-shape';
import { clearance } from './floor-region';

// ── CAN YOU STILL WALK THIS ROOM? ────────────────────────────────────────────
//
// One verify, shared by everything that takes floor away.
//
// room-interior.ts stands stone in a room and room-voids.ts cuts holes in it,
// and both can seal a room by accident in exactly the same way — which means
// they must not each own a copy of the check. The interior planner's whole shape
// was already PROPOSE → VERIFY → return null; this is that verify, lifted out so
// the void planner cannot ship a rift it hasn't checked either.
//
// What gets asked, on the room's own floor with the proposed obstruction in
// place:
//
//   1. Every doorway can still reach every other doorway.
//   2. Every point the caller says must stay reachable — the centrepiece, the
//      stair, each spawn — is reachable FROM a doorway.
//   3. The room doesn't lose more than the caller's share of its walkable area.
//      A form that technically circulates through a 60cm slot is a bug that
//      passes rule 1.
//
// Rule 1 alone is not enough and that is the interesting part: a colonnade can
// leave both doors connected around the outside while walling the centrepiece
// into the middle, and a rift can do the same to a stair. Check the final state
// against the final state (docs/DESIGN-METHOD.md).

/** A pillar-shaped obstruction: blocks a circle of `r` around (x, z). */
export interface BlockCircle { x: number; z: number; r: number }
/** A hole or a slab: blocks the whole rect. */
export interface BlockRect { x: number; z: number; w: number; d: number }

export interface Blockers {
  circles?: readonly BlockCircle[];
  rects?: readonly BlockRect[];
}

export interface CirculationAsk {
  /** Doorway centres, world XZ. Circulation is judged between these. */
  doorways: ReadonlyArray<{ x: number; z: number }>;
  /** Points that must stay reachable from a doorway. */
  mustReach?: ReadonlyArray<{ x: number; z: number }>;
  /** Largest share of walkable floor this obstruction may cost, 0..1. */
  maxAreaLoss: number;
}

/** Player collision radius (controls/camera.ts PLAYER_RADIUS). */
export const PLAYER_R = 0.3;
/** Flood resolution. Fine enough to find a gap the player could actually use. */
export const CELL = 0.25;

const key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;

export function standable(poly: Poly, b: Blockers, x: number, z: number): boolean {
  if (!pointInPoly(poly, x, z)) return false;
  if (clearance(poly, x, z) < PLAYER_R) return false;
  for (const c of b.circles ?? []) {
    if (Math.hypot(c.x - x, c.z - z) < c.r + PLAYER_R) return false;
  }
  for (const r of b.rects ?? []) {
    // Inflated by the player's radius: standing with half your body over a hole
    // is the same bug as standing in it.
    if (Math.abs(x - r.x) <= r.w / 2 + PLAYER_R && Math.abs(z - r.z) <= r.d / 2 + PLAYER_R) return false;
  }
  return true;
}

/** Cells inside the room a player could stand on, given these blockers. */
export function walkableCells(poly: Poly, b: Blockers): Set<string> {
  const bb = polyBounds(poly);
  const out = new Set<string>();
  for (let x = bb.minX; x <= bb.maxX; x += CELL) {
    for (let z = bb.minZ; z <= bb.maxZ; z += CELL) {
      if (standable(poly, b, x, z)) out.add(key(x, z));
    }
  }
  return out;
}

/**
 * Does the room still work with this in it?
 *
 * ONE flood from the first doorway. Everything that must be reachable — the
 * other doorways AND every `mustReach` point — has to land in that single
 * component, which states the whole question once instead of as a pile of
 * pairwise checks.
 */
export function circulates(
  poly: Poly, b: Blockers, ask: CirculationAsk, baselineCells: number,
): boolean {
  const cells = walkableCells(poly, b);
  if (cells.size < baselineCells * (1 - ask.maxAreaLoss)) return false;

  const start = nearestCell(cells, ask.doorways[0] ?? { x: 0, z: 0 });
  if (!start) return false;

  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const [cx, cz] = q.pop()!.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = `${cx + dx},${cz + dz}`;
      if (seen.has(k) || !cells.has(k)) continue;
      seen.add(k); q.push(k);
    }
  }

  // A doorway or a staged prop sits at a point, not on a cell centre, so ask
  // whether ANY reachable cell is within arm's length of it.
  const near = (p: { x: number; z: number }): boolean => {
    const cx = Math.round(p.x / CELL), cz = Math.round(p.z / CELL);
    const span = Math.ceil(1.2 / CELL);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) if (seen.has(`${cx + i},${cz + j}`)) return true;
    }
    return false;
  };
  for (const dw of ask.doorways) if (!near(dw)) return false;
  for (const m of ask.mustReach ?? []) if (!near(m)) return false;
  return true;
}

export function nearestCell(
  cells: ReadonlySet<string>, to: { x: number; z: number },
): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const c of cells) {
    const [cx, cz] = c.split(',').map(Number);
    const dd = (cx * CELL - to.x) ** 2 + (cz * CELL - to.z) ** 2;
    if (dd < bestD) { bestD = dd; best = c; }
  }
  return best;
}

/** How much floor an obstruction costs, 0..1. Exported for audits + tests. */
export function areaLoss(poly: Poly, b: Blockers): number {
  const before = walkableCells(poly, {}).size;
  if (before === 0) return 1;
  return 1 - walkableCells(poly, b).size / before;
}
