import type { ModelSpec } from '../ecs/model-types';
import type { StatModifier } from '../combat/modifiers';
import type { PassiveSpec } from '../ecs/types';
import { SWORD_RUSTED } from './sword';
import { WEAPON_SCIMITAR, HEARTBURN } from './weapons';
import {
  HEALING_POTION, RING_OF_VIGOR, RING_OF_PREDATION, RING_OF_BLOODTHIRST,
  RING_OF_FRENZY, TATTERED_CLOAK, BERSERK_POTION,
  IRON_COIF, BONE_AMULET, LEATHER_GLOVES, WORN_BOOTS, WOODEN_SHIELD,
} from './loot-models';
import { PASSIVES } from './passives';

// Item registry. An ItemSpec is the canonical definition of a thing the
// player can collect: kind, display name, drop model, optional viewmodel
// (weapons), optional combat stats (weapons), optional stat modifiers
// (rings/armor).

export type ItemKind = 'weapon' | 'armor' | 'ring' | 'consumable'
                     | 'helmet' | 'amulet' | 'gloves' | 'boots' | 'offhand';

/**
 * Rarity tiers — atmospheric grimdark naming over the standard ARPG palette.
 * Drives the colored border / name tint in the inventory panel and the
 * floor-pickup glow color. Higher rarity = stronger / more numerous effects.
 */
export type Rarity = 'mundane' | 'uncommon' | 'rare' | 'cursed' | 'fabled';

/** Hex colors per rarity — atmospheric warm-cool palette, not gaudy RGB. */
export const RARITY_COLORS: Record<Rarity, number> = {
  mundane:  0xa09080,  // bone gray — the default; visible but unimportant
  uncommon: 0x70bb70,  // sickly green — slightly elevated, lichen-tinged
  rare:     0x6a96e2,  // pale blue — moonlight, distinctly other
  cursed:   0xc05bd6,  // muted violet — something is wrong with this
  fabled:   0xe6a335,  // amber-gold — heirloom, named, story-bearing
};

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
  /** Rarity tier — drives UI tint + (future) drop weighting. Default mundane. */
  rarity?: Rarity;
  /** Short flavor line shown in the details panel under the name. */
  flavor?: string;
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
  // ── WEAPONS ────────────────────────────────────────────────────────
  'rusted-sword': {
    id: 'rusted-sword',
    kind: 'weapon',
    rarity: 'mundane',
    name: 'A rusted short sword',
    flavor: 'Pitted and ill-balanced. It will do.',
    dropModel: SWORD_RUSTED,
    viewmodel: SWORD_RUSTED,
    weapon: { reach: 1.8, coneHalfAngle: 0.65, damage: 1 },
  },
  scimitar: {
    id: 'scimitar',
    kind: 'weapon',
    rarity: 'uncommon',
    name: 'A scimitar, curved and stained',
    flavor: 'Made for those who would not be patient.',
    dropModel: WEAPON_SCIMITAR,
    viewmodel: WEAPON_SCIMITAR,
    weapon: { reach: 2.2, coneHalfAngle: 0.85, damage: 2 },
  },
  heartburn: {
    id: 'heartburn',
    kind: 'weapon',
    rarity: 'fabled',
    name: 'Heartburn',
    flavor: 'The blade was never quenched.',
    dropModel: HEARTBURN,
    viewmodel: HEARTBURN,
    weapon: { reach: 2.3, coneHalfAngle: 0.9, damage: 3 },
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'damage-multiplier', amount: 1.15 },
    ],
  },
  // ── ARMOR (chest slot) ─────────────────────────────────────────────
  'tattered-cloak': {
    id: 'tattered-cloak',
    kind: 'armor',
    rarity: 'mundane',
    name: 'A cloak, frayed and stained',
    flavor: 'Smells of cellar and old fire.',
    dropModel: TATTERED_CLOAK,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
  },
  // ── HELMET ─────────────────────────────────────────────────────────
  'iron-coif': {
    id: 'iron-coif',
    kind: 'helmet',
    rarity: 'mundane',
    name: 'An iron coif',
    flavor: 'A skullcap, dented but serviceable.',
    dropModel: IRON_COIF,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
  },
  // ── AMULET ─────────────────────────────────────────────────────────
  'bone-amulet': {
    id: 'bone-amulet',
    kind: 'amulet',
    rarity: 'rare',
    name: 'A bone amulet, eyes still warm',
    flavor: 'It watches when you sleep.',
    dropModel: BONE_AMULET,
    modifiers: [
      { kind: 'max-hp', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
  },
  // ── GLOVES ─────────────────────────────────────────────────────────
  'leather-gloves': {
    id: 'leather-gloves',
    kind: 'gloves',
    rarity: 'mundane',
    name: 'Worn leather gloves',
    flavor: 'Stiffened by old blood. Someone else\'s.',
    dropModel: LEATHER_GLOVES,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
  },
  // ── BOOTS ──────────────────────────────────────────────────────────
  'worn-boots': {
    id: 'worn-boots',
    kind: 'boots',
    rarity: 'mundane',
    name: 'A pair of worn boots',
    flavor: 'They have walked further than you have.',
    dropModel: WORN_BOOTS,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
  },
  // ── OFFHAND (shield) ───────────────────────────────────────────────
  'wooden-shield': {
    id: 'wooden-shield',
    kind: 'offhand',
    rarity: 'uncommon',
    name: 'A round wooden shield',
    flavor: 'Cracked across the boss. It will hold once.',
    dropModel: WOODEN_SHIELD,
    modifiers: [
      { kind: 'physical-armor', amount: 2 },
      { kind: 'magic-armor', amount: 1 },
    ],
  },
  // ── RINGS ──────────────────────────────────────────────────────────
  'ring-of-vigor': {
    id: 'ring-of-vigor',
    kind: 'ring',
    rarity: 'uncommon',
    name: 'A green-stoned ring',
    flavor: 'The stone is warm and faintly damp.',
    dropModel: RING_OF_VIGOR,
    modifiers: [{ kind: 'max-hp', amount: 2 }],
  },
  'ring-of-predation': {
    id: 'ring-of-predation',
    kind: 'ring',
    rarity: 'uncommon',
    name: 'A red-stoned ring',
    flavor: 'Each pulse feels like another\'s heartbeat.',
    dropModel: RING_OF_PREDATION,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
  },
  'ring-of-bloodthirst': {
    id: 'ring-of-bloodthirst',
    kind: 'ring',
    rarity: 'rare',
    name: 'A crimson-stoned ring',
    flavor: 'It tastes the kill before you do.',
    dropModel: RING_OF_BLOODTHIRST,
    passives: [PASSIVES['bloodthirst-onkill']],
  },
  'ring-of-frenzy': {
    id: 'ring-of-frenzy',
    kind: 'ring',
    rarity: 'cursed',
    name: 'A violet-stoned ring',
    flavor: 'You hear yourself laughing in someone else\'s voice.',
    dropModel: RING_OF_FRENZY,
    modifiers: [{ kind: 'damage-multiplier', amount: 1.2 }],
  },
  // ── CONSUMABLES ────────────────────────────────────────────────────
  'healing-potion': {
    id: 'healing-potion',
    kind: 'consumable',
    rarity: 'mundane',
    name: 'A vial of dark elixir',
    flavor: 'Tastes of iron and dust.',
    dropModel: HEALING_POTION,
    consumableHeal: 4,
  },
  'berserk-potion': {
    id: 'berserk-potion',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A vial of red haze',
    flavor: 'It moves on its own behind the glass.',
    dropModel: BERSERK_POTION,
    consumableBuff: { buffId: 'berserk', duration: 8.0 },
  },
};

