import { CONFIG } from '../config';
import type { WeaponStats, WeaponClass } from './items';
import { getCharacter } from '../state/character';

// Weapon classes — pick the animation archetype and seed the default
// timings. Each weapon spec can override individual fields; class is
// just the baseline + the animation routing.
//
//   dagger  fast forward stab — short reach, narrow cone, crit-fish
//   sword   diagonal slash    — medium reach + cone, the baseline
//   hammer  overhead smash    — long reach, wide cone, no crits
//
// resolveWeaponStats() flattens class defaults → spec overrides →
// attackSpeed multiplier into a single fully-populated stat block.
// Combat + the sword viewmodel both consume the RESOLVED stats so
// per-instance overrides flow through with no special cases.

export interface ResolvedWeaponStats {
  reach: number;
  coneHalfAngle: number;
  damage: number;
  critChance: number;
  critMultiplier: number;
  class: WeaponClass;
  windupTime: number;
  strikeTime: number;
  recoverTime: number;
}

export const WEAPON_CLASS_DEFAULTS: Record<WeaponClass, {
  windup: number;
  strike: number;
  recover: number;
}> = {
  dagger: {
    windup: 0.06,         // barely any wind-up; the stab is a flick
    strike: 0.22,         // two jabs back-to-back ("stab stab"); split 50/50 inside the curve
    recover: 0.16,        // snap back to ready
  },
  sword: {
    // Original CONFIG values become the SWORD class defaults so the
    // existing balance is unchanged for sword-class weapons.
    windup:  CONFIG.SWORD_SWING_WINDUP,
    strike:  CONFIG.SWORD_SWING_STRIKE,
    recover: CONFIG.SWORD_SWING_RECOVER,
  },
  hammer: {
    windup: 0.28,         // long telegraph — heave it overhead
    strike: 0.14,         // the strike itself comes down fast
    recover: 0.50,        // long recovery — punish a missed swing
  },
};

// Per-proficiency bonus tuning. Each point of weapon-class proficiency
// shaves a small percentage off the timings AND adds the same to the
// damage. Capped at PROFICIENCY_CAP so a long run doesn't trivialise
// floor 1 — at the cap one weapon class is ~25% faster + 25% harder
// hitting than its baseline.
const PROFICIENCY_PER_POINT = 0.005;     // 0.5% per point
const PROFICIENCY_CAP_PCT  = 0.25;       // hard cap at 25% (50 points)
// Acuity adds 2% crit chance per point.
const ACUITY_CRIT_PER_POINT = 0.02;

/** Flatten class defaults + per-spec overrides + attackSpeed +
 *  character proficiency + Acuity into a single resolved stat block.
 *  Cheap; called per-frame from combat + sword animation.
 *
 *  When the player has zero character points across the board (start
 *  of a fresh run, the unspent ones still in the pool), the resolved
 *  stats equal the spec exactly — no surprises in early-game balance. */
export function resolveWeaponStats(spec: WeaponStats): ResolvedWeaponStats {
  const cls: WeaponClass = spec.class ?? 'sword';
  const baseT = WEAPON_CLASS_DEFAULTS[cls];
  const speedMul = 1 / (spec.attackSpeed ?? 1);    // larger attackSpeed → SHORTER timings

  const char = getCharacter();
  const profPct = Math.min(PROFICIENCY_CAP_PCT, char.proficiencies[cls] * PROFICIENCY_PER_POINT);
  const profSpeed = 1 - profPct;      // shorter timings as proficiency rises
  const profDmgMul = 1 + profPct;     // damage scales the same direction
  const acuityCrit = char.attributes.acuity * ACUITY_CRIT_PER_POINT;

  return {
    reach: spec.reach,
    coneHalfAngle: spec.coneHalfAngle,
    damage: spec.damage * profDmgMul,
    critChance: (spec.critChance ?? 0.05) + acuityCrit,
    critMultiplier: spec.critMultiplier ?? 2.0,
    class: cls,
    windupTime:  (spec.windupTime  ?? baseT.windup)  * speedMul * profSpeed,
    strikeTime:  (spec.strikeTime  ?? baseT.strike)  * speedMul * profSpeed,
    recoverTime: (spec.recoverTime ?? baseT.recover) * speedMul * profSpeed,
  };
}
