// DROP TABLES — THE single registry of what every source drops (docs/BUILD-ECONOMY.md).
// One place authors the whole economy: enemies, vases, the three chest tiers,
// bosses, events, corpses. A source names a table; the table declares its FULL
// drop — gold, the odd key, and item roll(s) — so no call site carries tuning and
// nothing is scattered across enemies.ts / decor-defaults / the interactables.
//
// A table composes three things, any of which may be omitted:
//   • gold:      a min..max range granted as coins
//   • keyChance: a chance to also cough up a skeleton-key
//   • item:      one or more rolls through the loot roller (rarity-by-depth),
//                filtered by category / pool / rarity floor
// Guaranteed ids always drop; emptyGold is the consolation when the item roll(s)
// whiff (a chest must give SOMETHING). rollDropTable returns a resolved bundle
// the caller just spawns — createPickup for items, spawnGoldCoins for gold.

import { rollLoot } from './loot';
import { ITEMS } from './items';
import type { ItemSpec, ItemKind, Rarity } from './items';

// The three gear SLOTS (weapon/offhand/vestment). The old armor paperdoll kinds
// still route into the vestment slot (equipment.ts), so they count as gear here
// until real vestments replace them. ring/amulet are DELIBERATELY absent — they
// are relics now (see RELIC_KINDS), so gear pools never leak a relic.
export const GEAR_KINDS: readonly ItemKind[] =
  ['weapon', 'offhand', 'vestment', 'armor', 'helmet', 'gloves', 'boots'];
export const CONSUMABLE_KINDS: readonly ItemKind[] = ['consumable'];
// Relics — the reliquary's stacking trinkets. Real relics are `kind:'relic'`; the
// POC ring/amulet items are transitional relics (equipment.ts already collects
// them into the reliquary) until they're replaced. Narrows to ['relic'] later.
export const RELIC_KINDS: readonly ItemKind[] = ['relic', 'ring', 'amulet'];

/** The skeleton-key item — the chest currency. */
export const KEY_ID = 'skeleton-key';

/** One (or several) rolls through the loot roller, with the pool's constraints. */
export interface ItemRollSpec {
  /** Chance (0..1) each roll actually produces an item (default 1 = always). */
  chance?: number;
  /** How many independent rolls (default 1). */
  rolls?: number;
  /** Quality bias (0 basic · 2 mid · 4 boss-tier). */
  bias?: number;
  /** Floor the rolled rarity up to at least this — optionally by depth. */
  minRarity?: Rarity | ((depth: number) => Rarity);
  /** Restrict to these item kinds. Omit for any kind. */
  category?: readonly ItemKind[];
  /** Draw ONLY from items tagged `drop.pool === tag` (a UNIQUE pool). */
  tag?: string;
}

export interface DropTable {
  /** Gold granted as a min..max range (inclusive). */
  gold?: [number, number];
  /** Chance (0..1) to also drop a skeleton-key. */
  keyChance?: number;
  /** Item roll(s). */
  item?: ItemRollSpec;
  /** Item ids that ALWAYS drop (a boss's flask). */
  guaranteed?: string[];
  /** Gold granted when the item roll(s) come up empty — a chest must still pay. */
  emptyGold?: number;
}

/** The resolved bundle a source spawns: coins + floor items (keys/consumables/
 *  gear/relics all ride `items` as pickups). */
export interface DropResult {
  gold: number;
  items: ItemSpec[];
}

export const DROP_TABLES = {
  // ── The SMALL layer — currency + the odd consumable. Enemies + vases only. ──
  // Enemies are the primary trickle (gold most kills, a key now and then).
  'enemy':       { gold: [1, 3], keyChance: 0.08, item: { chance: 0.05, category: CONSUMABLE_KINDS } },
  // Elites/minibosses pay more and reliably cough a key.
  'enemy-elite': { gold: [3, 7], keyChance: 0.40, item: { chance: 0.30, category: CONSUMABLE_KINDS } },
  // Vases are rarer than enemies and MOSTLY gold — an occasional treat.
  'vase':        { gold: [1, 2], keyChance: 0.015, item: { chance: 0.03, category: CONSUMABLE_KINDS } },

  // ── CHESTS — wood free · silver/gold key-gated (the gate lives at the chest). ──
  'chest-wood':   { item: { bias: 0, category: [...GEAR_KINDS, ...CONSUMABLE_KINDS] }, keyChance: 0.15, emptyGold: 6 },
  'chest-silver': { item: { bias: 2, category: [...GEAR_KINDS, ...RELIC_KINDS] }, emptyGold: 12 },
  'chest-gold':   { item: { bias: 4, category: RELIC_KINDS, minRarity: (d) => (d >= 3 ? 'rare' : 'uncommon') }, emptyGold: 20 },

  // ── BOSSES — a guaranteed relic; the reward for the fight. ──
  'miniboss': { item: { bias: 3, category: RELIC_KINDS, minRarity: 'uncommon' }, emptyGold: 12 },
  'boss':     { item: { bias: 4, category: RELIC_KINDS, minRarity: 'rare' }, emptyGold: 25 },

  // ── EVENTS / DEALS — were scattered rollLoot/rollPool at each interactable. ──
  'defining-find': { item: { bias: 4, category: GEAR_KINDS, minRarity: (d) => (d >= 3 ? 'rare' : 'uncommon') } },
  'merchant':      { item: { bias: 2, category: GEAR_KINDS } },
  'reliquary':     { item: { bias: 4, category: RELIC_KINDS, minRarity: 'rare' } },
  'challenge':     { item: { bias: 4, category: GEAR_KINDS, minRarity: (d) => (d >= 3 ? 'rare' : 'uncommon') } },
  // A fallen delver's leftovers — a little of everything.
  'corpse':        { gold: [2, 6], item: { bias: 1 } },

  // ── TAGGED unique pools (draw only from items carrying the tag). ──
  'cursed': { item: { bias: 4, tag: 'cursed' } },
} satisfies Record<string, DropTable>;

export type DropTableId = keyof typeof DROP_TABLES;

/** Roll a NAMED drop table into a resolved bundle — the single entry point every
 *  source uses. Deterministic given `rand`. */
export function rollDropTable(id: DropTableId, depth: number, rand: () => number): DropResult {
  const t: DropTable = DROP_TABLES[id];
  const items: ItemSpec[] = [];

  // Guaranteed ids first.
  for (const gid of t.guaranteed ?? []) {
    const it = ITEMS[gid];
    if (it) items.push(it);
  }

  // Item roll(s).
  if (t.item) {
    const spec = t.item;
    const rolls = spec.rolls ?? 1;
    const minRarity = typeof spec.minRarity === 'function' ? spec.minRarity(depth) : spec.minRarity;
    for (let i = 0; i < rolls; i++) {
      if (spec.chance != null && rand() >= spec.chance) continue;
      const it = rollLoot(
        { depth, bias: spec.bias, minRarity, category: spec.category ? [...spec.category] : undefined, pool: spec.tag },
        rand,
      );
      if (it) items.push(it);
    }
  }

  // Gold — the range, plus the empty-roll consolation.
  let gold = 0;
  if (t.gold) {
    const [lo, hi] = t.gold;
    gold = lo + Math.floor(rand() * (hi - lo + 1));
  }
  if (items.length === 0 && t.emptyGold) gold += t.emptyGold;

  // A key, sometimes (rides `items` as a floor pickup).
  if (t.keyChance && rand() < t.keyChance) {
    const key = ITEMS[KEY_ID];
    if (key) items.push(key);
  }

  return { gold, items };
}
