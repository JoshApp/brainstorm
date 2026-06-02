// ─────────────────────────────────────────────────────────────────────
// Vault format experiment — DRAFT (not imported)
// ─────────────────────────────────────────────────────────────────────
//
// Same vault, three authoring formats, hand-authored to test the LLM
// ergonomics question. Brief given to "the LLM": "11×7 combat vault,
// two pillars flanking the back, boss spawn dead center, two torches
// in south corners, three rolled-enemy slots arranged in a triangle
// around the boss spawn."
//
// What we're testing: HOW MUCH COORDINATE MATH the format forces, and
// where each format's error surface lives. Coord math is the single
// biggest LLM failure mode (off-by-half, sign flip, wrong half-cell
// offset).
//
// Reference grid math (engine convention):
//   Vault is 11 cols × 7 rows. Cell (col, row) world center:
//     x = col + 0.5 - 11/2 = col - 5
//     z = row + 0.5 - 7/2  = row - 3
//   So cell (5, 3) is at world (0, 0). Cell (1, 5) is at (-4, 2).

import type { Vault } from './vault';
import type { PropSpec, TorchSpec, TileMap } from './types';

// Format A's `torch` entries aren't a real PropSpec kind (TorchSpec
// is a separate type fed via vault.torches). For the experiment we
// represent them inline in the props array as a CONCEPTUAL torch
// entry — the LLM's job is just authoring the shape, not getting
// our existing PropSpec discriminant right. Stub type:
type ExperimentProp =
  | PropSpec
  | (Partial<TorchSpec> & { kind: 'torch' })
  | { kind: 'pillar'; x: number; z: number; offset?: [number, number] };

// ── FORMAT A: current — absolute world coords ──────────────────────
//
// Every prop has world x/z. The LLM must compute these from the cell
// it picked. Five props here = ten coord computations.
//
// Risk hotspots flagged with [MATH N]:

const CRYPT_PITS_A: Omit<Vault, 'props'> & { props: ExperimentProp[] } = {
  id: 'crypt-pits',
  tags: ['combat'],
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#.........#',
    '#..X...X..#',
    '#....X....#',
    '###########',
  ],
  props: [
    // Pillars flanking the back. Cells (3,1) and (7,1).
    // [MATH 1] x = 3 - 5 = -2.  [MATH 2] z = 1 - 3 = -2.
    { kind: 'pillar', x: -2, z: -2 },
    // [MATH 3] x = 7 - 5 = 2.
    { kind: 'pillar', x:  2, z: -2 },
    // Boss spawn dead center. Cell (5, 3) → (0, 0).
    // [MATH 4][MATH 5] depend on grid being odd; an even-dim grid
    // would have NO single center cell. Easy to mishandle.
    { kind: 'spawn', enemyId: 'boiling-king', x: 0, z: 0 },
    // South corner torches. Cells (1, 5) and (9, 5).
    // [MATH 6] x = 1 - 5 = -4.  [MATH 7] z = 5 - 3 = 2.
    { kind: 'torch', x: -4, z: 2, wall: 'S', height: 2.2 },
    // [MATH 8] x = 9 - 5 = 4.
    { kind: 'torch', x:  4, z: 2, wall: 'S', height: 2.2 },
  ],
};

// ── FORMAT B: cell-bound dict ──────────────────────────────────────
//
// The cell IS the binding. Zero coordinate math — the engine does
// cell→world translation. The LLM only counts columns in the ASCII.
//
// Same vault, no MATH markers, because there's no math.

interface CellBoundVault {
  id: string;
  tags: string[];
  map: TileMap;
  /** Key is `${col},${row}`. Multiple props per cell stack. */
  cellProps?: Record<`${number},${number}`, ExperimentProp[]>;
}

const CRYPT_PITS_B: CellBoundVault = {
  id: 'crypt-pits',
  tags: ['combat'],
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#.........#',
    '#..X...X..#',
    '#....X....#',
    '###########',
  ],
  cellProps: {
    // Pillars flanking the back.
    '3,1': [{ kind: 'pillar', x: 0, z: 0 }],
    '7,1': [{ kind: 'pillar', x: 0, z: 0 }],
    // Boss spawn dead center.
    '5,3': [{ kind: 'spawn', enemyId: 'boiling-king', x: 0, z: 0 }],
    // South corner torches.
    '1,5': [{ kind: 'torch', wall: 'S', height: 2.2 }],
    '9,5': [{ kind: 'torch', wall: 'S', height: 2.2 }],
  },
};

// ── FORMAT C: cell-bound + sub-cell offset ─────────────────────────
//
// Same as B but each cell-bound prop accepts an OPTIONAL offset in
// cell-local coords (0 = cell center, ±0.5 = cell edge). Lets an
// author nudge a torch off-center within its cell without dropping
// into absolute coords. Still zero world-coord math.
//
// The brief didn't ask for nudges, so this version is identical to
// B except for two pillars I'm hand-nudging slightly inward to read
// as "flanking" rather than "centered in cell 3 / cell 7":

const CRYPT_PITS_C: CellBoundVault = {
  id: 'crypt-pits',
  tags: ['combat'],
  map: CRYPT_PITS_B.map,
  cellProps: {
    // 'offset' = sub-cell nudge in cell-local meters. NO world-coord
    // math — the offset is relative to the cell's own center.
    '3,1': [{ kind: 'pillar', x: 0, z: 0, offset: [0.2, 0] }],
    '7,1': [{ kind: 'pillar', x: 0, z: 0, offset: [-0.2, 0] }],
    '5,3': [{ kind: 'spawn', enemyId: 'boiling-king', x: 0, z: 0 }],
    '1,5': [{ kind: 'torch', wall: 'S', height: 2.2 }],
    '9,5': [{ kind: 'torch', wall: 'S', height: 2.2 }],
  },
};

// ── Error-surface comparison ────────────────────────────────────────
//
//   Format A (absolute coords):
//     - 8 coordinate computations the LLM must get right.
//     - Each is (cellIndex - halfDim + halfCell). Sign + half-cell
//       offset are the two most common error modes I've seen LLMs
//       make on this kind of task.
//     - The numbers in the file don't visibly correspond to anything
//       the LLM authored — `{ x: -4, z: 2 }` requires mentally
//       re-projecting onto the ASCII to verify "is that actually the
//       south corner I wanted?"
//
//   Format B (cell-bound):
//     - 0 coordinate computations.
//     - The cell key `'1,5'` reads in the same coordinate space the
//       LLM just wrote the ASCII in: column 1, row 5. A human
//       reviewer can count columns in the map and verify the prop is
//       where it claims.
//     - Stacking is trivial: cell key → array. Multiple props at the
//       same cell is `'5,3': [a, b, c]`.
//     - Loses sub-cell precision — every cell-bound prop sits at the
//       cell center unless...
//
//   Format C (cell-bound + offset):
//     - 0 world-coord computations.
//     - Sub-cell precision via `offset: [dx, dz]` in CELL-LOCAL space
//       (range ~±0.5). The LLM thinks "nudge a bit east", not
//       "compute x=2.2 globally".
//     - Same readability as B for the common (no-offset) case; opt-in
//       precision for the rare nudge case.
//
// ── Verbosity ───────────────────────────────────────────────────────
//
//   Format A: 5 props × 4 fields = 20 field tokens
//   Format B: 5 cellProps × 2-3 fields each = 12 field tokens
//   Format C: same as B unless nudging
//
//   B/C are slightly LESS verbose than A because the cell key
//   replaces two coord fields with one short string.
//
// ── Refactor safety ─────────────────────────────────────────────────
//
//   If we edit the ASCII map (delete a row, widen a column):
//     A: props at old world coords might silently land in a wall.
//     B/C: cell key `'9,5'` either still refers to a valid cell, or
//          fails a runtime/typecheck. Errors surface immediately.
//
// ── Conclusion ──────────────────────────────────────────────────────
//
// The cell-bound formats win on every axis that matters here:
//
//   - LLM error surface: dramatically lower (zero coord math).
//   - Human reviewability: the cell key is in the same space as the
//     ASCII, so spot-checks are visual.
//   - Refactor safety: stale cell refs surface as errors, not as
//     silently-misplaced meshes.
//   - Stacking: a cell's contents are a single array.
//   - Verbosity: marginally less than A.
//   - Sub-cell precision: available as C's offset escape hatch.
//
// The only thing A wins on is "you can compute any sub-cell point
// directly" — but Format C plus the existing absolute-coord `props`
// array (kept as the truly-rare escape hatch for things like
// king-flanking sconces at x=±2.5) covers that case.
//
// Recommendation: adopt Format C. Existing props-array authoring
// keeps working for the genuine sub-cell escape cases; cellProps
// becomes the default path for new vaults and migrated decor.
