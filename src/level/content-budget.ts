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

export interface FloorContentBudget {
  combat: {
    /** How many enemies this floor should contain, FLOOR-TOTAL (distributed
     *  across rooms downstream). Always >= COMBAT_MIN — never zero. */
    count: number;
    /** Pack intensity for the floor ('heavy' upgrades a slot to an elite). */
    intensity: EncounterIntensity;
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

/** The full per-floor budget. `rand` should be a seeded stream derived from the
 *  floor seed so the budget reproduces on replay. */
export function floorContentBudget(depth: number, rand: () => number): FloorContentBudget {
  return {
    combat: {
      count: combatCount(depth, rand),
      intensity: combatIntensity(depth, rand),
    },
  };
}
