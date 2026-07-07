// Room decoration GRAMMARS — the rules that make dynamic placement read as
// hand-authored instead of perlin-noise or a hoarder's house
// (docs/FLOOR-DIRECTOR.md "placement suitability").
//
// The core idea: different content wants OPPOSITE treatments, and matching each
// to its own compositional grammar is what reads as designed:
//   - STRUCTURAL (pillars) → SYMMETRY + RHYTHM, inset from the walls, framing
//     the room. Paired + evenly spaced reads as architecture; scattered along a
//     wall reads as rubble. Inset also keeps them clear of wall openings.
//   - FURNITURE (vases, debris) → EDGE-HUG + cluster (see the wall-adjacency
//     helper; the composer routes furnishing through it).
//
// Pure + deterministic (seeded rand), no scene — unit-testable.

import type { RoomRole } from './floor-roles';

/** Per-room MOOD: how densely a room dresses, by its JOB. A combat arena wants
 *  open floor to fight in; a treasure/feature room reads as a cluttered
 *  storeroom; a sanctum is reverent and bare; the entrance + exit stay clean. So
 *  the room's ROLE modulates the decor, not one flat palette default. */
export interface RoomDecorPolicy {
  /** Structural-pillar density tier, or 'off' to place none. Overrides the
   *  palette tier so a role can force a room open or dressed. */
  pillars: 'off' | 'light' | 'standard' | 'dense';
  /** Multiplier on the room's furniture (vase) count. */
  furnishMul: number;
}

export function roleDecorPolicy(role: RoomRole): RoomDecorPolicy {
  switch (role) {
    case 'entrance': return { pillars: 'off',      furnishMul: 0.25 };  // a clean, safe threshold
    case 'combat':   return { pillars: 'light',    furnishMul: 0.5 };   // OPEN — room to fight/kite
    case 'feature':  return { pillars: 'standard', furnishMul: 1.5 };   // dressed, storeroom-cluttered
    case 'sanctum':  return { pillars: 'off',      furnishMul: 0.3 };   // reverent, calm around the fire
    case 'finish':   return { pillars: 'off',      furnishMul: 0.2 };   // a bare exit
    case 'quiet':    return { pillars: 'standard', furnishMul: 1.0 };   // dressed for dread
    case 'boss':     return { pillars: 'off',      furnishMul: 0.4 };   // the arena stays clear
    default:         return { pillars: 'standard', furnishMul: 1.0 };
  }
}

/** True if the cell has a wall (or the room border) on at least one side — the
 *  furniture affordance. Uses a caller-supplied floor test so it works on the
 *  raw tilemap or a post-carve occupancy view. */
export function wallAdjacency(
  col: number, row: number,
  isFloor: (c: number, r: number) => boolean,
): number {
  let n = 0;
  if (!isFloor(col, row - 1)) n++;
  if (!isFloor(col, row + 1)) n++;
  if (!isFloor(col - 1, row)) n++;
  if (!isFloor(col + 1, row)) n++;
  return n;   // 0 = open floor, 1 = against a wall, 2+ = a corner
}

/**
 * SYMMETRIC pillar placement — an inset colonnade, not a wall-edge scatter.
 * Returns pillar cells (vault-local col/row). Arrangements are chosen by room
 * shape + a density tier, and each MIRROR PAIR is kept only if BOTH its cells
 * are open — a lone pillar where its twin can't stand reads as debris, so we
 * drop the pair rather than break the symmetry.
 *
 * Small rooms get nothing (pillars would choke them). `isBlocked` is the
 * occupancy view (authored props, torches, carved voids, doorway margins), so
 * pillars never land on those.
 */
export function symmetricPillars(
  W: number,
  D: number,
  tier: 'light' | 'standard' | 'dense',
  isBlocked: (col: number, row: number) => boolean,
  rand: () => number,
): Array<{ col: number; row: number }> {
  if (W < 6 || D < 6) return [];   // too small for a colonnade
  const inset = 2;
  const loX = inset, hiX = W - 1 - inset;
  const loZ = inset, hiZ = D - 1 - inset;
  const midX = Math.round((W - 1) / 2);
  const midZ = Math.round((D - 1) / 2);

  // Each arrangement is a list of MIRROR PAIRS (each pair = two symmetric cells).
  type Cell = { col: number; row: number };
  type Pair = [Cell, Cell];
  const c = (col: number, row: number): Cell => ({ col, row });

  const arrangements: Pair[][] = [];
  // A flanking pair at the mid of the LONG axis — frames the central path.
  arrangements.push(
    W >= D
      ? [[c(midX, loZ), c(midX, hiZ)]]
      : [[c(loX, midZ), c(hiX, midZ)]],
  );
  // Four inset corners — a pillared hall (two L↔R mirror pairs).
  arrangements.push([
    [c(loX, loZ), c(hiX, loZ)],
    [c(loX, hiZ), c(hiX, hiZ)],
  ]);
  // A colonnade — two rows of three — for rooms big enough to carry it.
  if (W >= 9 && D >= 7) {
    arrangements.push([
      [c(loX, loZ), c(hiX, loZ)],
      [c(midX, loZ), c(midX, hiZ)],
      [c(loX, hiZ), c(hiX, hiZ)],
    ]);
  }

  // Density tier biases which arrangement: light → the flanking pair, standard →
  // the 4-corner hall, dense → the fullest colonnade the room can carry.
  void rand;   // arrangement is shape+tier driven; kept deterministic
  const idx = tier === 'light' ? 0
    : tier === 'dense' ? arrangements.length - 1
    : Math.min(1, arrangements.length - 1);
  const chosen = arrangements[idx];

  const open = (cell: Cell) =>
    cell.col > 0 && cell.row > 0 && cell.col < W - 1 && cell.row < D - 1
    && !isBlocked(cell.col, cell.row);

  const out: Cell[] = [];
  for (const [a, b] of chosen) {
    if (open(a) && open(b)) { out.push(a, b); }   // keep the pair only if both stand
  }
  return out;
}
