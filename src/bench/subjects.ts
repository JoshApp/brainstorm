// Resolves a bench subject id → the ModelSpec to render. Subject ids reuse the
// scenario-name convention from the authorable registry (mob-<id>,
// viewmodel-<id>, item-<id>) so the bench, the snap scenarios, and `delve list`
// all speak the same names. The registry is the single source of WHAT exists;
// this maps each entry to WHICH model to build.

import { ENEMIES, type EnemySpec } from '../content/enemies';
import { ITEMS, type ItemSpec } from '../content/items';
import { compileCreatureModelSpec } from '../content/build-creature';
import type { ModelSpec } from '../ecs/model-types';
import { ORIGIN_ARCH } from '../content/origin-arch';
import { listAuthorables, type AuthorableKind } from '../debug/authorables';
import { EFFECT_DEMOS } from './effects';
import { makeCorpseModel } from '../content/corpse-model';
import { HAND_RIGHT, HAND_LEFT } from '../content/hand';
import { HAND_LEFT_LANTERN } from '../content/hand-poses';
import { ESTUS_FLASK, RELIC_BUNDLE } from '../content/loot-models';
import { composeFlaskHold } from '../player/flask-hold';
import type { HeldWeaponCompose } from '../player/held-weapon-compose';
import { LURKER } from '../content/clutter';
import { SKELETON_KEY } from '../content/skeleton-key';
import { OSSUARY_NICHE, OSSUARY_NICHE_SMALL } from '../content/ossuary';
import { CHEST, CHEST_IRON, CHEST_BOSS } from '../content/chest';
import { MERCHANT_MODEL, RELIC_KEEPER_MODEL } from '../interactables/merchant';
import { BLACKSMITH_MODEL } from '../interactables/blacksmith';
import { archway } from '../content/archway';
import { doorframe } from '../content/doorframe';

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
  'hand-left-lantern': { label: 'Left hand, ring-carry pose', spec: HAND_LEFT_LANTERN },
  'lurker':      { label: 'Lurker — hunched silhouette with dim eyes', spec: LURKER },
  'bevel-demo':  { label: 'Bevel radius demo (0 → 0.099m)', spec: BEVEL_DEMO },
  'csg-demo':    { label: 'CSG: original / add / subtract / intersect', spec: CSG_DEMO },
  'skeleton-key': { label: 'Skeleton key — skull bow with glowing eye sockets', spec: SKELETON_KEY },
  'ossuary-niche': { label: 'Ossuary niche — double-bay bone cabinet (PALE family)', spec: OSSUARY_NICHE },
  'ossuary-niche-small': { label: 'Ossuary niche small — single-bay bone shrine (PALE family)', spec: OSSUARY_NICHE_SMALL },
  'origin-arch': { label: 'Origin arch — sealed round arch behind the spawn bonfire', spec: ORIGIN_ARCH },
  'corpse-crawled': { label: 'Fallen delver — crawled, with pack', spec: makeCorpseModel('crawled', 'fleshy', true) },
  'corpse-curled': { label: 'Fallen delver — curled', spec: makeCorpseModel('curled', 'fleshy', false) },
  'corpse-slumped': { label: 'Fallen delver — slumped, with pack', spec: makeCorpseModel('slumped', 'fleshy', true) },
  'corpse-skeletal': { label: 'Fallen delver — skeletal (curled)', spec: makeCorpseModel('curled', 'skeletal', false) },
  'chest-wood':   { label: 'Chest — wood (free tier)', spec: CHEST },
  'chest-silver': { label: 'Chest — iron-bound silver (keyed)', spec: CHEST_IRON },
  'chest-gold':   { label: 'Chest — gold, occult sigil + horns (imposing prize)', spec: CHEST_BOSS },
  'relic-bundle': { label: 'Relic bundle — cord-wrapped talisman, bone shard + branded sigil (relic placeholder)', spec: RELIC_BUNDLE },
  'merchant':      { label: 'The wandering merchant — hooded trader, pack + lantern staff', spec: MERCHANT_MODEL },
  'relic-keeper':  { label: 'The relic-keeper — trinket merchant, arcane charms', spec: RELIC_KEEPER_MODEL },
  'blacksmith':    { label: 'The blacksmith — smith at anvil + coal forge', spec: BLACKSMITH_MODEL },
  // THE THRESHOLDS. Every doorway in the game is one of these two, and until
  // now neither could be LOOKED at — the `archway` snap scenario drops you in a
  // corridor facing away from one, and the models are built per-instance from a
  // width, so there was no registry entry to resolve. Both are pinned at the
  // widths the generator actually produces (`chooseFrameModel` picks the
  // archway above ~1.3m and the slimmer doorframe below), so what the bench
  // shows is what a floor ships.
  'archway':        { label: 'Archway — wide threshold, keystone carries the eye', spec: archway({ width: 1.8, ceilingHeight: 3.6 }) },
  'archway-narrow': { label: 'Archway at its minimum width (1.3m)', spec: archway({ width: 1.3, ceilingHeight: 3.0 }) },
  'doorframe':      { label: 'Doorframe — the slim threshold, for narrow openings', spec: doorframe({ width: 1.1, ceilingHeight: 3.2 }) },
};

// Pre-composed subjects — hand + object compositions that AREN'T weapons
// (so the generic --hand flag doesn't reach them) but still need bench eyes
// on the grip. The bench renders the composition root exactly like a
// --hand weapon subject.
const COMPOSED_MODELS: Record<string, { label: string; spec: ModelSpec; compose: () => HeldWeaponCompose }> = {
  'flask-held': { label: 'Right hand cupping the estus flask', spec: ESTUS_FLASK, compose: composeFlaskHold },
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
  /** Pre-composed hand+object subjects: build THIS instead of spec alone. */
  compose?: () => HeldWeaponCompose;
}

export function resolveSubject(subjectId: string): BenchSubject | null {
  if (subjectId.startsWith('mob-')) {
    const id = subjectId.slice(4);
    const e = ENEMIES[id];
    if (!e) return null;
    // Render the creature through the plain buildModel path: compile its
    // skeleton+skin to a flat ModelSpec. The mob animator still drives it via
    // the EnemySpec animation hooks (tiltPartName/eyeMaterialName/…).
    return { id: subjectId, kind: 'mob', label: e.bossName ?? e.name ?? id, spec: compileCreatureModelSpec(e.creature), enemy: e };
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
    const c = COMPOSED_MODELS[id];
    if (c) return { id: subjectId, kind: 'item', label: c.label, spec: c.spec, compose: c.compose };
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
    ...Object.entries(COMPOSED_MODELS).map(([id, m]) => ({
      id: `model-${id}`, label: m.label, kind: 'model',
    })),
  ];
}
