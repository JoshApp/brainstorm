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
import type { ResolvedPaletteV1 } from './palette';
import { symmetricPillars } from './room-decor';

const WALKABLE = new Set('.,SoOD/^X%*'.split(''));
function isWalkable(map: TileMap, col: number, row: number): boolean {
  const r = map[row];
  if (!r) return false;
  const ch = r[col];
  return !!ch && WALKABLE.has(ch);
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
  rng: () => number,
): PropSpec[] {
  if (palette.decor.style === 'off' || palette.decor.density === 'off') return [];

  const W = vault.map[0]?.length ?? 0;
  const D = vault.map.length;

  switch (palette.decor.style) {
    case 'pillared': {
      // STRUCTURE grammar — a SYMMETRIC inset colonnade, not a wall-edge scatter
      // (see room-decor.ts). Symmetric + inset reads as architecture and keeps
      // the pillars clear of wall openings. `isBlocked` folds the tilemap walls
      // together with everything earlier passes claimed — authored props,
      // torches, carved voids, and the doorway margin the composer reserves —
      // so a pillar never lands on any of them.
      const isBlocked = (c: number, r: number) =>
        occupiedCells.has(`${c},${r}`) || !isWalkable(vault.map, c, r);
      const tier = palette.decor.density === 'light' ? 'light'
        : palette.decor.density === 'dense' ? 'dense' : 'standard';
      const cells = symmetricPillars(W, D, tier, isBlocked, rng);
      return cells.map((cell) => ({
        kind: 'pillar',
        x: cell.col + 0.5 - W / 2,
        z: cell.row + 0.5 - D / 2,
      }));
    }
    // 'sparse' / 'ruined' / 'bone' / 'verdant' — not implemented yet. The
    // 'ruined' style is the natural next grammar: the symmetric colonnade with
    // DECAY applied to some members (a toppled/cracked pillar) + debris clusters,
    // distinct from the surface clutter pass (clutter.ts). No-op until authored.
    default:
      return [];
  }
}
