import type { ModelSpec } from '../ecs/model-types';
import type { ItemSpec } from './items';

// MYSTERY REWARD EMBLEM — the visual language for a prize you know the CATEGORY
// of but not the item. A trial says "fight for a mystery WEAPON", not "fight for
// the Rusted Cleaver": you know the shape of the reward (its tint + a floating
// '?' rune), the specific loot is the surprise you earn by winning.
//
// One emblem, four category tints. A faint additive backing orb (the arcane
// glow) with the '?' rune billboarded over it, both gently alive. Built as a
// ModelSpec so it floats + reveals through the same paths as a real prize model.

export type RewardCategory = 'weapon' | 'armor' | 'relic' | 'consumable';

// Category → tint. Echoes the stat-icon legend so the whole game speaks one
// colour language: amber steel = arms, cold blue = armour, violet = relic,
// green = draught.
const CATEGORY_TINT: Record<RewardCategory, number> = {
  weapon:     0xf0b068,
  armor:      0x96b0c8,
  relic:      0xc890e0,
  consumable: 0x88cc88,
};

/** Which mystery category an item reads as — folds the equip slots (offhand /
 *  vestment) into 'armor', everything non-weapon/relic into consumable. */
export function rewardCategory(item: ItemSpec): RewardCategory {
  switch (item.kind) {
    case 'weapon':   return 'weapon';
    case 'relic':    return 'relic';
    case 'offhand':
    case 'vestment': return 'armor';
    default:         return 'consumable';
  }
}

export function categoryTint(category: RewardCategory): number {
  return CATEGORY_TINT[category];
}

/** A floating mystery emblem for a reward category — an orb of category-tinted
 *  glow with a '?' rune over it. Both sprites billboard + breathe on their own
 *  (flicker uses Date.now(), no external tick needed). */
export function mysteryEmblem(category: RewardCategory): ModelSpec {
  const tint = CATEGORY_TINT[category];
  return {
    id: `mystery-emblem-${category}`,
    materials: {},
    parts: [
      // Backing bloom — a soft additive orb in the category colour.
      {
        kind: 'sprite', name: 'glow', pos: [0, 0, 0], size: [0.5, 0.5],
        texture: 'moonbeam', color: tint, blending: 'additive', opacity: 0.85,
        flicker: { scale: 0.10, bob: 0.02, speed: 0.7 },
      },
      // The '?' rune, tinted to the category and floated just in front so it
      // reads over the bloom.
      {
        kind: 'sprite', name: 'rune', pos: [0, 0, 0.01], size: [0.34, 0.34],
        texture: 'mystery-rune', color: tint, blending: 'additive', opacity: 0.98,
        flicker: { scale: 0.06, bob: 0.02, speed: 0.9, phase: 0.5 },
      },
    ],
  };
}
