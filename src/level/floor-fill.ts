// The FILL stage — resolve dumb content markers into concrete DEFINING content
// (docs/FLOOR-DIRECTOR.md, step 2). A marker says only WHERE (+ focal/facing);
// the room's ROLE says the category it may hold; the BUDGET says how much / how
// rare; this module COMBINES them. Pure + deterministic: same (spots, budget,
// depth, seed) → same placement, so floors replay and headless sweeps reproduce.
//
// This is L4D's model: the vault hand-places candidate spots, the director picks
// which one actually gets the reward this run — "staged but varied".

import type { FloorRoles } from './floor-roles';
import { rollLoot } from '../content/loot';
import { GEAR_KINDS } from './decor-defaults';
import type { ItemSpec, Rarity } from '../content/items';

/** A harvested content marker in world space, ready for the fill to resolve. */
export interface ContentSpot {
  x: number;
  z: number;
  roomId: string;
  /** The room's built-around hero spot (a dais) vs an ordinary spot. */
  focal: boolean;
  /** Yaw the content should face (radians), if the marker declared one. */
  facing?: number;
}

/** A resolved defining find — a staged reward the composer emits as a chest. */
export interface DefiningFind {
  x: number;
  z: number;
  roomId: string;
  facing?: number;
  loot: ItemSpec;
}

/**
 * Stage the floor's ONE defining find, if the budget grants one AND the floor
 * offers an eligible marker. Eligible = a `spot` in a room whose role permits
 * loot; FOCAL spots are strongly preferred (the reward lands on the dais, not a
 * corner). Returns null when there's no budget or no eligible spot — the find
 * simply doesn't appear (scarcity by marker count, never a forced drop into a
 * random cell).
 *
 * Consumes rand() deterministically: one draw to pick the spot (only when there
 * are ties to break), then the loot roll.
 */
export function fillDefiningFind(
  spots: readonly ContentSpot[],
  roles: FloorRoles,
  budget: { definingFind: boolean; minRarity: Rarity },
  depth: number,
  rand: () => number,
): DefiningFind | null {
  if (!budget.definingFind) return null;

  const eligible = spots.filter((s) => roles.caps(s.roomId).allowLoot);
  if (eligible.length === 0) return null;

  // Prefer focal spots; fall back to ordinary ones only if the floor has no
  // focal marker in a loot room.
  const focal = eligible.filter((s) => s.focal);
  const pool = focal.length > 0 ? focal : eligible;
  const spot = pool.length === 1 ? pool[0] : pool[Math.floor(rand() * pool.length)];

  // bias 4 = the boss/vault-cache tier of the curve; minRarity floors it so the
  // find always reads as a reward; GEAR_KINDS keeps it a build-relevant PRIZE (a
  // potion is not a defining find). A null roll (empty band) means no find.
  const loot = rollLoot({ depth, bias: 4, minRarity: budget.minRarity, category: [...GEAR_KINDS] }, rand);
  if (!loot) return null;

  return { x: spot.x, z: spot.z, roomId: spot.roomId, facing: spot.facing, loot };
}
