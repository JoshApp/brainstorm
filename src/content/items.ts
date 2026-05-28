import type { ModelSpec } from '../ecs/model-types';
import type { StatModifier } from '../combat/modifiers';
import type { PassiveSpec } from '../ecs/types';
import { SWORD_RUSTED } from './sword';
import { WEAPON_SCIMITAR, HEARTBURN, BONE_NEEDLE, IRON_MAUL } from './weapons';
import {
  HEALING_POTION, RING_OF_VIGOR, RING_OF_PREDATION, RING_OF_BLOODTHIRST,
  RING_OF_FRENZY, TATTERED_CLOAK, BERSERK_POTION,
  IRON_COIF, BONE_AMULET, LEATHER_GLOVES, WORN_BOOTS, WOODEN_SHIELD,
  OIL_LAMP_MODEL,
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

// ── Affixes ─────────────────────────────────────────────────────────
// Hybrid ARPG: each item keeps a FIXED hand-written identity (name +
// flavor + base stats). On top of that, every pickup instance rolls
// 0-2 affixes from the item's affixPool. Affix definitions live in
// src/content/affixes.ts; the roll + name-decoration pipeline lives
// in src/player/item-instance.ts.
//
// Items WITHOUT an affixPool always pick up as their plain base form
// (potions, story items, etc.). Items WITH a pool can roll suffixes
// like "of the keening" → small stat tweak; tight ranges so variance
// reads as flavor, not as min-max chasing.

/**
 * Weapon class — picks the animation archetype and supplies DEFAULT
 * timings (windup / strike / recover). Each weapon can override any
 * specific value below; the class is just the baseline + the visual
 * routing.
 *
 *   dagger  fast forward stab; short reach, narrow cone, crit-fishing
 *   sword   balanced diagonal slash; medium reach + cone
 *   hammer  slow overhead smash; long reach, wide cone, no crits
 */
export type WeaponClass = 'dagger' | 'sword' | 'hammer';

/** Combat stats — only set on items that are weapons. */
export interface WeaponStats {
  /** Max melee reach in meters (camera-to-enemy distance). */
  reach: number;
  /** Forward arc half-angle in radians that registers as a hit. */
  coneHalfAngle: number;
  /** Damage per successful strike (before equipment bonuses). */
  damage: number;
  /** Probability [0,1] each landed hit crits. Default 0.05. */
  critChance?: number;
  /** Damage multiplier on crit. Default 2.0. */
  critMultiplier?: number;
  /**
   * Weapon class — picks the animation combo (stab→slash→stab-stab
   * for daggers, single slash for swords, single smash for hammers)
   * and seeds the per-step timings + combo window. Default 'sword'.
   */
  class?: WeaponClass;
  /**
   * Multiplier applied to all combo-step timings after the class
   * defaults resolve. 1.0 = baseline, 1.2 = 20% faster (smaller
   * timings), 0.8 = slower. Proficiency points feed in alongside it.
   */
  attackSpeed?: number;
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
  /**
   * Affix pool — ids into AFFIXES (src/content/affixes.ts). Every
   * pickup instance rolls up to `maxAffixes` of these by weight (see
   * rollAffixes). Omit on items that should never be affix-rolled.
   */
  affixPool?: string[];
  /** Max affixes that can roll on a single instance. Default 0 (no
   *  affixes). Recommended 1–2 to keep variance readable. */
  maxAffixes?: number;
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
    weapon: { class: 'sword', reach: 1.8, coneHalfAngle: 0.65, damage: 1, critChance: 0.05, critMultiplier: 2.0 },
    affixPool: ['keening', 'gallows', 'spine'],
    maxAffixes: 1,
  },
  scimitar: {
    id: 'scimitar',
    kind: 'weapon',
    rarity: 'uncommon',
    name: 'A scimitar, curved and stained',
    flavor: 'Made for those who would not be patient.',
    dropModel: WEAPON_SCIMITAR,
    viewmodel: WEAPON_SCIMITAR,
    weapon: { class: 'sword', reach: 2.2, coneHalfAngle: 0.85, damage: 2, critChance: 0.10, critMultiplier: 2.0 },
    affixPool: ['keening', 'gallows', 'vile', 'patience'],
    maxAffixes: 2,
  },
  // ── STARTER WEAPONS ───────────────────────────────────────────────
  // Three starter alternatives offered in the diegetic starter chamber
  // at the top of every fresh run. Each defines a distinct early-game
  // playstyle. Stats are tuned so all three are viable at depth 1 but
  // each rewards a different combat instinct:
  //   needle → fast precise crit-fishing (squishy weapon, needs care)
  //   sword  → balanced baseline (the rusted shortsword above)
  //   maul   → slow heavy punish-on-read (wide cone catches multiples)
  'bone-needle': {
    id: 'bone-needle',
    kind: 'weapon',
    rarity: 'mundane',
    name: 'A bone needle',
    flavor: 'Thin enough to fit between ribs.',
    dropModel: BONE_NEEDLE,
    viewmodel: BONE_NEEDLE,
    // Short reach, narrow cone, low base damage — but the highest crit
    // chance + multiplier in the starting roster. Skirts trash mobs
    // by repeated strikes; struggles against armoured targets unless
    // you land crits.
    weapon: { class: 'dagger', reach: 1.5, coneHalfAngle: 0.55, damage: 1, critChance: 0.25, critMultiplier: 2.5 },
    affixPool: ['keening', 'gallows', 'spine'],
    maxAffixes: 1,
  },
  'iron-maul': {
    id: 'iron-maul',
    kind: 'weapon',
    rarity: 'mundane',
    name: 'An iron maul',
    flavor: 'It does not require finesse.',
    dropModel: IRON_MAUL,
    viewmodel: IRON_MAUL,
    // Long reach, wide cone, high base damage, ZERO crit chance — the
    // damage is dependable, not lucky. Catches multiple mobs in one
    // swing (the wide cone) so a careless ooze-killer can still
    // contain the split. Slow swing timings live elsewhere if we
    // ever wire per-weapon attack timings; for now the base sword
    // cadence applies.
    weapon: { class: 'hammer', reach: 2.0, coneHalfAngle: 0.85, damage: 2, critChance: 0, critMultiplier: 1 },
    affixPool: ['gallows', 'spine', 'patience'],
    maxAffixes: 1,
  },
  heartburn: {
    id: 'heartburn',
    kind: 'weapon',
    rarity: 'fabled',
    name: 'Heartburn',
    flavor: 'The blade was never quenched.',
    dropModel: HEARTBURN,
    viewmodel: HEARTBURN,
    weapon: { class: 'sword', reach: 2.3, coneHalfAngle: 0.9, damage: 3, critChance: 0.22, critMultiplier: 2.5, attackSpeed: 1.15 },
    affixPool: ['vile', 'patience', 'gallows', 'keening', 'spine'],
    maxAffixes: 2,
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
    affixPool: ['cinder', 'salt', 'spine', 'patience'],
    maxAffixes: 1,
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
    affixPool: ['cinder', 'spine'],
    maxAffixes: 1,
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
  // ── OFFHAND ────────────────────────────────────────────────────────
  // The lamp is the player's default offhand. Equipping a shield (or any
  // other offhand item) removes the lamp's light — that's the design
  // tradeoff: visibility vs defence. The handheld viewmodel + the
  // PointLight registration live in src/player/handheld-lamp.ts; the
  // model here is the floor / inventory silhouette only.
  'oil-lamp': {
    id: 'oil-lamp',
    kind: 'offhand',
    rarity: 'mundane',
    name: 'An oil lamp',
    flavor: 'The flame is your only friend down here.',
    dropModel: OIL_LAMP_MODEL,
  },
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
  // ── BLOOD-ALTAR OFFERINGS ─────────────────────────────────────────
  // Cursed items with REAL downsides — what you get for paying HP at
  // a blood altar. Each trades raw flesh (max-hp) for a meaningful
  // combat advantage. Model reuses an existing ring silhouette; the
  // cursed-violet rarity tint on pickup is the visual giveaway.
  'ring-of-marrow': {
    id: 'ring-of-marrow',
    kind: 'ring',
    rarity: 'cursed',
    name: 'A bone-set ring',
    flavor: 'It carved the wearer for the wearer.',
    dropModel: RING_OF_FRENZY,
    modifiers: [
      { kind: 'weapon-damage', amount: 2 },
      { kind: 'max-hp', amount: -1 },
    ],
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

