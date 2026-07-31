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
import { rollDropTable, type DropResult, type DropTableId } from '../content/drop-tables';

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
export type ChestTier = 'wood' | 'silver' | 'gold';

export function rollChestTier(depth: number, rand: () => number): ChestTier {
  // Cumulative weights by depth band. Gold never exceeds ~12% even very deep —
  // it stays a rare reward, not a regular. The LOCKED tiers (silver + gold, per
  // chest.ts) ramp UP with depth, so the first floor is almost all openable —
  // you shouldn't meet a chest you can't open before you've had a real chance at
  // a key (wood chests + kills seed keys). Depth 1 is deliberately wood-heavy.
  let woodW = 0.75, silverW = 0.22, goldW = 0.03;
  if (depth <= 1)                { woodW = 0.90; silverW = 0.10; goldW = 0.00; }   // floor 1: openable
  else if (depth <= 3)           { woodW = 0.74; silverW = 0.23; goldW = 0.03; }
  else if (depth >= 4 && depth <= 7) { woodW = 0.55; silverW = 0.38; goldW = 0.07; }
  else if (depth >= 8)           { woodW = 0.40; silverW = 0.48; goldW = 0.12; }
  const r = rand();
  if (r < woodW) return 'wood';
  if (r < woodW + silverW) return 'silver';
  return 'gold';
}

export function rollMimic(tier: ChestTier, rand: () => number): boolean {
  // Rarer chests are likelier to be mimics — they're the gamble. The
  // dungeon punishes greed in proportion to the reward you reached
  // for. Bronze mimic is the surprise; gold mimic is the choice.
  const chance = tier === 'wood' ? 0.05 : tier === 'silver' ? 0.09 : 0.14;
  return rand() < chance;
}

export function rollChestLoot(
  tier: ChestTier,
  rand: () => number,
  depth = 1,
): DropResult {
  // Chest tiers are named DROP TABLES now (content/drop-tables.ts) — wood = the
  // free common restock, silver = gear + a relic chance, gold = a relic. The
  // table owns bias / category / rarity floor / emptyGold; this just names it.
  return rollDropTable(`chest-${tier}` as DropTableId, depth, rand);
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
