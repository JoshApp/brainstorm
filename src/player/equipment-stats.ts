import { CONFIG } from '../config';
import { getEquipment } from './equipment';

// Aggregated player stats from base + all equipped items' passive effects.
//
// Anywhere in the game that asks for "max HP" or "incoming damage reduction"
// should call into here rather than reading CONFIG directly. Recomputed
// on demand (called once per relevant event, not every frame).

export interface PlayerStats {
  /** Max HP — used to cap heals and to render HP-bar pip count. */
  maxHp: number;
  /** Flat damage added to every weapon swing. */
  weaponDamageBonus: number;
  /** Flat damage subtracted from every incoming hit (floored to 1). */
  damageReduction: number;
}

export function computeStats(): PlayerStats {
  let maxHp = CONFIG.PLAYER_HP_MAX;
  let weaponDamageBonus = 0;
  let damageReduction = 0;

  const eq = getEquipment();
  for (const slot of Object.values(eq)) {
    if (!slot || !slot.passives) continue;
    for (const p of slot.passives) {
      switch (p.kind) {
        case 'max-hp': maxHp += p.amount; break;
        case 'weapon-damage': weaponDamageBonus += p.amount; break;
        case 'damage-reduction': damageReduction += p.amount; break;
      }
    }
  }
  return { maxHp, weaponDamageBonus, damageReduction };
}
