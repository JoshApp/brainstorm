import type { ModelSpec } from '../ecs/model-types';
import { SWORD_RUSTED } from './sword';
import { WEAPON_SCIMITAR } from './weapons';

// Item registry. An ItemSpec is the canonical definition of a thing the
// player can collect: name shown in pickup notification, the model used when
// the item lies on the floor as a pickup, and (for weapons) the viewmodel
// that becomes the player's wielded weapon when equipped.

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
}

export const ITEMS: Record<string, ItemSpec> = {
  'rusted-sword': {
    id: 'rusted-sword',
    name: 'A rusted short sword',
    dropModel: SWORD_RUSTED,
    viewmodel: SWORD_RUSTED,
  },
  scimitar: {
    id: 'scimitar',
    name: 'A scimitar, curved and stained',
    dropModel: WEAPON_SCIMITAR,
    viewmodel: WEAPON_SCIMITAR,
  },
};
