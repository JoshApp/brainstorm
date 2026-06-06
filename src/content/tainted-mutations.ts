import type { StatModifier } from '../combat/modifiers';

// Tainted mutations — the permanent run-lifetime stat changes a tainted
// fountain inflicts on the player. Each is a Faustian bargain: most have a
// downside paid for an upside, a few are pure ruin, a few pure gift dressed
// in dread. Stacks freely with itself and with everything else (drink twice,
// both effects apply — the modifier pipeline doesn't care where mods come
// from).
//
// Composed through the same StatModifier pipeline equipment / buffs /
// passives use, so a content layer can add new mutations without touching
// any engine code.
//
// Tone Bible applies: terse, archaic, indifferent. The flavor line is what
// the player reads at the moment of drinking — grim, specific, never funny.

export interface TaintedMutation {
  /** Stable id. Persisted in the save (so a content rebalance can change
   *  modifiers without invalidating existing runs). */
  id: string;
  /** Short uppercase brand burned into the player's sheet. */
  name: string;
  /** A single grim line. Spoken at the moment the drink takes hold. */
  flavor: string;
  /** Stat changes applied for the rest of the run. */
  modifiers: readonly StatModifier[];
}

export const TAINTED_MUTATIONS: readonly TaintedMutation[] = [
  {
    id: 'tongue-of-iron',
    name: 'TONGUE OF IRON',
    flavor: 'The water tastes of nails. Your teeth ache to chew steel.',
    modifiers: [
      { kind: 'weapon-damage', amount: 2 },
      { kind: 'max-hp', amount: -3 },
    ],
  },
  {
    id: 'skin-of-stone',
    name: 'SKIN OF STONE',
    flavor: 'It settles in your veins like silt. Slow. Solid.',
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
      { kind: 'move-speed-mult', amount: 0.88 },
    ],
  },
  {
    id: 'glass-eye',
    name: 'GLASS EYE',
    flavor: 'You see the seam in every neck. It does not feel like a gift.',
    modifiers: [
      { kind: 'crit-chance', amount: 0.10 },
      { kind: 'max-hp', amount: -2 },
    ],
  },
  {
    id: 'thirst',
    name: 'THIRST',
    flavor: 'You drink, and after, you keep drinking. Now you must.',
    modifiers: [
      { kind: 'lifesteal-pct', amount: 0.15 },
      { kind: 'physical-armor', amount: -1 },
    ],
  },
  {
    id: 'wormwood',
    name: 'WORMWOOD',
    flavor: 'Bitter. Bitterer. Something coils where your warmth was.',
    modifiers: [
      { kind: 'damage-multiplier', amount: 1.20 },
      { kind: 'incoming-damage-mult', amount: 1.20 },
    ],
  },
  {
    id: 'broken-promise',
    name: 'BROKEN PROMISE',
    flavor: 'Something inside you breaks. Something else sets in its place.',
    modifiers: [
      { kind: 'finisher-damage-mult', amount: 1.5 },
      { kind: 'action-speed-mult', amount: 0.92 },
    ],
  },
  // Pure gifts — rare, recognizable by the absence of a price. The dungeon
  // is indifferent, not cruel; the water is sometimes only water.
  {
    id: 'kindness',
    name: 'KINDNESS',
    flavor: 'The water is clean. You were not expecting that.',
    modifiers: [
      { kind: 'max-hp', amount: 4 },
    ],
  },
];

export function getMutation(id: string): TaintedMutation | undefined {
  return TAINTED_MUTATIONS.find((m) => m.id === id);
}
