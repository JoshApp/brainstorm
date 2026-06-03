// ─────────────────────────────────────────────────────────────────────
// Decor pass — procedural room fill by intent
// ─────────────────────────────────────────────────────────────────────
//
// Per vault, given a resolved palette:
//   1. Find candidate cells the chosen STYLE wants. For 'pillared',
//      that's wall-edge cells (pillars hug walls); for 'ruined',
//      that's interior cells (debris scatters across the floor);
//      etc.
//   2. Decide how many props to emit, scaled by candidate count and
//      the palette's density.
//   3. Skip cells the author already claimed (anything in cellProps)
//      and cells earlier passes claimed (e.g. lighting's torches).
//   4. Stride-sample remaining candidates so picks are spread.
//   5. Emit PropSpecs of the kind the style produces.
//
// Style 'off' bails immediately — same opt-out semantics as the
// lighting pass. Author cellProps placements ALWAYS win; the pass
// only ever ADDS more.
//
// v1 ships 'pillared' (the simplest, highest-payoff style). Other
// styles get added as their own switch arms here as they're authored.

import type { PropSpec, TileMap } from './types';
import type { Vault } from './vault';
import type { ResolvedPaletteV1, DecorStyle, Density } from './palette';

const WALKABLE = new Set('.,SoOD/^X%*'.split(''));
function isWalkable(map: TileMap, col: number, row: number): boolean {
  const r = map[row];
  if (!r) return false;
  const ch = r[col];
  return !!ch && WALKABLE.has(ch);
}

/** Wall-edge candidate (walkable + adjacent to at least one wall). */
function findWallEdgeCells(map: TileMap): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  const D = map.length;
  const W = map[0]?.length ?? 0;
  for (let r = 0; r < D; r++) {
    for (let c = 0; c < W; c++) {
      if (!isWalkable(map, c, r)) continue;
      if (
        !isWalkable(map, c, r - 1) ||
        !isWalkable(map, c, r + 1) ||
        !isWalkable(map, c - 1, r) ||
        !isWalkable(map, c + 1, r)
      ) {
        out.push({ col: c, row: r });
      }
    }
  }
  return out;
}

function densityFactor(density: Density): number {
  if (density === 'off') return 0;
  if (density === 'light') return 0.05;
  if (density === 'standard') return 0.10;
  /* dense */ return 0.18;
}

function targetCount(style: DecorStyle, density: Density, candidateCount: number): number {
  if (style === 'off' || density === 'off') return 0;
  return Math.max(1, Math.round(candidateCount * densityFactor(density)));
}

/**
 * Run the decor pass on one vault. Returns vault-local PropSpec
 * entries to be ADDED to the floor's props list. Composer applies
 * the per-vault offset before pushing into the level spec.
 *
 * `occupiedCells` is a set of `${col},${row}` keys that the pass
 * MUST skip: cells with author placements (cellProps) or earlier-
 * pass placements (lighting torches). The composer assembles this
 * set before calling the pass.
 */
export function decorPass(
  vault: Vault,
  palette: ResolvedPaletteV1,
  occupiedCells: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _rng: () => number,
): PropSpec[] {
  if (palette.decor.style === 'off' || palette.decor.density === 'off') return [];

  // v1 dispatch — only 'pillared' is wired. Other styles fall back
  // to no-op so the pass is safe to enable on every act even before
  // the corresponding style handler exists.
  let candidates: Array<{ col: number; row: number }>;
  let propFor: (cell: { col: number; row: number }) => PropSpec;
  switch (palette.decor.style) {
    case 'pillared': {
      candidates = findWallEdgeCells(vault.map);
      const W = vault.map[0]?.length ?? 0;
      const D = vault.map.length;
      propFor = (cell) => ({
        kind: 'pillar',
        x: cell.col + 0.5 - W / 2,
        z: cell.row + 0.5 - D / 2,
      });
      break;
    }
    // 'sparse' / 'ruined' / 'bone' / 'verdant' — not implemented yet.
    // No-op fallback keeps the contract: unknown style = nothing
    // placed, not a crash. Add a case here when each style's
    // candidate logic + prop palette is authored.
    default:
      return [];
  }

  const free = candidates.filter((c) => !occupiedCells.has(`${c.col},${c.row}`));
  const target = targetCount(palette.decor.style, palette.decor.density, free.length);
  if (target === 0 || free.length === 0) return [];

  const stride = free.length / target;
  const out: PropSpec[] = [];
  for (let i = 0; i < target; i++) {
    const idx = Math.floor(i * stride);
    out.push(propFor(free[Math.min(idx, free.length - 1)]));
  }
  return out;
}
