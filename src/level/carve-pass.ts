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
      if (free.length === 0) return [];
      const W = vault.map[0]?.length ?? 0;
      const D = vault.map.length;

      // A CHASM IS AN OBSTACLE, NOT A TEXTURE.
      //
      // Scattered cracks — even well-shaped ones — change nothing about how you
      // move through a room; you walk around them without noticing you did.
      // What a hole in the floor is actually GOOD at is making you choose a
      // side, and that only happens if it lies ACROSS your path and is long
      // enough that going around costs you something.
      //
      // So a fissured room gets ONE deliberate rift, spanning the room's LONG
      // axis (the direction you have the most room to route around in), with a
      // CROSSING left in it — a walkable ledge you have to find and commit to.
      // Two spans and a gap, not a pothole. Everything downstream still sees
      // ordinary void rects, so nothing else in the pipeline changes.
      //
      // Deterministic: which lane it sits in and where the crossing falls come
      // from the room's own dimensions. The pass has never taken rng and the
      // composer relies on that.
      const isFree = (col: number, row: number) =>
        !occupiedCells.has(`${col},${row}`)
        && free.some((c) => c.col === col && c.row === row);

      const horiz = W >= D;               // the rift runs along the LONG axis
      const across = horiz ? D : W;       // the short axis it has to sit within
      const along = horiz ? W : D;
      // Needs a room with something to route around in: too small and the rift
      // is a wall, not a choice.
      if (along < 6 || across < 5) return [];

      // The lane: offset from centre so the two sides are UNEQUAL — a rift down
      // the exact middle is a symmetrical non-decision. Deterministic offset.
      const lane = Math.floor(across / 2) + ((along + across) % 2 === 0 ? -1 : 1);
      if (lane < 2 || lane > across - 3) return [];

      // Walk the lane, splitting at the crossing. Cells that aren't free (a
      // pillar, an authored prop, the stair) simply end the current span, which
      // is how the rift naturally breaks around what the room already contains.
      const CROSS_AT = Math.floor(along * 0.5) + ((along % 3) - 1);   // roughly mid, nudged
      const CROSS_WIDTH = 2;                                          // cells you can walk
      const WIDTH = 1.1;   // across the rift — too wide to stride, must be rounded
      const out: WalkableRect[] = [];
      let runStart = -1;
      const flush = (endExcl: number) => {
        const len = endExcl - runStart;
        if (runStart < 0 || len < 2) { runStart = -1; return; }   // a 1-cell hole is a pothole
        const mid = runStart + len / 2 - 0.5;
        out.push({
          x: (horiz ? mid : lane) + 0.5 - W / 2,
          z: (horiz ? lane : mid) + 0.5 - D / 2,
          w: horiz ? len - 0.15 : WIDTH,
          d: horiz ? WIDTH : len - 0.15,
        });
        runStart = -1;
      };
      for (let i = 1; i < along - 1; i++) {
        const inCrossing = i >= CROSS_AT && i < CROSS_AT + CROSS_WIDTH;
        const usable = !inCrossing
          && (horiz ? isFree(i, lane) : isFree(lane, i));
        if (usable) { if (runStart < 0) runStart = i; }
        else flush(i);
      }
      flush(along - 1);
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
