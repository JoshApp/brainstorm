import type { WeaponStats } from '../content/items';
import { resolveWeaponStats, type ResolvedWeaponStats } from '../content/weapon-classes';

// Currently-equipped weapon stats. Combat + the sword viewmodel read
// from here every frame; the resolve runs PER QUERY so that mid-run
// growth of weapon-class proficiency + Acuity attribute show up
// immediately without an explicit "re-equip" tick. Resolve is cheap
// (a handful of multiplies); even at 60Hz it's noise.

let rawSpec: WeaponStats = {
  reach: 2.1,
  coneHalfAngle: 0.80,
  damage: 1,
  critChance: 0.05,
  critMultiplier: 2.0,
  class: 'sword',
};

export function getCurrentWeapon(): ResolvedWeaponStats {
  return resolveWeaponStats(rawSpec);
}

export function setCurrentWeapon(stats: WeaponStats) {
  rawSpec = stats;
}

// Hold-to-charge — applied to ALL weapon classes now. Melee classes
// get the cocked-back viewmodel + damage/reach/cone bonus; ranged
// classes scale the projectile's damage by the same curve. Per-class
// charged specials are configured via the chargedMoves field on each
// ClassDefaults entry.
export function wantsHoldToCharge(): boolean {
  return rawSpec.class !== undefined;
}
