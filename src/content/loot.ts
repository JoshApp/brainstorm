// Central loot distribution — one place to decide WHAT drops, HOW RARE it
// is, and WHERE in the descent it can appear. Every loot source (chests,
// vases, enemy kills) can roll through here instead of hand-maintaining its
// own pool, so distributing loot across acts / floors / monsters is a data
// edit (item `drop` metadata + a source `bias`), not new code.
//
// The model, in two independent rolls:
//
//   1. RARITY by depth + bias — the scarcity engine. Floor 1 is almost all
//      bone-and-rust; depth and a source bias (a boss chest, a deep kill)
//      shift the curve upward. Tuning the dungeon's "generosity" is this
//      one function. Scarcity is what makes the rare glow land.
//
//   2. ITEM of that rarity — picked by weight from everything eligible at
//      this depth (rarity match + drop.minDepth gate + not drop.noDrop).
//      If a rolled rarity has nothing eligible yet (e.g. fabled on floor
//      1), it steps DOWN a tier until something fits, so a roll always
//      yields an item.
//
// Add a new item → tag its rarity + drop.minDepth and it flows into the
// right floors automatically. No pool editing.

import { ITEMS, RARITY_ORDER, type ItemSpec, type Rarity, type ItemKind } from './items';
import { isIncluded } from './content-status';

// ── Rarity curve ────────────────────────────────────────────────────────
// Weight per rarity as a function of a "quality" scalar q (higher = richer
// loot). q rises with depth and the source bias. Mundane stays present (a
// floor so q never zeroes it) so commons remain the texture; the higher
// tiers ramp in slowly so they always read as an event.
function rarityWeights(q: number): Record<Rarity, number> {
  return {
    mundane:  Math.max(8, 62 - q * 3.5),
    uncommon: 22 + q * 0.8,
    rare:     Math.max(0, q * 1.10 - 2),  // chests/depth start surfacing these
    cursed:   Math.max(0, q * 0.55 - 4),  // the risk/reward spice — rarer
    fabled:   Math.max(0, q * 0.60 - 6),  // top tier — a deep-floor event
  };
}

/**
 * Roll a rarity for a drop. `bias` shifts the whole curve up: 0 for a
 * basic drop (vase, common kill), ~2 for a mid chest / elite, ~4 for a
 * boss chest / boss kill. Deterministic given `rand`.
 */
export function rollRarity(depth: number, bias: number, rand: () => number): Rarity {
  const q = Math.max(0, depth + bias * 2 - 1);
  const w = rarityWeights(q);
  let total = 0;
  for (const r of RARITY_ORDER) total += w[r];
  let roll = rand() * total;
  for (const r of RARITY_ORDER) {
    roll -= w[r];
    if (roll < 0) return r;
  }
  return 'mundane';
}

// ── Eligibility index ───────────────────────────────────────────────────
// Built once from ITEMS, grouped by rarity. Each entry carries its minDepth
// gate + weight + kind so the item roll is a cheap filtered weighted pick
// (kind powers the per-source category filter — a supply chest pulls only
// consumables, a strongbox only gear).
interface LootEntry { id: string; minDepth: number; weight: number; kind: ItemKind; pool?: string }
type LootIndex = Record<Rarity, LootEntry[]>;

let indexCache: LootIndex | null = null;

function buildIndex(): LootIndex {
  const idx: LootIndex = { mundane: [], uncommon: [], rare: [], cursed: [], fabled: [] };
  for (const id in ITEMS) {
    const item = ITEMS[id];
    if (item.drop?.noDrop) continue;              // hand-distributed only
    if (!isIncluded(item)) continue;              // dev/draft content, excluded from this build
    const rarity = item.rarity ?? 'mundane';
    idx[rarity].push({
      id,
      minDepth: item.drop?.minDepth ?? 1,
      weight: item.drop?.weight ?? 1,
      kind: item.kind,
      pool: item.drop?.pool,
    });
  }
  return idx;
}

function lootIndex(): LootIndex {
  return (indexCache ??= buildIndex());
}

/** Test/hot-reload hook — drop the cached index so edits to ITEMS re-index. */
export function resetLootIndex(): void {
  indexCache = null;
}

function pickFromBand(
  band: LootEntry[],
  depth: number,
  rand: () => number,
  allow: Set<ItemKind> | null = null,
  pool: string | null = null,
): ItemSpec | null {
  const ok = (e: LootEntry) =>
    e.minDepth <= depth
    && (!allow || allow.has(e.kind))
    // General roll (pool null) → only un-pooled items. Pool roll → only that pool.
    && (pool === null ? e.pool === undefined : e.pool === pool);
  let total = 0;
  for (const e of band) if (ok(e)) total += e.weight;
  if (total <= 0) return null;
  let roll = rand() * total;
  for (const e of band) {
    if (!ok(e)) continue;
    roll -= e.weight;
    if (roll < 0) return ITEMS[e.id];
  }
  return null;
}

export interface LootContext {
  /** Current floor depth (1+). Gates items + drives the rarity curve. */
  depth: number;
  /** Source richness: 0 basic, ~2 mid chest/elite, ~4 boss chest/kill. */
  bias?: number;
  /**
   * Rarity FLOOR — the rolled tier is clamped UP to at least this. For a
   * reward the player PAID for (a trial they fought, a boss they felled): a
   * generous `bias` still lets the curve land on bone-and-rust ~half the time,
   * which feels like a betrayal of the deal. A floor guarantees the reward
   * respects the cost — "floor of solid, chance of great", never trash.
   * Omit for an organic drop (chest/vase/kill) where mundane is fine texture.
   */
  minRarity?: Rarity;
  /**
   * Content filter — restrict the roll to these item KINDS. This is what
   * gives a chest tier its IDENTITY: a supply chest pulls only `consumable`,
   * a strongbox only gear. If the filter excludes everything eligible, it's
   * RELAXED rather than yielding nothing (a chest must still cough up
   * something). Omit for an unrestricted roll.
   */
  category?: ItemKind[];
  /**
   * Draw ONLY from items whose `drop.pool` equals this — a UNIQUE pool (boss
   * signature drops, cursed relics). Omitted → the roll draws from GENERAL
   * items (those with no pool), so a pooled item never leaks into a generic
   * chest/vase/kill drop. Set by the pool registry (drop-tables.ts), not by
   * hand at call sites.
   */
  pool?: string;
}

/** Scan the rarity bands for an eligible item: down from `start` to the
 *  floor, then up past it, then below it as a last resort. `allow` filters
 *  by kind. Returns null only if nothing matches anywhere. */
function scanBands(
  idx: LootIndex, depth: number, rand: () => number,
  start: number, floorIdx: number, allow: Set<ItemKind> | null,
  pool: string | null = null,
): ItemSpec | null {
  for (let i = start; i >= floorIdx; i--) {
    const item = pickFromBand(idx[RARITY_ORDER[i]], depth, rand, allow, pool);
    if (item) return item;
  }
  for (let i = start + 1; i < RARITY_ORDER.length; i++) {
    const item = pickFromBand(idx[RARITY_ORDER[i]], depth, rand, allow, pool);
    if (item) return item;
  }
  for (let i = floorIdx - 1; i >= 0; i--) {
    const item = pickFromBand(idx[RARITY_ORDER[i]], depth, rand, allow, pool);
    if (item) return item;
  }
  return null;
}

/**
 * Roll one item from the central distribution. Picks a rarity (depth +
 * bias), clamps it up to any `minRarity` floor, then an eligible item of
 * that rarity by weight (filtered by `category`); steps to adjacent tiers
 * if the rolled one has nothing available. Returns null only if NOTHING is
 * eligible at all (shouldn't happen — mundane always has entries).
 * Deterministic given `rand`.
 */
export function rollLoot(ctx: LootContext, rand: () => number): ItemSpec | null {
  const depth = ctx.depth;
  const idx = lootIndex();
  const rolled = rollRarity(depth, ctx.bias ?? 0, rand);
  // A rarity FLOOR clamps the rolled tier up (a paid-for reward never drops to
  // bone-and-rust). The scan then bottoms out AT the floor, not at mundane.
  const floorIdx = ctx.minRarity ? RARITY_ORDER.indexOf(ctx.minRarity) : 0;
  const start = Math.max(RARITY_ORDER.indexOf(rolled), floorIdx);
  const allow = ctx.category && ctx.category.length ? new Set(ctx.category) : null;
  const pool = ctx.pool ?? null;

  const found = scanBands(idx, depth, rand, start, floorIdx, allow, pool);
  if (found) return found;
  // The category may have excluded everything eligible at this depth — relax
  // it rather than return null (a chest must still yield SOMETHING). The POOL
  // is NOT relaxed: a boss pool must never fall back to a general item.
  if (allow) {
    const any = scanBands(idx, depth, rand, start, floorIdx, null, pool);
    if (any) return any;
  }
  return null;
}

/**
 * Roll one CURSED item eligible at this depth, by weight. The supply for
 * blood altars and shrouded relics — the risk/reward gamble pool. Falls
 * back to a shallower cursed item, then null if the cursed band is empty
 * at this depth (deterministic given `rand`).
 */
export function rollCursedItem(depth: number, rand: () => number): ItemSpec | null {
  // The cursed pool is the DEDICATED gamble (blood altars, shrouded relics) —
  // variety is the point, and most cursed relics gate to depth 3-4, so a shallow
  // altar would otherwise only ever offer the same one or two curses ("it
  // always gives the same relic"). Soften the gate by a LOOKAHEAD so several
  // cursed items are in play early — you can pull a deeper curse sooner, the
  // risk/reward fantasy (you paid blood for it). Weight still applies, so the
  // deepest stay rarer.
  const CURSED_LOOKAHEAD = 2;
  const band = lootIndex().cursed.map((e) => ({ ...e, minDepth: Math.max(1, e.minDepth - CURSED_LOOKAHEAD) }));
  return pickFromBand(band, depth, rand);
}
