// Boss-encounter engagement flag — single source of truth for
// "the player has committed to this boss fight." Decoupled from the
// boss's aiState because we want the bar to appear ONLY when the
// player crosses the fog-wall threshold, not the moment a long-
// sight-range boss aggros from across the arena.
//
// Two flags:
//   hasFogWall — set by the builder when a boss-mist prop is
//     spawned. Tells the boss-bar tick whether a fog wall is in
//     scene at all. If not (test scenarios, old levels), the bar
//     falls back to its legacy aiState-based engagement.
//   engaged — set ONCE when the fog wall is crossed. Cleared on
//     level load. Boss bar engages on this flag (or the legacy
//     fallback above).

import { registerSimReset } from '../engine/sim-state';

let hasFogWall = false;
let engaged = false;

/** Called by the builder when a boss-mist prop is spawned. */
export function registerFogWall(): void {
  hasFogWall = true;
}

/** Called by the fog-wall cross trigger when the player crosses
 *  into the arena. Idempotent — repeated calls are no-ops. */
export function engageBoss(): void {
  engaged = true;
}

/** True if the boss bar should show NOW. With a fog wall in scene,
 *  this requires the player to have crossed it. Without one,
 *  returns false so the caller falls back to its legacy check. */
export function isBossEngaged(): boolean {
  return engaged;
}

/** True if any boss-mist exists in the current level. The boss-bar
 *  tick uses this to decide whether to honour the aiState fallback. */
export function levelHasFogWall(): boolean {
  return hasFogWall;
}

/** Clear all engagement state. Called by the level loader on every
 *  load so old level state never leaks into the next. */
export function resetBossEngagement(): void {
  hasFogWall = false;
  engaged = false;
}
// sim-state: boss engagement flags must clear at run start (see sim-state.ts).
registerSimReset(resetBossEngagement);
