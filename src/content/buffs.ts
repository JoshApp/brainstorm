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

  // Cursed — penalty applied when the player drinks a cursed fountain.
  // Long duration (essentially "the rest of the run") so the player feels
  // the cost. -1 weapon damage AND -1 physical armor: meaningful, but not
  // run-ending if they were already strong.
  cursed: {
    id: 'cursed',
    displayName: 'CURSED',
    color: 0x9c4dcf,
    modifiers: [
      { kind: 'weapon-damage', amount: -1 },
      { kind: 'physical-armor', amount: -1 },
    ],
  },

  // ── Status effects (DoTs) ─────────────────────────────────────────
  // Three damage-over-time presets, each a DIFFERENT texture of play —
  // not reskins. All are buff entries: the runtime already knows how to
  // tick them, scale by stacks, route the kill, and draw the VFX.

  // BURN — bursty: high, fast ticks, short, does NOT stack (re-applying
  // just refreshes). Physical. "Light it and back off." A blade that
  // remembers heat.
  burn: {
    id: 'burn',
    displayName: 'BURN',
    color: 0xff6020,
    tickInterval: 0.4,
    tickEffect: { type: 'damage', amount: 1, damageType: 'physical' },
    vfx: { color: 0xff6824, style: 'rise' },
  },

  // BLEED — builds with each hit: medium, STACKS (per strike) up to 5,
  // physical. Rewards fast weapons — daggers shred. Short-ish so you
  // have to keep the pressure on to ramp it.
  bleed: {
    id: 'bleed',
    displayName: 'BLEED',
    color: 0xcc1418,
    tickInterval: 0.5,
    tickEffect: { type: 'damage', amount: 1, damageType: 'physical' },
    maxStacks: 5,
    vfx: { color: 0xcc1418, style: 'drip' },
  },

  // POISON — attrition: low, LONG, stacks to 6, and 'magic'-typed so it
  // bypasses PHYSICAL armour (most enemies have none vs magic) — the
  // answer to armoured tanks like the stoneguard. Spider/acid theme.
  poison: {
    id: 'poison',
    displayName: 'POISON',
    color: 0x66cc33,
    tickInterval: 0.6,
    tickEffect: { type: 'damage', amount: 1, damageType: 'magic' },
    maxStacks: 6,
    vfx: { color: 0x66cc33, style: 'drip' },
  },
};
