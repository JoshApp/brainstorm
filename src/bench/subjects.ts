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
import { HAND_RIGHT } from '../content/hand';

// Standalone ModelSpec subjects — assets that aren't items/mobs/effects but
// the LLM author still wants to inspect on the bench. Keyed by an id that
// the bench resolves under the `model-` prefix: `bench model-hand-right`.
// Add new entries here whenever you need a debug subject for a spec that
// the game owns but the authorable registry doesn't.
const STANDALONE_MODELS: Record<string, { label: string; spec: ModelSpec }> = {
  'hand-right': { label: 'Right hand viewmodel', spec: HAND_RIGHT },
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
