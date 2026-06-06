import type { WeaponStats } from '../content/items';
import { resolveWeaponStats, type ResolvedWeaponStats } from '../content/weapon-classes';

// Currently-equipped weapon stats. Combat + the sword viewmodel read
// from here every frame; the resolve runs PER QUERY so that mid-run
// growth of weapon-class proficiency + Acuity attribute show up
// immediately without an explicit "re-equip" tick. Resolve is cheap
// (a handful of multiplies); even at 60Hz it's noise.

// FISTS — the unarmed baseline. Short reach (≈chest height), narrow
// cone (a punch lands forward, not in a cleave), low damage. Used as
// the bootstrap default AND as the live stats when no weapon is
// equipped — main.ts swaps to this on equipment changes where the
// weapon slot is empty, so the player can punch their way through
// the starter chamber if they decline the altar.
export const FIST_STATS: WeaponStats = {
  reach: 1.3,
  coneHalfAngle: 0.55,
  damage: 1,
  critChance: 0.04,
  critMultiplier: 1.5,
  class: 'fist',
};

let rawSpec: WeaponStats = FIST_STATS;

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
