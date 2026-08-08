import type { BuffSpec } from '../ecs/types';
import { CONFIG } from '../config';

/**
 * Turn a status's BUDGET into the tick interval the runtime needs.
 *
 * Every DoT below used to state its interval directly, tuned by hand against a
 * health pool that has since changed — so bleed's "capped so it doesn't melt
 * you" was draining the whole bar in a second. It comes from config.ts
 * DOT_BUDGET now, which has the full account:
 *
 *   interval = (stacks × tickDamage) ÷ (share × pool)
 *
 * so the pool can move again and the rate follows it instead of outliving it.
 * The SPIKE is handled by `tickDamage` being fractional rather than by clamping
 * stacks — see DOT_BUDGET.MAX_TICK_SHARE for why that distinction matters.
 */
function dot(budget: { share: number; maxStacks: number; tickDamage: number }) {
  const { maxStacks, tickDamage } = budget;
  const interval = (maxStacks * tickDamage) / (budget.share * CONFIG.PLAYER_HP_MAX);
  return {
    maxStacks,
    tickInterval: Math.round(interval * 100) / 100,
  };
}

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

  // Brief defensive proc — typically applied by an item's on-damaged
  // trigger ("when hit, stiffen for a moment"). Short duration so the
  // player can't just sit in damage and stay armoured; it's a *reactive
  // window* that rewards re-engaging after being clipped.
  ironhide: {
    id: 'ironhide',
    displayName: 'IRONHIDE',
    color: 0x8090a8,
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
    maxStacks: 3,
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

  // BLOOD RUSH — the flask's repurposed draught under Red Thirst. Normal
  // healing is suppressed by the thirst, so the flask instead pours a short
  // surge of lifesteal + damage: you can't drink your wounds shut, but you can
  // drink the FURY to carve them back on the next few blows. Strong lifesteal so
  // a couple of hits refill fast; damage bump so the window is worth taking.
  bloodrush: {
    id: 'bloodrush',
    displayName: 'BLOOD RUSH',
    color: 0xff3344,
    modifiers: [
      { kind: 'lifesteal-pct', amount: 0.5 },
      { kind: 'damage-multiplier', amount: 1.25 },
    ],
    vfx: { color: 0xff3344, style: 'rise' },
  },

  // Cursed — penalty applied when the player drinks a cursed fountain.
  // Long duration (essentially "the rest of the run") so the player feels
  // the cost. -1 weapon damage AND -1 physical armor: meaningful, but not
  // run-ending if they were already strong.
  cursed: {
    harmful: true,
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

  // BURN — bursty: does NOT stack (re-applying just refreshes). Physical.
  // "Light it and back off." A blade that remembers heat. Ticked every
  // 0.4s it shaved ~6 of the player's 8 HP off a single proc — slowed so a
  // burn stings without being a near-kill on its own. That "slowed" is now
  // DOT_BUDGET.BURN, and the interval follows the pool instead of outliving it.
  burn: {
    harmful: true,
    id: 'burn',
    displayName: 'BURN',
    color: 0xff6020,
    ...dot(CONFIG.DOT_BUDGET.BURN),
    tickEffect: { type: 'damage', amount: CONFIG.DOT_BUDGET.BURN.tickDamage, damageType: 'physical' },
    vfx: { color: 0xff6824, style: 'rise' },
  },

  // BLEED — builds with each hit: STACKS (per strike), physical. Rewards
  // fast weapons — daggers shred. At 5 stacks / 0.5s it hit 10 dmg/sec, more
  // than the player's whole 8-HP bar in a second; it was capped at 4 stacks and
  // slowed so it still ramps under pressure without melting you. Then the pool
  // became 5 and 0.8s WAS the whole bar in a second again — the exact failure
  // that tune existed to prevent, reintroduced by a constant in another file.
  bleed: {
    harmful: true,
    id: 'bleed',
    displayName: 'BLEED',
    color: 0xcc1418,
    ...dot(CONFIG.DOT_BUDGET.BLEED),
    tickEffect: { type: 'damage', amount: CONFIG.DOT_BUDGET.BLEED.tickDamage, damageType: 'physical' },
    vfx: { color: 0xcc1418, style: 'drip' },
  },

  // POISON — attrition: low, LONG, stacks to 6, and 'magic'-typed so it
  // bypasses PHYSICAL armour (most enemies have none vs magic) — the
  // answer to armoured tanks like the stoneguard. Spider/acid theme.
  poison: {
    harmful: true,
    id: 'poison',
    displayName: 'POISON',
    color: 0x66cc33,
    // Attrition = SLOW drip, not a shredder. Capped lower than bleed's burst so
    // a spider swarm wears you down instead of melting you — it bypasses
    // physical armour, so its per-second rate has to be gentler than the
    // physical DoTs to stay fair. On the 5-point pool the old flat 1.0s was
    // taking 80% of your bar per second THROUGH armour, which is not attrition.
    ...dot(CONFIG.DOT_BUDGET.POISON),
    tickEffect: { type: 'damage', amount: CONFIG.DOT_BUDGET.POISON.tickDamage, damageType: 'magic' },
    vfx: { color: 0x66cc33, style: 'drip' },
  },

  // ── Control / amplifier statuses (no DoT — pure modifiers) ────────

  // CHILL — frostbite: slows movement AND attack cadence. No damage; a
  // control tool (a frost weapon makes a charger sluggish, buys spacing
  // against a swarm). Refresh-only. Modifiers route through the same
  // pipeline as everything else — the enemy AI reads move/action speed
  // from aggregateSpeed.
  chill: {
    harmful: true,
    id: 'chill',
    displayName: 'CHILL',
    color: 0x88ccff,
    modifiers: [
      { kind: 'move-speed-mult', amount: 0.5 },
      { kind: 'action-speed-mult', amount: 0.6 },
    ],
    vfx: { color: 0x9fd8ff, style: 'rise' },   // frost vapour
  },

  // SUNDER — armour cracked: the target takes MORE damage (×1.35). The
  // combo amplifier — sunder, then bleed/poison hit harder; or sunder a
  // tank so your swings land for real. Works on enemies (a heavy weapon)
  // AND on the player (an enemy that makes you brittle) via the same
  // incoming-damage multiplier in computeDamage.
  sunder: {
    harmful: true,
    id: 'sunder',
    displayName: 'SUNDER',
    color: 0xffb347,
    modifiers: [
      { kind: 'incoming-damage-mult', amount: 1.35 },
    ],
    vfx: { color: 0xffc266, style: 'rise' },
  },
};
