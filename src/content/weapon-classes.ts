import { CONFIG } from '../config';
import type { WeaponStats, WeaponClass } from './items';

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

/** Flatten class defaults + per-spec overrides + attackSpeed into a
 *  single resolved stat block. Falls back to safe defaults whenever
 *  the spec is missing fields. */
export function resolveWeaponStats(spec: WeaponStats): ResolvedWeaponStats {
  const cls: WeaponClass = spec.class ?? 'sword';
  const baseT = WEAPON_CLASS_DEFAULTS[cls];
  const speedMul = 1 / (spec.attackSpeed ?? 1);    // larger attackSpeed → SHORTER timings
  return {
    reach: spec.reach,
    coneHalfAngle: spec.coneHalfAngle,
    damage: spec.damage,
    critChance: spec.critChance ?? 0.05,
    critMultiplier: spec.critMultiplier ?? 2.0,
    class: cls,
    windupTime:  (spec.windupTime  ?? baseT.windup)  * speedMul,
    strikeTime:  (spec.strikeTime  ?? baseT.strike)  * speedMul,
    recoverTime: (spec.recoverTime ?? baseT.recover) * speedMul,
  };
}
