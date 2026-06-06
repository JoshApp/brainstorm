// The authorable registry — one enumeration of everything the content/coding
// layers can author and preview, derived DIRECTLY from the data registries
// (ENEMIES, ITEMS) rather than hand-listed. Add a mob to enemies.ts or an item
// to items.ts and it shows up here for free — which means it shows up in the
// preview tooling for free (auto-generated snap scenarios, the in-browser
// viewer, `delve list`). This is the seam that makes "support all" cheap: the
// tooling enumerates against THIS, never against a hand-maintained list.
//
// Pure data — no THREE, no scenario types, no DOM. Safe to import from the
// browser (the viewer) AND from node CLIs (delve list / a validator). The
// scenario BUILDERS that turn an Authorable into a previewable world live in
// scenarios.ts (they need LevelSpec/THREE); this module only says WHAT exists
// and WHICH scenario name previews it.

import { ENEMIES, type EnemySpec } from '../content/enemies';
import { ITEMS, type ItemSpec } from '../content/items';

export type AuthorableKind = 'mob' | 'weapon' | 'item';

export interface Authorable {
  kind: AuthorableKind;
  /** Registry id (key into ENEMIES / ITEMS). */
  id: string;
  /** Human label for lists/menus. */
  label: string;
  /** The ?scenario=<name> that previews this subject. Convention-based so the
   *  viewer/snap can navigate to it without a lookup table. */
  scenario: string;
  /** Free-form tags for grouping/filtering in a picker (boss, rarity, kind…). */
  tags: string[];
}

function mobTags(spec: EnemySpec): string[] {
  return [
    spec.isBoss ? 'boss' : 'mob',
    spec.ranged ? 'ranged' : 'melee',
    ...(spec.presence ? [spec.presence] : []),
    ...(spec.phases && spec.phases.length ? ['multi-phase'] : []),
  ];
}

/** Every enemy in the registry, bosses included. */
export function listMobs(): Authorable[] {
  return Object.entries(ENEMIES).map(([id, spec]) => ({
    kind: 'mob' as const,
    id,
    label: spec.bossName ?? spec.name ?? id,
    scenario: `mob-${id}`,
    tags: mobTags(spec),
  }));
}

function isWeapon(spec: ItemSpec): boolean {
  return spec.kind === 'weapon' || !!spec.weapon;
}

/** Items that equip into the hand — previewed as a held first-person viewmodel
 *  (with the `?phase=` swing scrubber), distinct from the floating drop-model
 *  preview every item also gets. */
export function listWeapons(): Authorable[] {
  return Object.entries(ITEMS)
    .filter(([, spec]) => isWeapon(spec))
    .map(([id, spec]) => ({
      kind: 'weapon' as const,
      id,
      label: spec.name ?? id,
      scenario: `viewmodel-${id}`,
      tags: ['weapon', spec.weapon?.class, spec.rarity ?? 'mundane'].filter(Boolean) as string[],
    }));
}

/** Every item, previewed as its floating drop-model (rotating, studio-lit). */
export function listItems(): Authorable[] {
  return Object.entries(ITEMS).map(([id, spec]) => ({
    kind: 'item' as const,
    id,
    label: spec.name ?? id,
    scenario: `item-${id}`,
    tags: [spec.kind, spec.rarity ?? 'mundane'].filter(Boolean) as string[],
  }));
}

/** The whole authorable surface, in a stable order (mobs, weapons, items). */
export function listAuthorables(): Authorable[] {
  return [...listMobs(), ...listWeapons(), ...listItems()];
}
