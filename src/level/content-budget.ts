// The per-floor CONTENT BUDGET — what a floor OWES the player, decided up front.
//
// The old model made content an ACCIDENT: a floor's enemies were whatever fell out
// of (which vaults got picked) × (how many `X` slots they happened to have) × (a
// per-slot density coin-flip). At shallow depth that could roll ZERO — the
// empty-first-floors bug. This file exists so the floor gets to STATE what it owes
// instead of discovering it afterwards.
//
// ── COMBAT USED TO BE STATED HERE AND IS NOT ANY MORE ────────────────────────
//
// It was: a `combat: { count, intensity }` pair, count = COMBAT_BASE + depth ×
// PER_DEPTH clamped to [MIN, MAX]. It was computed on every floor and READ BY
// NOBODY, while the real density came from a per-room `area / 40` rule and the
// minimum was audited on the finished floor and repaired. Three owners of one
// number, two of them decorative.
//
// The tie-break was written next to the constants themselves: *"The budget is
// per-FLOOR, so it has to track floor size, not just depth."* A depth-only formula
// gives a cramped floor and a sprawling one the same pack, which is the complaint
// that comment was making. So combat is now allocated in poly-floor.ts by
// `allocateCombat` — it sums what the rooms are shaped to hold, which tracks size
// by construction, clamps that into [COMBAT_MIN, COMBAT_MAX], and hands out shares.
// COMBAT_MIN holds by arithmetic and nothing comes back to check it.
//
// This file keeps what it actually decides: the floor's LOOT and EVENTS.
//
// Pure + deterministic: pass a seeded `rand` and the same (depth, seed) always
// yields the same budget — required for replay + headless balance sweeps. All
// tuning lives in CONFIG.CONTENT_BUDGET so the design layer can re-curve it
// without touching this logic.

import { CONFIG } from '../config';
import type { Rarity } from '../content/items';

export interface FloorContentBudget {
  loot: {
    /** Whether this floor stages ONE DEFINING FIND — a reward rolled with a
     *  rarity floor and placed on a focal marker (the dais), not sprayed. It
     *  only actually lands if the floor offers an eligible focal `spot` marker
     *  in a loot-permitting room; otherwise it silently no-ops (scarcity by
     *  marker count). Distinct from chest/vase loot, which is furnishing. */
    definingFind: boolean;
    /** The rarity floor for that find — the roll is clamped UP to at least
     *  this, so a defining find always reads as a REWARD, not bone-and-rust. */
    minRarity: Rarity;
  };
  events: {
    /** Whether this floor rolled a minor bonfire — a FOUND rest/card-draw fire
     *  placed deeper in the floor, NOT a guaranteed one at the entrance. The
     *  harbor/post-boss fire is separate (always present, authored by the safe
     *  room). When false the player wakes + descends with no fire that floor. */
    minorFire: boolean;
    /** Whether this floor stages ONE QUESTION — a deal (fountain/tithe shallow,
     *  blood-altar/altar deep) placed on a focal marker in an event-permitting
     *  room. Like the defining find, it only lands if the floor offers a spare
     *  eligible marker; otherwise it no-ops and the `?`-slot RNG still provides
     *  deals. A staged deal takes precedence over random ones at the floor cap. */
    question: boolean;
  };
}

/** Roll this floor's events. Currently just the minor bonfire: a FOUND fire is
 *  the design (not one-per-entrance), so it's a depth-weighted chance, not a
 *  guarantee. Always consumes exactly one rand() for stream stability. */
export function floorEvents(depth: number, rand: () => number): FloorContentBudget['events'] {
  void depth;   // reserved for depth-weighting the fire chance later
  const b = CONFIG.CONTENT_BUDGET;
  // Two independent rolls, fixed order (fire then question) for stream stability.
  const minorFire = rand() < b.MINOR_FIRE_CHANCE;
  const question = rand() < b.QUESTION_CHANCE;
  return { minorFire, question };
}

/** Roll this floor's loot line — currently the single DEFINING FIND. Whether it
 *  appears is a depth-gated chance; its rarity floor climbs with depth so deep
 *  finds read as bigger rewards. Always consumes exactly one rand() for stream
 *  stability (the chance), and picks minRarity deterministically from depth. */
export function floorLoot(depth: number, rand: () => number): FloorContentBudget['loot'] {
  const b = CONFIG.CONTENT_BUDGET;
  const definingFind = rand() < b.DEFINING_FIND_CHANCE;
  const minRarity: Rarity = depth >= b.DEFINING_FIND_RARE_DEPTH ? 'rare' : 'uncommon';
  return { definingFind, minRarity };
}

/** The full per-floor budget. `rand` should be a seeded stream derived from the
 *  floor seed so the budget reproduces on replay. */
export function floorContentBudget(depth: number, rand: () => number): FloorContentBudget {
  return {
    loot: floorLoot(depth, rand),
    events: floorEvents(depth, rand),
  };
}
