// ─────────────────────────────────────────────────────────────────────
// Decor procgen defaults — chest tier/loot/mimic + corpse note/yaw.
// ─────────────────────────────────────────────────────────────────────
//
// Both the legacy ASCII parser (tilemap.ts) and the new cellProps
// pipeline (vault-compose.ts) need to fill in defaults for sparse
// decor entries — a chest with no tier picks one weighted by depth,
// a corpse with no note picks from the rotating pool, etc.
//
// Same defaults from both code paths → identical behaviour whether a
// vault declares `{ kind: 'chest' }` in cellProps or has a `c` char
// in its ASCII map. Single source of truth for the procgen rolls.

import type { PropSpec } from './types';
import { ITEMS } from '../content/items';
import { rollLoot } from '../content/loot';

// Pool of corpse notes. applyProcgenDefaults picks one per corpse
// entry whose `note` is undefined — deterministic via the rng the
// caller threads through.
const CORPSE_NOTES = [
  'I came down to forget. The dungeon obliged.',
  'They told us it was one floor. They counted wrong.',
  'The water is not safe. Nothing here is.',
  'My name was almost a song once.',
  'If you find a blade that hums, leave it.',
];

// A bronze→silver→gold ladder, Isaac-style: a SMALL, glance-legible set
// where each tier has a distinct PROMISE (content + richness), not just a
// rarity number. Bronze restocks (consumables), silver is gear, gold is the
// prize. Few enough tiers that the player learns to read a chest across the
// room — which is where the anticipation lives. (A locked "warded" tier
// rides the key economy later.)
export type ChestTier = 'bronze' | 'silver' | 'gold';

export function rollChestTier(depth: number, rand: () => number): ChestTier {
  // Cumulative weights by depth band. Gold never exceeds ~12% even very
  // deep — it stays a rare reward, not a regular.
  let bronzeW = 0.75, silverW = 0.22, goldW = 0.03;
  if (depth >= 4 && depth <= 7) { bronzeW = 0.55; silverW = 0.38; goldW = 0.07; }
  else if (depth >= 8)           { bronzeW = 0.40; silverW = 0.48; goldW = 0.12; }
  const r = rand();
  if (r < bronzeW) return 'bronze';
  if (r < bronzeW + silverW) return 'silver';
  return 'gold';
}

export function rollMimic(tier: ChestTier, rand: () => number): boolean {
  // Rarer chests are likelier to be mimics — they're the gamble. The
  // dungeon punishes greed in proportion to the reward you reached
  // for. Bronze mimic is the surprise; gold mimic is the choice.
  const chance = tier === 'bronze' ? 0.05 : tier === 'silver' ? 0.09 : 0.14;
  return rand() < chance;
}

// Wearable/wieldable gear — everything a silver/gold chest (and the floor's
// defining find, see floor-fill.ts) pulls from.
export const GEAR_KINDS: ReadonlyArray<import('../content/items').ItemKind> =
  ['weapon', 'armor', 'helmet', 'amulet', 'gloves', 'boots', 'offhand', 'ring'];

// Each tier's promise, as DATA: what it pulls from (category), how rich
// (bias), and a rarity floor on gold so the prize is never a let-down.
// Bias shifts the rarity curve up; depth still gates what's eligible, so a
// gold chest on floor 1 is generous-for-floor-1, not a free fabled.
interface TierLoot {
  bias: number;
  category?: ReadonlyArray<import('../content/items').ItemKind>;
  /** Depth-scaled rarity floor (uncommon early, rare deeper). */
  floor?: (depth: number) => 'uncommon' | 'rare';
}
const TIER_LOOT: Record<ChestTier, TierLoot> = {
  // Bronze = the restock: consumables (+ the coin-cache fallback in chest.ts
  // when nothing rolls). This is what ISOLATES the potion flood — heals now
  // come from clearly-marked bronze chests, not from every chest.
  bronze: { bias: 0, category: ['consumable'] },
  // Silver = the loadout chest: gear, mid bias.
  silver: { bias: 2, category: GEAR_KINDS },
  // Gold = the prize: gear, high bias, with a FLOOR so it can't disappoint.
  gold:   { bias: 4, category: GEAR_KINDS, floor: (d) => (d >= 3 ? 'rare' : 'uncommon') },
};

export function rollChestLoot(
  tier: ChestTier,
  rand: () => number,
  depth = 1,
): import('../content/items').ItemSpec {
  // Pull from the central distribution (content/loot.ts), filtered to the
  // tier's content category and floored on gold. Depth still gates what's
  // eligible + drives the rarity curve, so chests keep real variety.
  const t = TIER_LOOT[tier];
  return rollLoot(
    { depth, bias: t.bias, category: t.category ? [...t.category] : undefined, minRarity: t.floor?.(depth) },
    rand,
  ) ?? ITEMS['flask-draught'];
}

/**
 * Fill in any missing procgen-default fields on a PropSpec. Currently:
 *   chest  — tier (depth-rolled), mimic (per-tier chance), loot
 *            (depth+tier-rolled, only if not mimic).
 *   corpse — note (pool pick), rotY (random).
 * Other prop kinds pass through unchanged.
 *
 * Caller-given fields are preserved — only undefined fields are filled.
 * Lets a vault author override the procgen roll on any single instance
 * (e.g. force tier: 'silver' on a treasure-room chest) without rebuilding
 * the whole prop.
 */
export function applyProcgenDefaults(
  prop: PropSpec,
  depth: number,
  rand: () => number,
): PropSpec {
  if (prop.kind === 'chest') {
    if (prop.tier === undefined && prop.mimic === undefined && prop.loot === undefined) {
      const tier = rollChestTier(depth, rand);
      const mimic = rollMimic(tier, rand);
      return {
        ...prop,
        tier,
        mimic,
        loot: mimic ? undefined : rollChestLoot(tier, rand, depth),
      };
    }
    return prop;
  }
  if (prop.kind === 'corpse' && (!prop.note || prop.rotY === undefined)) {
    return {
      ...prop,
      note: prop.note ?? CORPSE_NOTES[Math.floor(rand() * CORPSE_NOTES.length)],
      rotY: prop.rotY ?? rand() * Math.PI * 2,
    };
  }
  return prop;
}
