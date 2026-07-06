// The per-floor CONTENT BUDGET — the "new brain" of procgen v3.
//
// The old model made combat an ACCIDENT: a floor's enemies were whatever fell
// out of (which vaults got picked) × (how many `X` slots they happened to have)
// × (a per-slot density coin-flip). At shallow depth that could roll ZERO — the
// empty-first-floors bug. There was never a floor-level statement of "this floor
// should contain THIS much combat."
//
// v3 inverts it: the budget DECIDES the floor's content up front (a depth-driven
// combat count with a HARD minimum, plus intensity), and a later pass
// distributes that budget into open cells across ALL rooms (see
// enumerateOpenCells + the spawn-injection pass). Combat stops being a property
// of "combat"-tagged rooms and becomes a property of the floor.
//
// Pure + deterministic: pass a seeded `rand` and the same (depth, seed) always
// yields the same budget — required for replay + headless balance sweeps. All
// tuning lives in CONFIG.CONTENT_BUDGET so the design layer can re-curve combat
// without touching this logic.

import { CONFIG } from '../config';
import type { EncounterIntensity } from '../content/encounters';
import type { Rarity } from '../content/items';

export interface FloorContentBudget {
  combat: {
    /** How many enemies this floor should contain, FLOOR-TOTAL (distributed
     *  across rooms downstream). Always >= COMBAT_MIN — never zero. */
    count: number;
    /** Pack intensity for the floor ('heavy' upgrades a slot to an elite). */
    intensity: EncounterIntensity;
  };
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

/** Resolve the combat enemy count for a floor: depth-scaled with a ± jitter,
 *  clamped to [MIN, MAX]. The MIN clamp is the load-bearing guarantee that no
 *  floor is ever empty. */
export function combatCount(depth: number, rand: () => number): number {
  const b = CONFIG.CONTENT_BUDGET;
  const jitter = b.COMBAT_JITTER > 0
    ? Math.round((rand() * 2 - 1) * b.COMBAT_JITTER)
    : 0;
  const raw = Math.round(b.COMBAT_BASE + (depth - 1) * b.COMBAT_PER_DEPTH) + jitter;
  return Math.max(b.COMBAT_MIN, Math.min(b.COMBAT_MAX, raw));
}

/** Resolve the floor's pack intensity by depth band. Always consumes exactly
 *  one rand() so the stream position is independent of the depth branch (keeps
 *  downstream rolls reproducible). */
export function combatIntensity(depth: number, rand: () => number): EncounterIntensity {
  const b = CONFIG.CONTENT_BUDGET;
  const roll = rand();
  if (depth < b.INTENSITY_MEDIUM_DEPTH) return 'light';
  if (depth < b.INTENSITY_HEAVY_DEPTH) return 'medium';
  return roll < b.HEAVY_CHANCE ? 'heavy' : 'medium';
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
    combat: {
      count: combatCount(depth, rand),
      intensity: combatIntensity(depth, rand),
    },
    loot: floorLoot(depth, rand),
    events: floorEvents(depth, rand),
  };
}
