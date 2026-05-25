import type { BuffSpec } from '../ecs/types';

// Buff library. Each entry is data — composed of effect primitives, no custom
// code. Future buffs (poison, burning, stunned, hasted, etc.) are just more
// entries here. The runtime in src/ecs/buffs.ts doesn't change.
//
// Two ways a buff can affect the game:
//   - tickInterval + tickEffect — periodic ticking (heal-over-time, DoT)
//   - modifiers                  — stat modifications applied while active
//                                  (aggregated by src/combat/modifiers.ts)
// A buff can use both (e.g., poison: tick-damage + reduced armor).

export const BUFFS: Record<string, BuffSpec> = {
  // Slow HP regen. Granted by the player's "reaper" passive on enemy kill.
  'regen-pulse': {
    id: 'regen-pulse',
    displayName: 'REGEN',
    color: 0x55ff80,
    tickInterval: 0.45,
    tickEffect: { type: 'heal', amount: 1 },
  },

  // Flat damage bonus. Granted by Ring of Bloodthirst on each kill (4s).
  // Stacks ADDITIVELY with other weapon-damage sources (Ring of Predation,
  // base weapon damage) via the modifier-aggregation pipeline.
  bloodthirst: {
    id: 'bloodthirst',
    displayName: 'BLOODTHIRST',
    color: 0xff4422,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
  },

  // Multiplicative damage bonus. Granted by drinking a Berserk potion.
  // Multiplies the final outgoing damage by 1.5 (after flat bonuses are
  // summed). Tests the multiplier path in the damage pipeline.
  berserk: {
    id: 'berserk',
    displayName: 'BERSERK',
    color: 0xff8822,
    modifiers: [{ kind: 'damage-multiplier', amount: 1.5 }],
  },
};
