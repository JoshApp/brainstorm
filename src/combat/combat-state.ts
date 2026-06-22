// Shared COMBAT-STATE signal — "is the player fighting right now?" Derived from
// the event bus (you dealt a hit, took damage, or made a kill recently) against
// the deterministic game clock, so it's reproducible. One source of truth for
// any system that cares: the transform out-of-combat bleed today, the rite's
// Hunger decay tomorrow. Subscribes once on module load.

import { on } from '../broadcast/event-bus';
import { gameNow } from '../engine/game-clock';

// Seconds after the last combat beat before you're considered "out of combat."
// Short enough that pausing between fights starts the bleed; long enough that a
// lull mid-fight doesn't flip you out.
const OUT_OF_COMBAT_SECONDS = 3;

let lastCombatAt = -Infinity;

on((e) => {
  if (e.type === 'attack:hit' || e.type === 'player:damaged' || e.type === 'enemy:killed') {
    lastCombatAt = gameNow();
  }
});

/** True while the player is actively in a fight (recent hit dealt/taken/kill). */
export function isInCombat(): boolean {
  return gameNow() - lastCombatAt < OUT_OF_COMBAT_SECONDS;
}

/** Seconds since the last combat beat (Infinity before any combat). */
export function secondsSinceCombat(): number {
  return gameNow() - lastCombatAt;
}
