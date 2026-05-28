import type { WeaponStats } from '../content/items';
import { resolveWeaponStats, type ResolvedWeaponStats } from '../content/weapon-classes';

// Currently-equipped weapon stats. Combat code + the sword viewmodel
// both read from here every frame (cheap, no allocation). The
// equipment listener calls setCurrentWeapon() when a weapon item
// equips; the default matches the starter-sword baseline.
//
// We store the RESOLVED stats so combat + animation don't have to
// know about class defaults or per-instance overrides — those are
// flattened in once at set time.

let current: ResolvedWeaponStats = resolveWeaponStats({
  reach: 1.8,
  coneHalfAngle: 0.65,
  damage: 1,
  critChance: 0.05,
  critMultiplier: 2.0,
  class: 'sword',
});

export function getCurrentWeapon(): ResolvedWeaponStats {
  return current;
}

export function setCurrentWeapon(stats: WeaponStats) {
  current = resolveWeaponStats(stats);
}
