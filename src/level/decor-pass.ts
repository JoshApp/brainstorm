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
import { RUINED_COLUMN, FALLEN_PILLAR_SEGMENT } from '../content/clutter';

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
  depth = 1,
): PropSpec[] {
  if (palette.decor.style === 'off' || palette.decor.density === 'off') return [];

  const W = vault.map[0]?.length ?? 0;
  const D = vault.map.length;

  switch (palette.decor.style) {
    case 'pillared':
    case 'ruined': {
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

      // DECAY (the ruined colonnade): the hall STAYS symmetric — that's the
      // authored intent — but history breaks some members. The chance scales
      // with depth (shallow halls stand whole; deep ones are wrecks), and the
      // 'ruined' style forces it high regardless of depth. A broken member is a
      // RUINED_COLUMN stub, and half the time its FALLEN piece lies beside it
      // (the pair tells the story of the collapse in one glance).
      const decay = palette.decor.style === 'ruined'
        ? 0.55
        : Math.max(0, Math.min(0.45, (depth - 3) * 0.06));
      const toWorld = (cell: { col: number; row: number }) => ({
        x: cell.col + 0.5 - W / 2,
        z: cell.row + 0.5 - D / 2,
      });

      const out: PropSpec[] = [];
      for (const cell of cells) {
        const { x, z } = toWorld(cell);
        if (decay > 0 && rng() < decay) {
          out.push({ kind: 'model', model: RUINED_COLUMN, x, y: 0, z, rotY: rng() * Math.PI * 2, collision: { kind: 'circle', r: 0.34 } });
          // The toppled piece lying beside the stub, angled AWAY from the room
          // centre so it doesn't sprawl across the walking space.
          if (rng() < 0.5) {
            const ox = x < 0 ? -0.9 : 0.9;
            out.push({ kind: 'model', model: FALLEN_PILLAR_SEGMENT, x: x + ox, y: 0, z, rotY: rng() * Math.PI, collision: { kind: 'circle', r: 0.45 } });
          }
        } else {
          out.push({ kind: 'pillar', x, z });
        }
      }
      return out;
    }
    // 'sparse' / 'bone' / 'verdant' — not implemented yet. No-op fallback keeps
    // the pass safe on any act (unknown style = nothing placed, not a crash).
    default:
      return [];
  }
}
