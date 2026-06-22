// TRANSFORMS — the grotesque-fate verb: a held card (or, later, an equipped
// item) REWRITES a rule of how the player works. Unlike modifiers (numbers) or
// procs (events), a transform changes the GAME'S RULES — "you can't heal the
// normal way," "you bleed when you rest," "your max HP decays each floor."
//
// CARRIER-AGNOSTIC by design: `activeTransforms()` aggregates from every source
// (held cards today; equipped items the day a cursed relic suppresses healing),
// so the systems that own each rule — the heal path, the drain tick — read ONE
// list and never care whether a card or an item set the rule. Same "one
// pipeline, never a parallel engine" shape as modifiers/procs.

import { getHeldCards } from '../state/run-state';
import { cardTransforms } from '../content/cards';

export type Transform =
  // Fires / items / regen no longer heal you (you heal only by other means,
  // e.g. a heal-on-hit proc). The heal path checks this.
  | { rule: 'suppress-passive-heal' }
  // Lose HP on a cadence: every second you're out of combat, or every floor you
  // descend. The matching drain system reads these.
  | { rule: 'hp-drain'; per: 'out-of-combat' | 'floor'; amount: number };

/** Every active rule-override this run, from all carriers. Items fold in here
 *  later — one resolver, every source. */
export function activeTransforms(): Transform[] {
  return [...cardTransforms(getHeldCards())];
}

/** Are fires/items/regen suppressed? (The heal path's gate.) */
export function passiveHealSuppressed(): boolean {
  return activeTransforms().some((t) => t.rule === 'suppress-passive-heal');
}

/** The HP-drain rules of a given cadence — summed amount the drain systems
 *  apply. 'out-of-combat' is per-second; 'floor' is per-descent. */
export function hpDrainAmount(per: 'out-of-combat' | 'floor'): number {
  let total = 0;
  for (const t of activeTransforms()) {
    if (t.rule === 'hp-drain' && t.per === per) total += t.amount;
  }
  return total;
}
