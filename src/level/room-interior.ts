import { pointInPoly, polyArea, polyBounds, type Poly } from './room-shape';
import { clearance } from './floor-region';

// ── CUTTING A ROOM UP, WITHOUT CUTTING IT OFF ────────────────────────────────
//
// An empty room is a corridor with a bigger number. What makes a room a PLACE
// to fight in is stone you have to go around: cover to break a sightline, a
// choke you commit through, a colonnade that turns one open floor into a nave
// and two aisles you can lose something in.
//
// The reason procedural dungeons usually don't do this is that it is very easy
// to seal a room by accident, and a sealed room is a dead run. So this module's
// whole shape is: PROPOSE a form, then VERIFY the room still circulates, and
// return null if it doesn't. Nothing here can ship a form it hasn't checked —
// the verify is not a caller's responsibility, it's inside `planInterior`.
//
// What gets verified, on the room's own floor with the proposed stone in place:
//
//   1. Every doorway can still reach every other doorway.
//   2. Every point the caller says must stay reachable (the centrepiece, the
//      stair, each spawn) is reachable FROM a doorway.
//   3. The room doesn't lose more than a third of its walkable area — a form
//      that technically circulates through a 60cm slot is a bug that passes.
//
// Rule 1 alone is not enough, and that's the interesting part: a colonnade can
// leave both doors connected around the outside while walling the centrepiece
// into the middle. Check the final state against the final state
// (docs/DESIGN-METHOD.md).

/** A pillar the room will stand. `size` is the plinth's side in metres; the
 *  blocking shaft is 0.42× that (see altar-pillar-builders.ts). */
export interface Pier { x: number; z: number; size: number }

export type InteriorForm = 'colonnade' | 'pinch' | 'ring';

export interface InteriorPlan {
  form: InteriorForm;
  pillars: Pier[];
}

export interface InteriorOpts {
  /** Doorway centres, in world XZ. Circulation is judged between these. */
  doorways: Array<{ x: number; z: number }>;
  /** Points that must stay reachable from a doorway — centrepiece, stair,
   *  spawns. A form that strands any of them is rejected. */
  mustReach?: Array<{ x: number; z: number }>;
  /** Already-claimed circles the stone must not land on (lamps, piers, the
   *  thing the room is about). */
  avoid?: Array<{ x: number; z: number; r: number }>;
  rand: () => number;
}

/** Player collision radius (controls/camera.ts PLAYER_RADIUS). */
const PLAYER_R = 0.3;
/** Flood resolution. Fine enough to find a gap the player can actually use. */
const CELL = 0.25;
/** A pillar's blocking radius as a fraction of its `size`. */
const SHAFT = 0.42;
/** Below this a room has no business being subdivided. */
const MIN_AREA = 42;
/** Keep stone this far off the wall, or the "aisle" is a crack. */
const WALL_MARGIN = 1.5;
/** How much walkable floor a form may cost before it reads as a wall. */
const MAX_AREA_LOSS = 0.34;

/**
 * Give this room an interior, or leave it open.
 *
 * Returns null when the room is too small, when no form fit, or when every form
 * it tried broke circulation. Null is a perfectly good answer — most rooms
 * should be open, and a floor where every room is subdivided has no room that
 * reads as subdivided.
 */
export function planInterior(
  poly: Poly, opts: InteriorOpts, forms: readonly InteriorForm[],
): InteriorPlan | null {
  if (polyArea(poly) < MIN_AREA) return null;
  const baseline = walkableCells(poly, []);
  if (baseline.size === 0) return null;

  for (const form of forms) {
    const pillars = propose(form, poly, opts);
    if (pillars.length === 0) continue;
    if (!circulates(poly, pillars, opts, baseline.size)) continue;
    return { form, pillars };
  }
  return null;
}

// ── proposing ────────────────────────────────────────────────────────────────

function propose(form: InteriorForm, poly: Poly, opts: InteriorOpts): Pier[] {
  const b = polyBounds(poly);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const alongX = w >= d;                 // the room's long axis
  const long = alongX ? w : d, short = alongX ? d : w;

  const at = (u: number, v: number): { x: number; z: number } =>
    alongX ? { x: cx + u, z: cz + v } : { x: cx + v, z: cz + u };

  const out: Pier[] = [];
  const push = (p: { x: number; z: number }, size: number) => {
    // Every candidate is filtered the same way: inside the shape, off the wall,
    // and clear of what the room already committed to.
    if (!pointInPoly(poly, p.x, p.z)) return;
    if (clearance(poly, p.x, p.z) < WALL_MARGIN) return;
    const r = size * SHAFT;
    for (const a of opts.avoid ?? []) {
      if (Math.hypot(a.x - p.x, a.z - p.z) < a.r + r + 0.35) return;
    }
    out.push({ x: p.x, z: p.z, size });
  };

  if (form === 'colonnade') {
    // Two rows down the long axis: a nave you walk, aisles you flank through.
    // The offset is a third of the short span, so the aisles are real space and
    // not a gap behind a pillar.
    const lane = short / 3;
    if (lane < 1.6) return [];
    const bays = Math.max(3, Math.min(6, Math.floor(long / 2.8)));
    const step = long / (bays + 1);
    for (let i = 1; i <= bays; i++) {
      const u = -long / 2 + step * i;
      push(at(u, -lane), 0.62);
      push(at(u, lane), 0.62);
    }
    return out.length >= 4 ? out : [];
  }

  if (form === 'pinch') {
    // Two clusters narrowing the middle to a gate you commit through. The gap is
    // deliberately generous — a pinch is a decision, not a doorway.
    const gap = 2.4;
    const reach = short / 2;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const v = side * (gap / 2 + 0.55 + k * 0.85);
        if (Math.abs(v) > reach) break;
        push(at((k - 1) * 0.5, v), 0.7);
      }
    }
    return out.length >= 3 ? out : [];
  }

  // ring — a colonnade AROUND the room's middle, so whatever stands there is
  // approached through stone rather than seen across an empty floor.
  const rad = Math.min(short, long) * 0.28;
  if (rad < 1.9) return [];
  const n = 6 + Math.floor(opts.rand() * 3);
  const phase = opts.rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    push({ x: cx + Math.cos(a) * rad, z: cz + Math.sin(a) * rad }, 0.58);
  }
  return out.length >= 5 ? out : [];
}

// ── verifying ────────────────────────────────────────────────────────────────

const key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;

/** Cells inside the room a player could stand on, given this stone. */
function walkableCells(poly: Poly, pillars: readonly Pier[]): Set<string> {
  const b = polyBounds(poly);
  const out = new Set<string>();
  for (let x = b.minX; x <= b.maxX; x += CELL) {
    for (let z = b.minZ; z <= b.maxZ; z += CELL) {
      if (standable(poly, pillars, x, z)) out.add(key(x, z));
    }
  }
  return out;
}

function standable(poly: Poly, pillars: readonly Pier[], x: number, z: number): boolean {
  if (!pointInPoly(poly, x, z)) return false;
  if (clearance(poly, x, z) < PLAYER_R) return false;
  for (const p of pillars) {
    if (Math.hypot(p.x - x, p.z - z) < p.size * SHAFT + PLAYER_R) return false;
  }
  return true;
}

/**
 * Does the room still work with this stone in it?
 *
 * One flood from the first doorway. Everything that must be reachable — the
 * other doorways AND every `mustReach` point — has to land in that one
 * component, which is the whole question stated once instead of as a pile of
 * pairwise checks.
 */
function circulates(
  poly: Poly, pillars: readonly Pier[], opts: InteriorOpts, baselineArea: number,
): boolean {
  const cells = walkableCells(poly, pillars);
  if (cells.size < baselineArea * (1 - MAX_AREA_LOSS)) return false;

  const start = nearestCell(cells, opts.doorways[0] ?? { x: 0, z: 0 });
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
  for (const dw of opts.doorways) if (!near(dw)) return false;
  for (const m of opts.mustReach ?? []) if (!near(m)) return false;
  return true;
}

function nearestCell(cells: ReadonlySet<string>, to: { x: number; z: number }): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const c of cells) {
    const [cx, cz] = c.split(',').map(Number);
    const dd = (cx * CELL - to.x) ** 2 + (cz * CELL - to.z) ** 2;
    if (dd < bestD) { bestD = dd; best = c; }
  }
  return best;
}

/** Exported for the audit + tests: how much floor this form costs. */
export function interiorAreaLoss(poly: Poly, pillars: readonly Pier[]): number {
  const before = walkableCells(poly, []).size;
  if (before === 0) return 1;
  return 1 - walkableCells(poly, pillars).size / before;
}
