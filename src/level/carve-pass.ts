// ─────────────────────────────────────────────────────────────────────
// Carve pass — procedural floor cutouts by intent
// ─────────────────────────────────────────────────────────────────────
//
// Runs FIRST in the pass pipeline. Emits void rects that downstream
// passes (lighting, decor) treat as forbidden — pillars and torches
// never land in or adjacent to a hole. The composer also feeds the
// emitted voids into the floor's `voids` list so the builder cuts
// real geometry (edge barriers, drop visuals).
//
// v1 ships 'fissured' — thin scattered cracks placed in INTERIOR
// cells (away from walls so the player still has a wall-following
// path around the hole). Other styles are no-op stubs until they
// have their own candidate logic + sizing rule.
//
// Author safety: every pass respects vault.cellProps (a void can't
// land on a cell the author already filled) AND the spawn / stairs
// cells (so a procgen carve can't strand the start). Density is
// kept very low by design — a hole or two per room is signal; ten
// is anti-fun.

import type { TileMap, WalkableRect } from './types';
import type { Vault } from './vault';
import type { ResolvedPaletteV1, Density, CarveStyle } from './palette';

const WALKABLE = new Set('.,SoOD/^X%*'.split(''));
function isWalkable(map: TileMap, col: number, row: number): boolean {
  const r = map[row];
  if (!r) return false;
  const ch = r[col];
  return !!ch && WALKABLE.has(ch);
}

/** Interior cell = walkable + all 4 neighbours also walkable. Carve
 *  candidates that DON'T touch any wall, so a hole here doesn't
 *  pinch a corridor or block a doorway. */
function findInteriorCells(map: TileMap): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  const D = map.length;
  const W = map[0]?.length ?? 0;
  for (let r = 0; r < D; r++) {
    for (let c = 0; c < W; c++) {
      if (!isWalkable(map, c, r)) continue;
      if (
        isWalkable(map, c, r - 1) &&
        isWalkable(map, c, r + 1) &&
        isWalkable(map, c - 1, r) &&
        isWalkable(map, c + 1, r)
      ) {
        out.push({ col: c, row: r });
      }
    }
  }
  return out;
}

/** Density factors for carve are deliberately CONSERVATIVE — a few
 *  holes per room reads as "something carved this," a dozen reads
 *  as "the floor is gone." */
function densityFactor(density: Density): number {
  if (density === 'off') return 0;
  if (density === 'light') return 0.02;
  if (density === 'standard') return 0.05;
  /* dense */ return 0.10;
}

function targetCount(
  style: CarveStyle, density: Density, candidateCount: number,
): number {
  if (style === 'off' || density === 'off') return 0;
  // Floor at 1 — if the author opted into a non-off style, at least
  // one hole always lands.
  return Math.max(1, Math.round(candidateCount * densityFactor(density)));
}

/**
 * Run the carve pass on one vault. Returns vault-local void rects.
 * Composer translates by the placement offset before merging into
 * the floor spec's voids list.
 *
 * `occupiedCells` is the set of `${col},${row}` keys the pass must
 * skip — at this point in the pipeline that's cellProps keys plus
 * the spawn cell (S) and stair cell (/). Anything that needs to be
 * standable.
 */
export function carvePass(
  vault: Vault,
  palette: ResolvedPaletteV1,
  occupiedCells: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _rng: () => number,
): WalkableRect[] {
  if (palette.carve.style === 'off' || palette.carve.density === 'off') return [];

  switch (palette.carve.style) {
    case 'fissured': {
      const candidates = findInteriorCells(vault.map);
      const free = candidates.filter((c) => !occupiedCells.has(`${c.col},${c.row}`));
      const target = targetCount(palette.carve.style, palette.carve.density, free.length);
      if (target === 0 || free.length === 0) return [];

      const W = vault.map[0]?.length ?? 0;
      const D = vault.map.length;

      // A FISSURE IS A LINE, NOT A DOT.
      //
      // This used to punch an independent 0.8m square at each stride-sampled
      // cell, so what a floor actually showed was single stray potholes
      // scattered around at random — which reads as a generator artefact, not
      // as something that cracked the stone. Each seed now GROWS along one axis
      // into a short run and emits ONE rect covering it, so a crack has a
      // direction and a length you can see and walk around.
      //
      // Deterministic (same map + density → same cracks): the axis and the
      // target length come from the seed cell's own coordinates, not from rng.
      // The pass has never taken rng and the composer relies on that.
      const WIDTH = 0.8;         // across the crack — still leaves a standable rim
      const MIN_RUN = 2, MAX_RUN = 4;
      const used = new Set<string>();
      const isFree = (col: number, row: number) =>
        !used.has(`${col},${row}`)
        && !occupiedCells.has(`${col},${row}`)
        && free.some((c) => c.col === col && c.row === row);

      const stride = free.length / target;
      const out: WalkableRect[] = [];
      for (let i = 0; i < target; i++) {
        const seed = free[Math.min(Math.floor(i * stride), free.length - 1)];
        if (!isFree(seed.col, seed.row)) continue;
        // Along the room's own grain, alternating by seed parity so a room gets
        // cracks in both directions rather than a comb.
        const horiz = ((seed.col + seed.row) & 1) === 0;
        const want = MIN_RUN + ((seed.col * 3 + seed.row * 5) % (MAX_RUN - MIN_RUN + 1));
        // Grow from the seed in both directions until blocked or long enough.
        let lo = 0, hi = 0;
        while (hi - lo + 1 < want) {
          const grewHi = isFree(seed.col + (horiz ? hi + 1 : 0), seed.row + (horiz ? 0 : hi + 1));
          if (grewHi) { hi++; if (hi - lo + 1 >= want) break; }
          const grewLo = isFree(seed.col + (horiz ? lo - 1 : 0), seed.row + (horiz ? 0 : lo - 1));
          if (grewLo) lo--;
          if (!grewHi && !grewLo) break;
        }
        const len = hi - lo + 1;
        for (let k = lo; k <= hi; k++) {
          used.add(horiz ? `${seed.col + k},${seed.row}` : `${seed.col},${seed.row + k}`);
        }
        // Centre of the run, in vault-local metres.
        const midCol = seed.col + (horiz ? (lo + hi) / 2 : 0);
        const midRow = seed.row + (horiz ? 0 : (lo + hi) / 2);
        out.push({
          x: midCol + 0.5 - W / 2,
          z: midRow + 0.5 - D / 2,
          w: horiz ? len - 0.2 : WIDTH,
          d: horiz ? WIDTH : len - 0.2,
        });
      }
      return out;
    }
    // Stubs — see header comment. Add candidate logic + sizing rule
    // per style.
    case 'pit-cluster':
    case 'chasm':
    case 'eroded':
    default:
      return [];
  }
}

/** Helper for downstream passes: given a list of void rects (vault-
 *  local coords) + grid dims, return the set of `col,row` cells the
 *  rects cover. Used to extend occupiedCells so lighting + decor
 *  skip cells the carve pass punched out. */
export function voidCellsCovered(
  voids: WalkableRect[],
  gridW: number,
  gridD: number,
): Set<string> {
  const out = new Set<string>();
  for (const v of voids) {
    const minCol = Math.floor(v.x - v.w / 2 + gridW / 2);
    const maxCol = Math.ceil(v.x + v.w / 2 + gridW / 2 - 1);
    const minRow = Math.floor(v.z - v.d / 2 + gridD / 2);
    const maxRow = Math.ceil(v.z + v.d / 2 + gridD / 2 - 1);
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        out.add(`${c},${r}`);
      }
    }
  }
  return out;
}
