// Tap resolution — the single, ordered, range-aware rule that decides what a
// world tap DOES: attack, interact, or nothing. Pure (no THREE, no globals, no
// side effects) so the rules are legible in one place and unit-testable; the
// caller (main.ts onTap) gathers the inputs and executes the result.
//
// The priority ladder, in plain words (matches the design intent):
//   1. A mob you can fight wins — tapping a mob, or any mob in range, attacks.
//      Combat takes preference over interacting.
//   2. With no mob to fight, a DELIBERATE tap on an interactable is
//      interact-intent and must never become a swing: use it if reachable,
//      otherwise do nothing (never flail at a chest you're too far from).
//   3. An ambient tap (no specific aim) reaches for the best in-range
//      interactable — pickup > descend > other, decided by each one's
//      `priority` (see INTERACT_PRIORITY). The joystick half never acts here.
//   4. Nothing aimed, nothing in range → swing at the air.
//
// "Best in-range" ordering lives in the interactable system (priority-ranked
// selection); this function just consumes its answer.

import type { TapTarget } from './tap-target';
import type { Interactable } from '../interactables/types';

export type TapAction =
  | { kind: 'attack' }
  | { kind: 'interact'; interactable: Interactable }
  | { kind: 'none' };

export interface TapInputs {
  /** What the raycast/proximity aim landed on (findTapTarget), or null. */
  aimed: TapTarget | null;
  /** Is the aimed interactable within its own radius (reachable by this tap)? */
  aimedReachable: boolean;
  /** Is any mob within attack range right now (combat.hasEnemyInRange())? */
  mobInRange: boolean;
  /** The priority-best in-range interactable (system currentInRange), or null. */
  bestInRange: Interactable | null;
  /** Does this tap's zone allow ambient combat? Right/combat half = true;
   *  left/joystick half = false (a move-zone tap never attacks ambiently). */
  canAttack: boolean;
}

export function resolveTap(t: TapInputs): TapAction {
  // 1) Combat first. Tapping a mob is always an attack (any zone). A mob in
  //    range likewise means attack — preference over interacting — but only in
  //    the combat zone (an ambient tap on the joystick half isn't a swing).
  if (t.aimed?.kind === 'enemy') return { kind: 'attack' };
  if (t.canAttack && t.mobInRange) return { kind: 'attack' };

  // 2) No mob to fight. A deliberate tap on an interactable is interact-intent
  //    and NEVER falls through to a swing: use it if reachable, else nothing.
  if (t.aimed?.kind === 'interactable') {
    return t.aimedReachable
      ? { kind: 'interact', interactable: t.aimed.interactable }
      : { kind: 'none' };
  }

  // 3) Ambient tap with no specific aim. The joystick half does nothing.
  if (!t.canAttack) return { kind: 'none' };

  // 4) Reach for the best in-range interactable (pickup > descend > other).
  if (t.bestInRange) return { kind: 'interact', interactable: t.bestInRange };

  // 5) Nothing aimed, nothing in range → swing at the air.
  return { kind: 'attack' };
}
