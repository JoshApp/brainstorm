import type { WeaponStats } from '../content/items';
import { resolveWeaponStats, type ResolvedWeaponStats } from '../content/weapon-classes';
import { applyScars } from '../content/scars';
import { getScars } from '../state/weapon-scars';

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
// The ITEM id behind those stats, so the weapon's SCARS can be looked up. Stats
// alone are anonymous — two rusted swords resolve identically, but only the one
// you carried to the forge remembers anything.
let rawItemId: string | undefined;

export function getCurrentWeapon(): ResolvedWeaponStats {
  // FORM scars shape the swing itself — reach, cone, cadence, weight — after
  // class defaults, proficiency and attributes have had their say, so a scar
  // composes with a weapon it was never authored against. EDGE and DEBT scars
  // are NOT here: they emit StatModifiers and ride the stat pipeline
  // (combat/modifiers.ts) like everything else. See content/scars.ts.
  return applyScars(resolveWeaponStats(rawSpec), getScars(rawItemId));
}

export function setCurrentWeapon(stats: WeaponStats, itemId?: string) {
  rawSpec = stats;
  rawItemId = itemId;
}

// Hold-to-charge — applied to ALL weapon classes now. Melee classes
// get the cocked-back viewmodel + damage/reach/cone bonus; ranged
// classes scale the projectile's damage by the same curve. Per-class
// charged specials are configured via the chargedMoves field on each
// ClassDefaults entry.
export function wantsHoldToCharge(): boolean {
  return rawSpec.class !== undefined;
}
