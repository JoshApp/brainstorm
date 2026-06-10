// ─────────────────────────────────────────────────────────────────────
// Lighting pass — procedural wall torches by intent
// ─────────────────────────────────────────────────────────────────────
//
// Per vault, given a resolved palette:
//   1. Find every walkable cell that has a wall on at least one side
//      (candidate cell + wall direction).
//   2. Decide how many torches to emit, scaled by the room's
//      perimeter and the palette's density.
//   3. Stride-sample across the candidates so the torches read as
//      evenly distributed, not clumped.
//   4. Skip cells the author already lit (cellProps `*` char or
//      vault.torches array) and cells the vault marked as protect
//      (future field; currently unused).
//   5. Emit one TorchSpec per pick, tinted from the palette.
//
// Author-placed torches always win. The pass SUPPLEMENTS them — if
// you wrote two `*` chars in a vault and the palette says 'dense',
// the pass adds more to reach the target. Set density to 'off' for
// "no procedural torches at all; only what I wrote."
//
// Deterministic per (run seed, vault). The pass walks candidate
// cells in a stable order (rows top→bottom, cols left→right) and
// strides via integer math — no rng dependence yet. (rng arg
// kept for future density-jitter / wall-choice randomisation.)

import type { TorchSpec, TileMap } from './types';
import type { Vault } from './vault';
import type { ResolvedPaletteV1, LightDensity } from './palette';

/** Cells a torch can sit on (walkable + adjacent to wall). Matches
 *  tilemap.ts's FLOOR_CHARS exactly. */
const WALKABLE = new Set('.,SoOD/^X%*'.split(''));
function isWalkable(map: TileMap, col: number, row: number): boolean {
  const r = map[row];
  if (!r) return false;
  const ch = r[col];
  if (!ch) return false;
  return WALKABLE.has(ch);
}

/** A candidate torch slot — walkable cell + the wall direction it
 *  should mount on. If multiple walls flank a cell (corner), priority
 *  is N → E → W → S so back-wall torches dominate. */
interface Candidate {
  col: number;
  row: number;
  wall: 'N' | 'S' | 'E' | 'W';
}

function findCandidates(map: TileMap): Candidate[] {
  const out: Candidate[] = [];
  const D = map.length;
  const W = map[0]?.length ?? 0;
  for (let r = 0; r < D; r++) {
    for (let c = 0; c < W; c++) {
      if (!isWalkable(map, c, r)) continue;
      // Prefer N (back wall in most vaults) → E → W → S so torches
      // sit on the wall the player faces toward most.
      if (!isWalkable(map, c, r - 1)) { out.push({ col: c, row: r, wall: 'N' }); continue; }
      if (!isWalkable(map, c + 1, r)) { out.push({ col: c, row: r, wall: 'E' }); continue; }
      if (!isWalkable(map, c - 1, r)) { out.push({ col: c, row: r, wall: 'W' }); continue; }
      if (!isWalkable(map, c, r + 1)) { out.push({ col: c, row: r, wall: 'S' }); continue; }
    }
  }
  return out;
}

/** How many torches the pass aims for, based on density + room
 *  perimeter (the more wall-edge cells exist, the more torches a
 *  given density level wants). The factors below were eyeballed
 *  against the existing vault library — 'medium' on a 12×8 combat
 *  room gives ~4 torches, matching today's hand-authored pattern. */
function targetTorchCount(density: LightDensity, candidateCount: number): number {
  if (density === 'off') return 0;
  if (density === 'dark') return Math.min(1, candidateCount);
  const factor =
    density === 'sparse' ? 0.10 :
    density === 'medium' ? 0.16 :
    /* dense */            0.24;
  return Math.max(1, Math.round(candidateCount * factor));
}

/**
 * Run the lighting pass on one vault. Returns the TorchSpecs to be
 * ADDED to the floor's torch list — the composer concatenates this
 * with the vault's hand-authored torches (cellProps `*` chars and
 * vault.torches array, both already emitted upstream).
 *
 * `existingTorchCells` is the set of `${col},${row}` cells where the
 * author already placed a torch; the pass skips those.
 */
export function lightingPass(
  vault: Vault,
  palette: ResolvedPaletteV1,
  existingTorchCells: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _rng: () => number,
): TorchSpec[] {
  if (palette.light.density === 'off') return [];
  // Exclusion zone: the cell itself, anything the caller marked, AND
  // any cell within 1 of an authored '*' light — the pass used to
  // know only about cellProps torches, so it would happily drop an
  // act-tinted torch ONE CELL from an authored vault-tinted one:
  // two wall fixtures a metre apart in clashing hues (the classic
  // sighting: a pale room's cresset beside a warm act torch).
  const starCells: Array<[number, number]> = [];
  vault.map.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '*') starCells.push([c, r]);
  });
  const nearStar = (col: number, row: number) =>
    starCells.some(([sc, sr]) => Math.abs(sc - col) <= 1 && Math.abs(sr - row) <= 1);
  const candidates = findCandidates(vault.map)
    .filter((c) => !existingTorchCells.has(`${c.col},${c.row}`) && !nearStar(c.col, c.row));
  const target = targetTorchCount(palette.light.density, candidates.length);
  if (target === 0 || candidates.length === 0) return [];

  // Stride-sample the candidates so picks are spread along the
  // perimeter, not bunched in one corner. Deterministic: same map +
  // same density → same picks, regardless of rng.
  const stride = candidates.length / target;
  const picks: Candidate[] = [];
  for (let i = 0; i < target; i++) {
    const idx = Math.floor(i * stride);
    picks.push(candidates[Math.min(idx, candidates.length - 1)]);
  }

  // Vault-local coords: cell (col, row) → (col + 0.5 - W/2, row + 0.5 - D/2).
  const W = vault.map[0]?.length ?? 0;
  const D = vault.map.length;
  // Per-vault tint override WINS over the act palette — the same rule
  // parseTileMap's '*' path follows. Without this, a pale-committed
  // vault got act-warm procedural torches beside its pale authored
  // ones, breaking the one-hue-per-room law.
  const tint = vault.torchTint ?? palette.light.tintOverride ?? palette.tone.lightTint;

  // Match the wall-offset convention parseTileMap's '*' case uses so
  // procedural torches sit at the same depth into the room as author
  // torches.
  const WALL_OFFSET = 0.32;
  return picks.map((p) => {
    const x0 = p.col + 0.5 - W / 2;
    const z0 = p.row + 0.5 - D / 2;
    const x = p.wall === 'W' ? x0 - WALL_OFFSET : p.wall === 'E' ? x0 + WALL_OFFSET : x0;
    const z = p.wall === 'N' ? z0 - WALL_OFFSET : p.wall === 'S' ? z0 + WALL_OFFSET : z0;
    return {
      x, z,
      height: 2.2,
      wall: p.wall,
      colorTint: tint,
      intensityMul: palette.tone.lightIntensity,
    };
  });
}
