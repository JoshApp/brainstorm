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

export type ChestTier = 'supply' | 'iron' | 'boss';

export function rollChestTier(depth: number, rand: () => number): ChestTier {
  // Cumulative weights by depth band. Boss-tier never exceeds ~12%
  // even very deep — it should stay a rare reward, not a regular.
  let supplyW = 0.75, ironW = 0.22, bossW = 0.03;
  if (depth >= 4 && depth <= 7) { supplyW = 0.55; ironW = 0.38; bossW = 0.07; }
  else if (depth >= 8)           { supplyW = 0.40; ironW = 0.48; bossW = 0.12; }
  const r = rand();
  if (r < supplyW) return 'supply';
  if (r < supplyW + ironW) return 'iron';
  return 'boss';
}

export function rollMimic(tier: ChestTier, rand: () => number): boolean {
  // Rarer chests are likelier to be mimics — they're the gamble. The
  // dungeon punishes greed in proportion to the reward you reached
  // for. Wood mimic is the surprise; boss mimic is the choice.
  const chance = tier === 'supply' ? 0.05 : tier === 'iron' ? 0.09 : 0.14;
  return rand() < chance;
}

// Chest tier → loot richness bias fed to the central roller. The tier IS
// the chest's promise: supply is humble, iron is gear, boss is a prize.
// Bias shifts the rarity curve up; depth still gates what's eligible, so a
// boss chest on floor 1 is generous-for-floor-1, not a free fabled.
const TIER_BIAS: Record<ChestTier, number> = { supply: 0, iron: 2, boss: 4 };

export function rollChestLoot(
  tier: ChestTier,
  rand: () => number,
  depth = 1,
): import('../content/items').ItemSpec {
  // Pull from the central distribution (content/loot.ts): the full eligible
  // item set at this depth, rarity-weighted by the tier bias. This is what
  // gives floor-1 chests real variety instead of the same three mundanes,
  // while keeping powerful/late items gated by depth + rarity.
  return rollLoot({ depth, bias: TIER_BIAS[tier] }, rand) ?? ITEMS['healing-potion'];
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
 * (e.g. force tier: 'iron' on a treasure-room chest) without rebuilding
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
