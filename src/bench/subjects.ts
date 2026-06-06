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
  return null;
}

export interface SubjectEntry { id: string; label: string; kind: string; }

/** Everything the bench can render — authorable models (mob/weapon/item) plus
 *  the effect demos — for the picker + the CLI's --list. */
export function listSubjects(): SubjectEntry[] {
  return [
    ...listAuthorables().map((a) => ({ id: a.scenario, label: a.label, kind: a.kind as string })),
    ...EFFECT_DEMOS.map((e) => ({ id: e.id, label: e.label, kind: 'effect' })),
  ];
}
