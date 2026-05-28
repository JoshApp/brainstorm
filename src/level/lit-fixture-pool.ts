import type { ModelSpec } from '../ecs/model-types';
import type { WallFixtureKind } from './types';
import { WALL_TORCH } from '../content/torch';
import { WALL_CRESSET } from '../content/light-props';

// Lit-fixture pool — variant picker for wall-mounted light sources.
//
// "Lighting as signal" (CLAUDE.md): the dungeon's baseline is dark,
// any uncommon light source means SOMETHING is there. To diversify
// the SILHOUETTE of routine lighting without adding extra signals
// (and without growing the light pool budget), every wall-light
// emission rolls THIS pool: most rolls are torches, a minority are
// wall cressets. The torch budget is unchanged; the variety is
// purely visual.
//
// Floor-mounted variants (brazier, pike) are picked by a different
// path — see src/level/clutter.ts where the per-room edge/corner
// placement runs. They carry their own light specs (torch-class)
// and contend in the same environment slot pool as the wall
// variants, so adding a brazier to a room with 4 torches gives 5
// contenders for the same N slots — the LOS + frustum cull still
// trim to what the player sees.

interface WallFixtureEntry {
  kind: WallFixtureKind;
  model: ModelSpec;
  weight: number;
}

// Heavier weight on torches keeps the rooms reading as familiar
// dungeon — cressets are the occasional silhouette break, not the
// new default. Tune these to taste.
const WALL_FIXTURES: WallFixtureEntry[] = [
  { kind: 'torch',         model: WALL_TORCH,   weight: 75 },
  { kind: 'wall-cresset',  model: WALL_CRESSET, weight: 25 },
];

const WALL_TOTAL_WEIGHT = WALL_FIXTURES.reduce((s, e) => s + e.weight, 0);

/** Roll the wall-fixture pool, returning the variant kind. The
 *  caller stores this on TorchSpec.fixtureKind; lookup at build
 *  time turns it into the right ModelSpec via wallFixtureModel(). */
export function pickWallFixture(rand: () => number): WallFixtureKind {
  let r = rand() * WALL_TOTAL_WEIGHT;
  for (const e of WALL_FIXTURES) {
    r -= e.weight;
    if (r <= 0) return e.kind;
  }
  return WALL_FIXTURES[0].kind;
}

/** Resolve a fixture kind to its ModelSpec. Defaults to torch when
 *  the kind is undefined (legacy emission paths). */
export function wallFixtureModel(kind: WallFixtureKind | undefined): ModelSpec {
  if (!kind) return WALL_TORCH;
  const entry = WALL_FIXTURES.find((e) => e.kind === kind);
  return entry ? entry.model : WALL_TORCH;
}
