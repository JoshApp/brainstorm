import type { ModelSpec } from '../ecs/model-types';
import { SWORD_RUSTED } from './sword';
import { WEAPON_SCIMITAR } from './weapons';

// Item registry. An ItemSpec is the canonical definition of a thing the
// player can collect: name shown in pickup notification, the model used when
// the item lies on the floor as a pickup, and (for weapons) the viewmodel
// that becomes the player's wielded weapon when equipped.

/** Combat stats — only set on items that are weapons. */
export interface WeaponStats {
  /** Max melee reach in meters (camera-to-enemy distance). */
  reach: number;
  /** Forward arc half-angle in radians that registers as a hit. */
  coneHalfAngle: number;
  /** Damage per successful strike. */
  damage: number;
}

export interface ItemSpec {
  id: string;
  /** Display name shown in the pickup-notification overlay. */
  name: string;
  /** Model used when the item is on the floor as a pickup. */
  dropModel: ModelSpec;
  /**
   * If set, picking up this item also EQUIPS it as the player's wielded
   * weapon (the held viewmodel changes). Most weapons reuse their
   * dropModel as the viewmodel — same geometry, just animated by the
   * sword controller when wielded.
   */
  viewmodel?: ModelSpec;
  /** Combat stats for weapons. Set together with viewmodel for weapons. */
  weapon?: WeaponStats;
}

export const ITEMS: Record<string, ItemSpec> = {
  'rusted-sword': {
    id: 'rusted-sword',
    name: 'A rusted short sword',
    dropModel: SWORD_RUSTED,
    viewmodel: SWORD_RUSTED,
    weapon: { reach: 1.8, coneHalfAngle: 0.65, damage: 1 },
  },
  scimitar: {
    id: 'scimitar',
    name: 'A scimitar, curved and stained',
    dropModel: WEAPON_SCIMITAR,
    viewmodel: WEAPON_SCIMITAR,
    // Longer blade = more reach + wider arc than the rusted sword.
    weapon: { reach: 2.2, coneHalfAngle: 0.85, damage: 2 },
  },
};
