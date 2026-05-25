import { CONFIG } from '../config';
import { getEquipment } from './equipment';

// Aggregated player stats from base + all equipped items' passive effects.
//
// Anywhere in the game that asks for "max HP" / "physical armor" / etc.
// should call into here rather than reading CONFIG directly. Recomputed
// on demand (called once per relevant event, not every frame).

export interface PlayerStats {
  /** Max HP — used to cap heals and to render HP-bar pip count. */
  maxHp: number;
  /** Flat damage added to every weapon swing. */
  weaponDamageBonus: number;
  /** Flat reduction to incoming physical damage (floored at 1 final). */
  physicalArmor: number;
  /** Flat reduction to incoming magic damage (floored at 1 final). */
  magicArmor: number;
}

export function computeStats(): PlayerStats {
  let maxHp = CONFIG.PLAYER_HP_MAX;
  let weaponDamageBonus = 0;
  let physicalArmor = 0;
  let magicArmor = 0;

  const eq = getEquipment();
  for (const slot of Object.values(eq)) {
    if (!slot || !slot.passives) continue;
    for (const p of slot.passives) {
      switch (p.kind) {
        case 'max-hp':         maxHp += p.amount; break;
        case 'weapon-damage':  weaponDamageBonus += p.amount; break;
        case 'physical-armor': physicalArmor += p.amount; break;
        case 'magic-armor':    magicArmor += p.amount; break;
      }
    }
  }
  return { maxHp, weaponDamageBonus, physicalArmor, magicArmor };
}
