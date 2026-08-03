// DROP TABLES — the whole loot economy authored as DATA (docs/BUILD-ECONOMY.md).
// One config file, authored like items.ts; the executor below never changes. The
// model is nested weighted loot tables (à la Minecraft / Diablo TreasureClasses):
//
//   GROUPS  — named item SETS, by query (kinds/tags/rarity — self-maintaining, so a
//             new item that matches auto-joins) or an explicit id list.
//   TABLES  — a list of POOLS; each pool rolls independently (so "always gold AND
//             sometimes a key" is two pools), and within a pool the ENTRIES are
//             weighted (pick one). An entry drops: gold · a key · an item `from` a
//             group · a nested `table` · or nothing (a bare weight).
//   SOURCES — an enemy / vase / chest tier names a table; the table says what.
//
// To add loot you edit DATA here — never a function. rollDropTable resolves a
// table into a { gold, items } bundle the caller spawns.

import { rollLoot } from './loot';
import { ITEMS } from './items';
import { isIncluded } from './content-status';
import type { ItemSpec, ItemKind, Rarity } from './items';

// The three gear SLOTS. Relics are their own pool, so gear pools never leak one.
export const GEAR_KINDS: readonly ItemKind[] = ['weapon', 'offhand', 'vestment'];
export const CONSUMABLE_KINDS: readonly ItemKind[] = ['consumable'];
// Relics — the reliquary's uncapped collectibles.
export const RELIC_KINDS: readonly ItemKind[] = ['relic'];

/** The skeleton-key item — the chest currency. */
export const KEY_ID = 'skeleton-key';

// ── GROUPS — named item sets ────────────────────────────────────────────────
/** A group is a QUERY (kinds/tag → the loot roller filters to it, so it stays
 *  current as items are added) OR an explicit `items` list. `bias` nudges the
 *  quality of what the query rolls. */
export interface ItemGroup {
  kinds?: readonly ItemKind[];
  /** drop.pool tag — draw ONLY from items tagged this (boss/cursed signatures). */
  tag?: string;
  /** Explicit ids — overrides the query with a hand-picked set. */
  items?: readonly string[];
  bias?: number;
}

export const GROUPS: Record<string, ItemGroup> = {
  consumables: { kinds: CONSUMABLE_KINDS },
  // WEAPONS + VESTMENTS NO LONGER DROP. The direction is one evolving weapon (you
  // start with it, it grows — never a floor-drop to swap), and vestments are cut.
  // So the 'gear' group now yields TRINKETS: every "gear" drop in the tables below
  // becomes a build-piece (relic), which is the loot economy for now. GEAR_KINDS
  // is kept only as a reference for the (dormant) equip infra.
  gear:        { kinds: RELIC_KINDS },
  relics:      { kinds: RELIC_KINDS },
  'boss-loot': { tag: 'boss', bias: 4 },
  cursed:      { tag: 'cursed', bias: 4 },
};

// ── ENTRIES / POOLS / TABLES ────────────────────────────────────────────────
// A rarity FLOOR clamps a rolled tier UP to at least this. It can be a fixed
// tier, or a function of depth (+ the roll rand, for a SOFT floor).
type RarityFloor = Rarity | ((depth: number, rand: () => number) => Rarity);

/** SOFT rarity floor (docs: loot-design "hybrid curve"). Instead of snapping the
 *  "at least rare" guarantee on at one depth — which stacks every source into a
 *  visible CLIFF (the audit's D3 jump) — this RAMPS it in across a band: below
 *  `start` the floor is `low`; from `start`→`full` the chance of the `high` floor
 *  climbs linearly 0→1; at/after `full` it's a hard `high` floor. The transition
 *  becomes a felt CLIMB, not a wall. Consumes one rand — deterministic per seed. */
function rampFloor(start: number, full: number, low: Rarity = 'uncommon', high: Rarity = 'rare') {
  return (depth: number, rand: () => number): Rarity => {
    if (depth >= full) return high;
    if (depth < start) return low;
    return rand() < (depth - start) / (full - start) ? high : low;
  };
}

/** One weighted possibility inside a pool. Exactly one of gold/key/from/table may
 *  be set; a bare `{ weight }` is "nothing" (the miss chance). */
export interface LootEntry {
  /** Relative weight within its pool (default 1). */
  weight?: number;
  /** Grant gold in this range. */
  gold?: [number, number];
  /** Grant this many skeleton-keys. */
  key?: number;
  /** Roll an item from a GROUP (rarity-by-depth, floored by minRarity). */
  from?: string;
  minRarity?: RarityFloor;
  minDepth?: number;
  bias?: number;
  /** Recurse into another table (composition). */
  table?: string;
}

export interface LootPool {
  /** How many independent rolls of this pool (default 1). */
  rolls?: number;
  entries: LootEntry[];
}

export interface LootTable {
  pools: LootPool[];
  /** Gold granted when the whole table produced no ITEM (a chest must still pay). */
  emptyGold?: number;
}

// A convenience: a single-pool table can be written `{ entries: [...] }`.
type TableDef = LootTable | { entries: LootEntry[]; emptyGold?: number };

const T = (d: TableDef): LootTable =>
  'pools' in d ? d : { pools: [{ entries: d.entries }], emptyGold: d.emptyGold };

export const TABLES: Record<string, LootTable> = {
  // ── The SMALL layer — enemies + vases. Gold ALWAYS (its own pool), key + the
  //    odd consumable as separate chance pools. ──
  // KEYS ARE CUT — no key pools anywhere. Chests open freely now.
  'enemy': {
    pools: [
      { entries: [{ gold: [1, 3] }] },
      { entries: [{ from: 'consumables', weight: 5 }, { weight: 95 }] },
    ],
  },
  'enemy-elite': {
    pools: [
      { entries: [{ gold: [3, 7] }] },
      { entries: [{ from: 'consumables', weight: 30 }, { weight: 70 }] },
    ],
  },
  // Vases: rarer + mostly gold (the destructible gates most vases to empty already).
  'vase': {
    pools: [
      { entries: [{ gold: [1, 2] }] },
      { entries: [{ from: 'consumables', weight: 3 }, { weight: 97 }] },
    ],
  },

  // ── CHESTS — wood free/common, silver gear+relic, gold a guaranteed relic. ──
  // Gear is deliberately NOT the default anymore: with ground-equip every found
  // weapon/vestment is a considered swap, not bag fodder, so a chest raining gear
  // every floor became a stream of compare-prompts. The share now leans to
  // consumables + keys + relics (the build, no compare), and every chest gear roll
  // is floored uncommon→rare (rampFloor(1,6)) — the mundane trash tier never drops
  // from a chest, and quality climbs as you descend.
  'chest-wood':   T({ emptyGold: 6, entries: [
    { from: 'gear', bias: 0, weight: 40, minRarity: rampFloor(1, 6) },
    { from: 'consumables', weight: 44 }, { weight: 16 },
  ] }),
  'chest-silver': T({ emptyGold: 12, entries: [
    { from: 'gear', bias: 2, weight: 48, minRarity: rampFloor(1, 6) },
    { from: 'relics', bias: 2, weight: 52 },
  ] }),
  // Gold chest's rare floor ramps in d2→d6 (was a hard snap at d3) so the
  // uncommon→rare transition reads as a climb, not a cliff.
  'chest-gold':   T({ emptyGold: 20, entries: [
    { from: 'relics', bias: 4, minRarity: rampFloor(2, 6) },
  ] }),

  // ── EARLY SPARK — the first-descent gift (loot-director, floors 1-2). ──
  // Research: an early "free notable" is the strongest first-session retention
  // lever (the Hooked model's first satisfying payoff / variable-reward onboarding).
  // A guaranteed uncommon+ RELIC = your first build piece, so floor 1 isn't a
  // reward-dead intro. Deliberately a relic (a build seed), not raw power.
  'spark': T({ emptyGold: 8, entries: [{ from: 'relics', bias: 2, minRarity: 'uncommon' }] }),

  // ── BOSSES — a relic reward. ──
  'miniboss': T({ emptyGold: 12, entries: [{ from: 'relics', bias: 3, minRarity: 'uncommon' }] }),
  'boss':     T({ emptyGold: 25, entries: [{ from: 'relics', bias: 4, minRarity: 'rare' }] }),

  // ── EVENTS / DEALS — single-item sources. ──
  'defining-find': T({ entries: [{ from: 'gear', bias: 4, minRarity: rampFloor(2, 7) }] }),
  'merchant':      T({ entries: [{ from: 'gear', bias: 2, minRarity: rampFloor(1, 6) }] }),
  'reliquary':     T({ entries: [{ from: 'relics', bias: 4, minRarity: 'rare' }] }),
  'challenge':     T({ entries: [{ from: 'gear', bias: 4, minRarity: rampFloor(2, 7) }] }),
  // A fallen delver is now a RARE find (loot-director drops the per-floor odds),
  // so what they died holding is a real reward, not a scrap: a fair purse AND a
  // biased uncommon-or-better piece — gear usually, a relic often enough to be a
  // score — with the rarity floor climbing as you descend (the "later, much
  // better loot" ask). They carried their whole delve to their death; you take it.
  'corpse':        T({ pools: [
    { entries: [{ gold: [5, 12] }] },
    { entries: [
      { from: 'gear',   bias: 3, weight: 62, minRarity: rampFloor(3, 8) },
      { from: 'relics', bias: 3, weight: 38, minRarity: rampFloor(4, 9) },
    ] },
  ] } as LootTable),
  // A bone-shrine set-piece you SEARCH — a little gold, and a fair chance of gear
  // or a relic among the dead's leavings.
  'ossuary':       T({ pools: [
    { entries: [{ gold: [3, 8] }] },
    { entries: [{ from: 'gear', bias: 1, weight: 32, minRarity: rampFloor(1, 6) }, { from: 'relics', bias: 1, weight: 18 }, { weight: 50 }] },
  ] } as LootTable),
  'cursed':        T({ entries: [{ from: 'cursed', bias: 4 }] }),
  // CRITTER — ambient life (maggots) that drops NOTHING. A squished grub is
  // atmosphere, not loot; a single no-op entry + zero empty-gold guarantees it.
  'critter':       { pools: [{ entries: [{ weight: 1 }] }], emptyGold: 0 } as LootTable,
};

export type DropTableId = keyof typeof TABLES;

// Chest-tier frequency lives in ONE place now — level/decor-defaults.ts
// rollChestTier (the canonical roll used by both the prop-default path and the
// loot-director). The divergent duplicate that used to live here is removed.

// ── THE EXECUTOR — resolve a table into a bundle. Never edited to add loot. ──
export interface DropResult {
  gold: number;
  items: ItemSpec[];
}

/** Roll one item from a GROUP query (or its explicit list), honouring the entry's
 *  rarity floor + bias. Depth drives the rarity curve inside rollLoot. */
function rollGroup(entry: LootEntry, depth: number, rand: () => number): ItemSpec | null {
  const g = GROUPS[entry.from!];
  if (!g) return null;
  if (g.items && g.items.length) {
    // Include-flag: an explicitly-listed dev/draft item is excluded from this build.
    const pool = g.items.map((id) => ITEMS[id]).filter((it): it is ItemSpec => !!it && isIncluded(it));
    return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
  }
  const minRarity = typeof entry.minRarity === 'function' ? entry.minRarity(depth, rand) : entry.minRarity;
  return rollLoot(
    { depth, bias: entry.bias ?? g.bias, minRarity, category: g.kinds ? [...g.kinds] : undefined, pool: g.tag },
    rand,
  );
}

/** Pick one weighted entry from a pool. */
function pickEntry(entries: LootEntry[], rand: () => number): LootEntry {
  const total = entries.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = rand() * total;
  for (const e of entries) { r -= (e.weight ?? 1); if (r <= 0) return e; }
  return entries[entries.length - 1];
}

/** Resolve a table into `out`, recursively. `seen` guards nested-table cycles. */
function resolveTable(id: string, depth: number, rand: () => number, out: DropResult, seen: Set<string>): void {
  const t = TABLES[id];
  if (!t || seen.has(id)) return;
  seen.add(id);
  for (const pool of t.pools) {
    for (let i = 0; i < (pool.rolls ?? 1); i++) {
      const e = pickEntry(pool.entries, rand);
      if (e.gold) { const [lo, hi] = e.gold; out.gold += lo + Math.floor(rand() * (hi - lo + 1)); }
      else if (e.key) { const k = ITEMS[KEY_ID]; for (let n = 0; n < e.key; n++) if (k) out.items.push(k); }
      else if (e.from && (e.minDepth === undefined || depth >= e.minDepth)) {
        const it = rollGroup(e, depth, rand); if (it) out.items.push(it);
      } else if (e.table) { resolveTable(e.table, depth, rand, out, seen); }
      // a bare { weight } entry = nothing
    }
  }
  seen.delete(id);
}

/** Roll a NAMED table into a resolved { gold, items } bundle — the entry point
 *  every source uses. Deterministic given `rand`. */
export function rollDropTable(id: DropTableId, depth: number, rand: () => number): DropResult {
  const out: DropResult = { gold: 0, items: [] };
  resolveTable(id, depth, rand, out, new Set());
  // A source with emptyGold that produced no ITEM still pays out (a chest never gapes).
  if (out.items.length === 0) {
    const t = TABLES[id];
    if (t?.emptyGold) out.gold += t.emptyGold;
  }
  return out;
}

/** Convenience for SINGLE-ITEM sources (a merchant ware, an event prize): the
 *  first non-key item, or null. Drop-in for the old rollPool. */
export function rollDropItem(id: DropTableId, depth: number, rand: () => number): ItemSpec | null {
  return rollDropTable(id, depth, rand).items.find((it) => it.kind !== 'key') ?? null;
}
