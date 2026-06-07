// Resolves a bench subject id → the ModelSpec to render. Subject ids reuse the
// scenario-name convention from the authorable registry (mob-<id>,
// viewmodel-<id>, item-<id>) so the bench, the snap scenarios, and `delve list`
// all speak the same names. The registry is the single source of WHAT exists;
// this maps each entry to WHICH model to build.

import { ENEMIES, type EnemySpec } from '../content/enemies';
import { ITEMS, type ItemSpec } from '../content/items';
import type { ModelSpec } from '../ecs/model-types';
import { listAuthorables, type AuthorableKind } from '../debug/authorables';
import { EFFECT_DEMOS } from './effects';
import { HAND_RIGHT, HAND_LEFT } from '../content/hand';
import { LURKER } from '../content/clutter';
import { SKELETON_KEY } from '../content/skeleton-key';

// Standalone ModelSpec subjects — assets that aren't items/mobs/effects but
// the LLM author still wants to inspect on the bench. Keyed by an id that
// the bench resolves under the `model-` prefix: `bench model-hand-right`.
// Add new entries here whenever you need a debug subject for a spec that
// the game owns but the authorable registry doesn't.

// Demo subject: a row of boxes with increasing bevel radius — left = hard
// cube, right = fully rounded. Lets me eyeball whether the bevel knob is
// reading right after a future tuning pass.
const BEVEL_DEMO: ModelSpec = {
  id: 'bevel-demo',
  materials: {
    a: { color: 0x4a3a26, roughness: 0.7, metalness: 0.2, flatShading: 'auto' },
    b: { color: 0x6a4a28, roughness: 0.55, metalness: 0.5, flatShading: 'auto' },
  },
  parts: [
    // Five identical 0.2m cubes spaced 0.25m apart, each with more bevel.
    { kind: 'box', pos: [-0.50, 0, 0], size: [0.20, 0.20, 0.20], mat: 'a' },
    { kind: 'box', pos: [-0.25, 0, 0], size: [0.20, 0.20, 0.20], bevel: 0.02, mat: 'a' },
    { kind: 'box', pos: [ 0.00, 0, 0], size: [0.20, 0.20, 0.20], bevel: 0.05, mat: 'a' },
    { kind: 'box', pos: [ 0.25, 0, 0], size: [0.20, 0.20, 0.20], bevel: 0.08, mat: 'a' },
    { kind: 'box', pos: [ 0.50, 0, 0], size: [0.20, 0.20, 0.20], bevel: 0.099, mat: 'b' },
  ],
};

// CSG demo: a row showing each boolean op on the SAME pair of
// primitives (a sphere and a box). Confirms the pipeline + lets me
// eyeball whether a future tuning pass broke watertightness.
const CSG_DEMO: ModelSpec = {
  id: 'csg-demo',
  materials: {
    stone: { color: 0x6a6258, roughness: 0.85, metalness: 0.2, flatShading: 'auto' },
  },
  parts: [
    // 0. ORIGINAL — sphere alone for reference.
    { kind: 'sphere', pos: [-0.45, 0, 0], radius: 0.10, segments: [16, 12], mat: 'stone' },
    // 1. ADD — sphere fused with a box. One continuous lump.
    {
      kind: 'csg', pos: [-0.15, 0, 0], op: 'add', mat: 'stone',
      a: { kind: 'sphere', radius: 0.10, segments: [16, 12], mat: 'stone' },
      b: { kind: 'box',    pos: [0.07, 0, 0], size: [0.10, 0.10, 0.10], mat: 'stone' },
    },
    // 2. SUBTRACT — sphere with the box carved out of it.
    {
      kind: 'csg', pos: [0.15, 0, 0], op: 'subtract', mat: 'stone',
      a: { kind: 'sphere', radius: 0.10, segments: [16, 12], mat: 'stone' },
      b: { kind: 'box',    pos: [0.07, 0, 0], size: [0.10, 0.10, 0.10], mat: 'stone' },
    },
    // 3. INTERSECT — the lens-shaped overlap region only.
    {
      kind: 'csg', pos: [0.45, 0, 0], op: 'intersect', mat: 'stone',
      a: { kind: 'sphere', radius: 0.10, segments: [16, 12], mat: 'stone' },
      b: { kind: 'box',    pos: [0.07, 0, 0], size: [0.10, 0.10, 0.10], mat: 'stone' },
    },
  ],
};

const STANDALONE_MODELS: Record<string, { label: string; spec: ModelSpec }> = {
  'hand-right':  { label: 'Right hand viewmodel', spec: HAND_RIGHT },
  'hand-left':   { label: 'Left hand viewmodel (mirrored)', spec: HAND_LEFT },
  'lurker':      { label: 'Lurker — hunched silhouette with dim eyes', spec: LURKER },
  'bevel-demo':  { label: 'Bevel radius demo (0 → 0.099m)', spec: BEVEL_DEMO },
  'csg-demo':    { label: 'CSG: original / add / subtract / intersect', spec: CSG_DEMO },
  'skeleton-key': { label: 'Skeleton key — skull bow with glowing eye sockets', spec: SKELETON_KEY },
};

export interface BenchSubject {
  id: string;             // the subject id (= authorable.scenario), e.g. 'mob-ghoul'
  kind: AuthorableKind;
  label: string;
  spec: ModelSpec;
  /** For mobs: the full spec, so the bench can drive its telegraph animation. */
  enemy?: EnemySpec;
  /** For weapons: the item, so the bench can drive its combo swing. */
  item?: ItemSpec;
}

export function resolveSubject(subjectId: string): BenchSubject | null {
  if (subjectId.startsWith('mob-')) {
    const id = subjectId.slice(4);
    const e = ENEMIES[id];
    if (!e) return null;
    return { id: subjectId, kind: 'mob', label: e.bossName ?? e.name ?? id, spec: e.model, enemy: e };
  }
  if (subjectId.startsWith('viewmodel-')) {
    const id = subjectId.slice('viewmodel-'.length);
    const it = ITEMS[id];
    const spec = it?.viewmodel ?? it?.dropModel;
    if (!spec) return null;
    return { id: subjectId, kind: 'weapon', label: it.name ?? id, spec, item: it };
  }
  if (subjectId.startsWith('item-')) {
    const id = subjectId.slice('item-'.length);
    const it = ITEMS[id];
    if (!it?.dropModel) return null;
    return { id: subjectId, kind: 'item', label: it.name ?? id, spec: it.dropModel };
  }
  if (subjectId.startsWith('model-')) {
    const id = subjectId.slice('model-'.length);
    const m = STANDALONE_MODELS[id];
    if (!m) return null;
    return { id: subjectId, kind: 'item', label: m.label, spec: m.spec };
  }
  return null;
}

export interface SubjectEntry { id: string; label: string; kind: string; }

/** Everything the bench can render — authorable models (mob/weapon/item),
 *  effect demos, and standalone debug models — for the picker + the CLI's
 *  --list. */
export function listSubjects(): SubjectEntry[] {
  return [
    ...listAuthorables().map((a) => ({ id: a.scenario, label: a.label, kind: a.kind as string })),
    ...EFFECT_DEMOS.map((e) => ({ id: e.id, label: e.label, kind: 'effect' })),
    ...Object.entries(STANDALONE_MODELS).map(([id, m]) => ({
      id: `model-${id}`, label: m.label, kind: 'model',
    })),
  ];
}
