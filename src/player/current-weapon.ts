import type { WeaponStats } from '../content/items';

// Currently-equipped weapon stats. Combat code reads from here every frame
// (cheap, no allocation). The pickup module calls setCurrentWeapon() when
// a weapon item is taken; the default value matches the starting sword.

let current: WeaponStats = {
  reach: 1.8,
  coneHalfAngle: 0.65,
  damage: 1,
  critChance: 0.05,
  critMultiplier: 2.0,
};

export function getCurrentWeapon(): WeaponStats {
  return current;
}

export function setCurrentWeapon(stats: WeaponStats) {
  current = stats;
}
