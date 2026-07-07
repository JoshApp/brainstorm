// The LOOT POOL registry — the ONE place that says what each drop source can
// yield (docs/BUILD-ECONOMY.md build-order #2). Chests, events, bosses, and the
// floor director's staged find all reference a pool by NAME; the tunable config
// lives here, not scattered across decor-defaults / shop / reliquary / floor-
// fill. Add a source = add a pool. Give something a UNIQUE pool = tag the items
// `drop: { pool: 'boss' }` and add a `{ tag: 'boss' }` pool below; those items
// then drop ONLY from that pool, never a generic chest.

import { rollLoot } from './loot';
import type { ItemSpec, ItemKind, Rarity } from './items';

/** Wearable/wieldable gear — what a strongbox or a defining find pulls from. */
export const GEAR_KINDS: readonly ItemKind[] =
  ['weapon', 'armor', 'helmet', 'amulet', 'gloves', 'boots', 'offhand', 'ring'];
export const CONSUMABLE_KINDS: readonly ItemKind[] = ['consumable'];

export interface LootPool {
  /** Quality bias (0 basic · 2 mid · 4 boss-tier). */
  bias?: number;
  /** Floor the rolled rarity up to at least this — optionally by depth, so a
   *  paid-for reward respects its cost ("floor of solid, chance of great"). */
  minRarity?: Rarity | ((depth: number) => Rarity);
  /** Restrict to these item kinds (a supply chest = consumables, a strongbox =
   *  gear). Omit for any kind. */
  category?: readonly ItemKind[];
  /** Draw ONLY from items tagged `drop.pool === tag` — a UNIQUE pool (boss
   *  signature drops, cursed relics). Omit to draw the GENERAL un-pooled items. */
  tag?: string;
  /** Gold to grant when the roll comes up empty (a chest must still give
   *  something). Read by the chest/reward code via poolEmptyGold, not the roller. */
  emptyGold?: number;
}

export const LOOT_POOLS = {
  // Chest tiers — the bronze / silver / gold identity.
  'chest-bronze': { bias: 0, category: CONSUMABLE_KINDS, emptyGold: 6 },
  'chest-silver': { bias: 2, category: GEAR_KINDS, emptyGold: 12 },
  'chest-gold':   { bias: 4, category: GEAR_KINDS, minRarity: (d) => (d >= 3 ? 'rare' : 'uncommon'), emptyGold: 20 },
  // The floor director's staged reward.
  'defining-find': { bias: 4, category: GEAR_KINDS, minRarity: (d) => (d >= 3 ? 'rare' : 'uncommon') },
  // Deals — each of these was a scattered rollLoot at its interactable.
  'merchant':  { bias: 2, category: GEAR_KINDS },
  'reliquary': { bias: 4, minRarity: 'rare' },
  'challenge': { bias: 4, minRarity: (d) => (d >= 3 ? 'rare' : 'uncommon'), category: GEAR_KINDS },
  // Unique pools — draw only from tagged items (nothing generic leaks in).
  'boss':   { tag: 'boss', bias: 4, minRarity: 'rare' },
  'cursed': { tag: 'cursed', bias: 4 },
} satisfies Record<string, LootPool>;

export type LootPoolId = keyof typeof LOOT_POOLS;

/** Roll one item from a NAMED pool — the single entry point every drop source
 *  should use. The pool decides bias / rarity floor / category / uniqueness, so
 *  call sites carry no tuning of their own. Deterministic given `rand`. */
export function rollPool(id: LootPoolId, depth: number, rand: () => number): ItemSpec | null {
  const p: LootPool = LOOT_POOLS[id];
  const minRarity = typeof p.minRarity === 'function' ? p.minRarity(depth) : p.minRarity;
  return rollLoot(
    { depth, bias: p.bias, minRarity, category: p.category ? [...p.category] : undefined, pool: p.tag },
    rand,
  );
}

/** The gold a pool grants when its roll comes up empty (0 if unset). */
export function poolEmptyGold(id: LootPoolId): number {
  const p: LootPool = LOOT_POOLS[id];
  return p.emptyGold ?? 0;
}
