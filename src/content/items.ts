import type { ModelSpec } from '../ecs/model-types';
import type { StatModifier } from '../combat/modifiers';
import type { PassiveSpec } from '../ecs/types';
import { SWORD_RUSTED } from './sword';
import { WEAPON_SCIMITAR } from './weapons';
import { HEALING_POTION, RING_OF_VIGOR, RING_OF_PREDATION, RING_OF_BLOODTHIRST, TATTERED_CLOAK, BERSERK_POTION } from './loot-models';
import { PASSIVES } from './passives';

// Item registry. An ItemSpec is the canonical definition of a thing the
// player can collect: kind, display name, drop model, optional viewmodel
// (weapons), optional combat stats (weapons), optional stat modifiers
// (rings/armor).

export type ItemKind = 'weapon' | 'armor' | 'ring' | 'consumable';

/** Combat stats — only set on items that are weapons. */
export interface WeaponStats {
  /** Max melee reach in meters (camera-to-enemy distance). */
  reach: number;
  /** Forward arc half-angle in radians that registers as a hit. */
  coneHalfAngle: number;
  /** Damage per successful strike (before equipment bonuses). */
  damage: number;
}

export interface ItemSpec {
  id: string;
  /** Equipment kind. Determines slot + auto-equip behavior. */
  kind: ItemKind;
  /** Display name shown in the pickup-notification overlay. */
  name: string;
  /** Model used when the item is on the floor as a pickup. */
  dropModel: ModelSpec;
  /** For weapons: the held viewmodel (often same as dropModel). */
  viewmodel?: ModelSpec;
  /** For weapons: combat stats. */
  weapon?: WeaponStats;
  /**
   * Stat modifiers applied while this item is equipped. Goes through the
   * unified modifier pipeline in src/combat/modifiers.ts — same shape
   * that buffs and other effect sources use, so synergies just work.
   */
  modifiers?: StatModifier[];
  /**
   * Triggered passives granted while this item is equipped. Same pipeline
   * as intrinsic player passives — trigger fires on the listed event,
   * effects apply. Lets a ring grant "on kill → apply X buff" without
   * mutating the player entity's passives array.
   */
  passives?: PassiveSpec[];
  /** For consumables: how much HP to restore on use (single-use). */
  consumableHeal?: number;
  /** For consumables: apply this buff to the player on use. */
  consumableBuff?: { buffId: string; duration: number };
}

export const ITEMS: Record<string, ItemSpec> = {
  'rusted-sword': {
    id: 'rusted-sword',
    kind: 'weapon',
    name: 'A rusted short sword',
    dropModel: SWORD_RUSTED,
    viewmodel: SWORD_RUSTED,
    weapon: { reach: 1.8, coneHalfAngle: 0.65, damage: 1 },
  },
  scimitar: {
    id: 'scimitar',
    kind: 'weapon',
    name: 'A scimitar, curved and stained',
    dropModel: WEAPON_SCIMITAR,
    viewmodel: WEAPON_SCIMITAR,
    weapon: { reach: 2.2, coneHalfAngle: 0.85, damage: 2 },
  },
  'healing-potion': {
    id: 'healing-potion',
    kind: 'consumable',
    name: 'A vial of dark elixir',
    dropModel: HEALING_POTION,
    consumableHeal: 4,
  },
  'ring-of-vigor': {
    id: 'ring-of-vigor',
    kind: 'ring',
    name: 'A green-stoned ring',
    dropModel: RING_OF_VIGOR,
    modifiers: [{ kind: 'max-hp', amount: 2 }],
  },
  'ring-of-predation': {
    id: 'ring-of-predation',
    kind: 'ring',
    name: 'A red-stoned ring',
    dropModel: RING_OF_PREDATION,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
  },
  'tattered-cloak': {
    id: 'tattered-cloak',
    kind: 'armor',
    name: 'A cloak, frayed and stained',
    dropModel: TATTERED_CLOAK,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
  },
  // Triggered-buff item — grants the bloodthirst-onkill passive while
  // equipped. Each kill = +1 weapon-damage for 4s; chained kills refresh
  // the buff. Stacks ADDITIVELY with Ring of Predation (each grants +1
  // flat damage from a different source, both aggregated by modifiers).
  'ring-of-bloodthirst': {
    id: 'ring-of-bloodthirst',
    kind: 'ring',
    name: 'A crimson-stoned ring',
    dropModel: RING_OF_BLOODTHIRST,
    passives: [PASSIVES['bloodthirst-onkill']],
  },
  // Multiplicative consumable — drink to gain Berserk (×1.5 damage) for
  // 8s. Tests the multiplier path: Berserk × Bloodthirst × Ring of
  // Predation composes as base * 1.5 * (1 + 1 + 1) per kill chain.
  'berserk-potion': {
    id: 'berserk-potion',
    kind: 'consumable',
    name: 'A vial of red haze',
    dropModel: BERSERK_POTION,
    consumableBuff: { buffId: 'berserk', duration: 8.0 },
  },
};

