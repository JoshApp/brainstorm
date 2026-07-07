import type { ModelSpec } from '../ecs/model-types';
import { CONFIG } from '../config';
import type { StatModifier } from '../combat/modifiers';
import type { PassiveSpec } from '../ecs/types';
import type { AttributeKind } from '../state/character';
import { SWORD_RUSTED } from './sword';
import { SKELETON_KEY } from './skeleton-key';
import { WEAPON_SCIMITAR, HEARTBURN, BONE_NEEDLE, IRON_MAUL, SPEAR, CROSSBOW, WAND } from './weapons';
import { REAPERS_TOLL, PENITENTS_CHAIN, CORD_OF_KNIVES, BENT_SICKLE, PILGRIMS_PIKE } from './new-weapons';
import {
  HEALING_POTION, FLASK_DRAUGHT, FLASK_SHARD, RING_OF_VIGOR, RING_OF_PREDATION, RING_OF_BLOODTHIRST,
  RING_OF_FRENZY, TATTERED_CLOAK, BERSERK_POTION,
  IRON_COIF, BONE_AMULET, ACID_TONGUE_AMULET, LEATHER_GLOVES, WORN_BOOTS, WOODEN_SHIELD,
  OIL_LAMP_MODEL,
  // Content expansion — new equipment models.
  PENITENTS_ROBE, CUIRASS_OF_ASH,
  HERETICS_HOOD, SKULLCAP_HANGED,
  GRAVECUTTER_GAUNTLETS, VELLUM_WRAPS,
  SHROUD_STEP_BOOTS, SIN_EATER_SANDALS,
  SPLINTERED_AEGIS,
  MENDICANT_LOCKET, HEART_OF_DROWNED,
  RING_OF_IRON, RING_OF_EMBER, RING_OF_QUICKENING,
  STEADY_TONIC,
  MURKY_PHIAL, BLACK_PHIAL, PALE_PHIAL,
} from './loot-models';
import { PASSIVES } from './passives';

// Item registry. An ItemSpec is the canonical definition of a thing the
// player can collect: kind, display name, drop model, optional viewmodel
// (weapons), optional combat stats (weapons), optional stat modifiers
// (rings/armor).

export type ItemKind = 'weapon' | 'armor' | 'ring' | 'consumable'
                     | 'helmet' | 'amulet' | 'gloves' | 'boots' | 'offhand'
                     // 'key' — carried, not worn or drunk: spent by locked
                     // things (reliquaries). Counted in inventory like a
                     // consumable but never appears on the consumable bar.
                     | 'key';

/**
 * Rarity tiers — atmospheric grimdark naming over the standard ARPG palette.
 * Drives the colored border / name tint in the inventory panel and the
 * floor-pickup glow color. Higher rarity = stronger / more numerous effects.
 */
export type Rarity = 'mundane' | 'uncommon' | 'rare' | 'cursed' | 'fabled';

/** Rarity tiers in ascending "richness" order — the axis the loot roller
 *  walks (step down to a lower tier when a rolled rarity has nothing
 *  eligible yet). Cursed sits above rare as a rarer risk/reward tier. */
export const RARITY_ORDER: readonly Rarity[] = ['mundane', 'uncommon', 'rare', 'cursed', 'fabled'];

/** Hex colors per rarity — atmospheric warm-cool palette, not gaudy RGB. */
export const RARITY_COLORS: Record<Rarity, number> = {
  mundane:  0xa09080,  // bone gray — the default; visible but unimportant
  uncommon: 0x70bb70,  // sickly green — slightly elevated, lichen-tinged
  rare:     0x6a96e2,  // pale blue — moonlight, distinctly other
  cursed:   0xc05bd6,  // muted violet — something is wrong with this
  fabled:   0xe6a335,  // amber-gold — heirloom, named, story-bearing
};

/**
 * The MECHANICAL meaning of rarity: how many affixes an instance of this
 * rarity rolls, and how likely each successive affix is to land
 * (continueChance, see rollAffixes). Higher rarity → more affixes, more
 * reliably. This is what makes a "rare" drop genuinely better than a
 * "mundane" one rather than just a different border colour.
 *
 * A spec's explicit maxAffixes still overrides maxAffixes here (author
 * intent wins on hand-tuned items); the continueChance always comes from
 * rarity. Cursed sits beside rare on the budget (it's a sidegrade tier,
 * powerful-but-flawed, not strictly above rare).
 */
export const RARITY_AFFIX_BUDGET: Record<Rarity, { maxAffixes: number; continueChance: number }> = {
  mundane:  { maxAffixes: 1, continueChance: 0.25 },
  uncommon: { maxAffixes: 2, continueChance: 0.45 },
  rare:     { maxAffixes: 2, continueChance: 0.70 },
  cursed:   { maxAffixes: 2, continueChance: 0.65 },
  fabled:   { maxAffixes: 3, continueChance: 0.85 },
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
export type WeaponClass =
  | 'fist'
  | 'dagger' | 'sword' | 'hammer' | 'spear'
  | 'crossbow' | 'wand'
  | 'scythe' | 'whip' | 'throwing-knives';

/** Attribute scaling grade — S best, D weakest. Coefficients per point
 *  live in CONFIG.ATTR.SCALING_GRADE. */
export type ScalingGrade = 'S' | 'A' | 'B' | 'C' | 'D';

/** A weapon's attribute scaling: which attributes drive its damage and
 *  how hard. Usually one entry (its family stat); hybrids set two. */
export type WeaponScaling = Partial<Record<AttributeKind, ScalingGrade>>;

/** What a weapon class's PROFICIENCY (use-based mastery) improves, as a
 *  per-point amount. Each class picks the few that fit its identity
 *  (PROFICIENCY_PROFILE_BY_CLASS in weapon-classes.ts) — e.g. daggers
 *  get speed+crit, hammers get stagger+damage (NOT speed, which would
 *  un-heavy them). A weapon can override its class default. All but
 *  `crit` are fractions (0.005 = +0.5%/pt); the %-ish ones share the
 *  proficiency cap. */
export interface ProficiencyProfile {
  speed?: number;        // shortens windup/recover (tempo)
  damage?: number;       // +weapon damage
  stagger?: number;      // +stagger power (poise break)
  crit?: number;         // +crit chance (flat per point)
  comboWindow?: number;  // +combo-window forgiveness
  reach?: number;        // +reach
}

/** Combat stats — only set on items that are weapons. */
/**
 * A COMBAT VERB — an effect an item fires on a combat EVENT (a riposte, a
 * perfect dodge, an empowered hit). The authoring surface the content layer
 * writes against to make weapons FEEL distinct on the reactive game: a serrated
 * blade that BLEEDS on riposte, a duelist's rapier that HASTES you on a perfect
 * dodge, a cruel edge that POISONS harder on the empowered follow-up.
 *
 * Buff-based today (reuses the status system in content/buffs.ts), so a verb is
 * "apply this buff to self or to the foe". The shape leaves room for richer
 * effect kinds later (heal, stamina, projectile) without breaking authored data.
 */
export interface CombatVerb {
  /** Status buff to apply when the verb fires (an id from content/buffs.ts). */
  buffId: string;
  /** Buff duration in seconds. */
  duration: number;
  /** Who it lands on. 'enemy' = the foe in the event, 'self' = the player.
   *  Omitted → the hook's natural default (riposte/empowered-hit → enemy,
   *  perfect-dodge → self). */
  target?: 'self' | 'enemy';
  /** Roll [0,1] each time the event fires; omitted = always. */
  chance?: number;
}

/** A multi-hit FLURRY — one attack lands `count` fast strikes, each dealing
 *  `damageMul` of the weapon's resolved damage, `interval` seconds apart. Every
 *  sub-hit rolls crit + on-hit procs INDEPENDENTLY, which is the dagger
 *  identity: more rolls = more value from on-crit / on-hit / %-effects, traded
 *  against weak per-hit damage + poise. */
export interface FlurrySpec {
  count: number;       // number of sub-hits
  interval: number;    // seconds between sub-hits
  damageMul: number;   // each sub-hit's fraction of weapon damage
}

/** Per-weapon OVERRIDE for one combo step's damage shaping — patched over the
 *  weapon CLASS (archetype) combo by index. Lets a specific weapon retune the
 *  per-hit damage % / poise / flurry without redefining the whole move. Omit a
 *  field to inherit the archetype's value; omit an index to leave that step. */
export interface ComboStepTuning {
  damageMul?: number;
  staggerMul?: number;
  hits?: FlurrySpec;
}

export interface WeaponStats {
  /** Max reach in metres (camera-to-enemy distance). For MELEE, OMIT this —
   *  it's DERIVED from the weapon model's blade extent by the pass at the bottom
   *  of this file (so the hit tracks the visible blade). Set it explicitly only
   *  where reach intentionally exceeds the held model: the WHIP (cracks far past
   *  its cord) and RANGED weapons (projectile range). */
  reach?: number;
  /** Per-weapon nudge on the DERIVED melee reach (default 1). For a blade that
   *  should bite a hair further/closer than its model implies — a tweak on a
   *  synced base, not a free number. Ignored when `reach` is set explicitly. */
  reachMul?: number;
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
  /** Per-weapon override of the class combo's per-step damage shaping
   *  (damage % / poise % / flurry), patched over the archetype by index. The
   *  archetype (WEAPON_CLASS_DEFAULTS) sets the baseline; this lets one weapon
   *  differ — e.g. a heavier dagger that hits 0.6 per stab instead of 0.45. */
  comboTuning?: ComboStepTuning[];
  /**
   * Multiplier applied to all combo-step timings after the class
   * defaults resolve. 1.0 = baseline, 1.2 = 20% faster (smaller
   * timings), 0.8 = slower. Proficiency points feed in alongside it.
   */
  attackSpeed?: number;
  /**
   * Attribute SCALING grades (Souls/WC3-style). Maps an attribute to a
   * letter grade; the player's points in that attribute multiply this
   * weapon's damage by grade-coeff·points (CONFIG.ATTR.SCALING_GRADE).
   * Omitted → resolveWeaponStats applies the per-class default
   * (DEFAULT_WEAPON_SCALING in weapon-classes.ts): heavy→Might,
   * light/ranged→Finesse, wand→Lore, all grade B. Set explicitly on
   * named/fabled weapons (or LLM-authored ones) for harder or hybrid
   * scaling — e.g. `{ lore: 'A', finesse: 'C' }` for a hexed blade.
   */
  scaling?: WeaponScaling;
  /**
   * Stagger power per hit BEFORE Might scaling — how hard this weapon
   * chips enemy poise (see the poise system in mobs/enemy.ts). Omitted →
   * the per-class default (STAGGER_POWER_BY_CLASS in weapon-classes.ts:
   * heavy weapons high, light/ranged low). Set explicitly for a weapon
   * that punches above or below its class weight.
   */
  staggerPower?: number;
  /**
   * Lateral SWING-ARC width override — fraction of a swing pose's SIDEWAYS
   * deviation (x / rotY / rotZ) the viewmodel keeps. 1 = the full authored arc;
   * <1 narrows it so a wide swing doesn't wrap almost behind the player
   * (forward depth + pitch untouched, so reach/thrusts are unaffected). Omitted
   * → the per-CLASS default (swingArc in weapon-classes.ts). Set on a weapon
   * whose swing should be tighter or wider than its class.
   */
  swingArc?: number;
  /**
   * Override what this weapon's class proficiency improves (per-point
   * amounts). Omitted → the per-class default
   * (PROFICIENCY_PROFILE_BY_CLASS in weapon-classes.ts). A merge:
   * unspecified keys fall back to the class default.
   */
  proficiency?: ProficiencyProfile;
  /**
   * On-hit status infliction. When set, a landed hit rolls `chance` and,
   * on success, applies the buff (a status effect from content/buffs.ts)
   * to the struck enemy for `duration` seconds. This is how a serrated
   * blade bleeds or a venom-etched dagger poisons. Stacking statuses
   * (bleed/poison) build with repeated hits.
   */
  onHit?: { buffId: string; chance: number; duration: number };
  /**
   * RANGED weapon. When set, the weapon FIRES this projectile at the
   * auto-target on its strike instead of doing a melee cone hit. The
   * weapon's class (crossbow/wand) provides the slow draw/reload
   * cadence — the constraint that keeps ranged from obsoleting melee.
   *
   * `count` + `spread` make multi-projectile fan weapons (throwing
   * knives): on each strike, `count` projectiles spawn with their
   * aim direction rotated by ±`spread` radians around the centre.
   * Default count = 1 (single shot, like crossbow / wand).
   *
   * See docs/WEAPONS.md.
   */
  ranged?: { projectileId: string; count?: number; spread?: number };
  /**
   * Signature CHARGED-ATTACK effect. When set, a swing released with
   * charge progress at or above `minCharge` (default 0.7) triggers
   * this effect on top of the normal melee resolution. Lets specific
   * weapons FEEL different — a Howling Edge sword fires a wave of
   * force forward on a fully charged release; a vampiric blade could
   * lifesteal on charged hits; a stormhammer could detonate an AoE.
   *
   * Kinds today:
   *   projectile — spawn a friendly projectile flying forward from
   *                the player along the camera direction. Adds the
   *                weapon's full damage to the projectile's payload.
   *
   * Future kinds: 'aoe' (radial blast), 'lifesteal' (heal on charged
   * hit), 'cleave' (a free second swing). Keep the discriminator open
   * so we can layer new effects without breaking the field shape.
   */
  chargedEffect?:
    | { kind: 'projectile'; projectileId: string; minCharge?: number; damageMul?: number };
  /**
   * Poise this weapon's PARRY chips on a clean catch. Omitted → the global
   * default (CONFIG.DEFLECT.POISE_DAMAGE). Authored per weapon so a heavy
   * guard-breaker parries toward a stagger far faster than a light blade — what
   * a parry DOES is the weapon's, not a fixed number.
   */
  parryPoise?: number;
  /** Verb fired when a PARRY connects (the riposte) — defaults to the foe. */
  onRiposte?: CombatVerb;
  /** Verb fired when a perfectly-timed dodge lands — defaults to the player. */
  onPerfectDodge?: CombatVerb;
  /** Verb fired when a hit lands inside the deflect-empower window (the
   *  empowered light riposte) — defaults to the foe. */
  onEmpoweredHit?: CombatVerb;
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
   * On-hit status applied to anything the player strikes while this item
   * is equipped. Pairs with the existing weapon.onHit (weapons carry
   * their own intrinsic onHit) — this slot lets ARMOUR / AMULETS / RINGS
   * grant on-hit effects too. Aggregated through getPlayerOnHits() and
   * rolled per swing in combat/attack.ts. Example: the Acid Tongue
   * amulet rolls a poison chance on each melee hit.
   */
  onHit?: { buffId: string; chance: number; duration: number };
  /**
   * Stat modifiers applied while this item is equipped. Goes through the
   * unified modifier pipeline in src/combat/modifiers.ts — same shape
   * that buffs and other effect sources use, so synergies just work.
   */
  modifiers?: StatModifier[];
  /**
   * State-aware modifiers — apply only while their condition holds.
   * Evaluated per modifier-pipeline pass (which is cheap, just walks
   * equipped slots). Lets items express the berserker fantasy ("when
   * below 30% HP, +1 weapon damage") and last-stand effects ("below
   * 25% HP, +1 incoming damage reduction") without needing a new
   * trigger event for HP threshold crossings.
   */
  conditionalModifiers?: Array<{
    condition: { kind: 'below-hp-pct'; value: number }
             | { kind: 'above-hp-pct'; value: number };
    modifiers: StatModifier[];
  }>;
  /**
   * Triggered passives granted while this item is equipped. Same pipeline
   * as intrinsic player passives — trigger fires on the listed event,
   * effects apply. Lets a ring grant "on kill → apply X buff" without
   * mutating the player entity's passives array.
   */
  passives?: PassiveSpec[];
  /** For consumables: how much HP to restore on use (single-use). LEGACY —
   *  the flask (player/flask.ts) is the heal economy now; this survives only
   *  for old saves still carrying `healing-potion`. */
  consumableHeal?: number;
  /** For consumables: pour into the flask — restore this many CHARGES
   *  (clamped to capacity; withheld at a full flask). The refill draught. */
  consumableFlaskCharges?: number;
  /** For consumables: fuse into the flask — grow capacity by this many
   *  charges, arriving filled. The flask shard (rare, gated). */
  consumableFlaskCapacity?: number;
  /** For consumables: apply this buff to the player on use. */
  consumableBuff?: { buffId: string; duration: number };
  /** For consumables: drinking applies the PERMANENT run mutation this
   *  phial color maps to (state/phial-identities.ts — identity is
   *  per-run, unknown until first taste, consistent after). */
  consumableMutation?: boolean;
  /** For consumables: the most the player may CARRY at once. Pickups beyond
   *  this are refused (left on the ground); the hotbar shows the stack full.
   *  Omit for no cap. Souls-style scarcity — a finite heal economy per run. */
  carryLimit?: number;
  /**
   * Affix pool — ids into AFFIXES (src/content/affixes.ts). Every
   * pickup instance rolls up to `maxAffixes` of these by weight (see
   * rollAffixes). Omit on items that should never be affix-rolled.
   */
  affixPool?: string[];
  /** Max affixes that can roll on a single instance. Overrides the
   *  rarity budget (RARITY_AFFIX_BUDGET) when set; otherwise rarity
   *  decides. Recommended 1–2 to keep variance readable. */
  maxAffixes?: number;
  /** Set membership — id into SETS (src/content/sets.ts). Equipping
   *  enough pieces of the same set activates that set's threshold
   *  bonuses. Omit on items that belong to no set. */
  setId?: string;
  /**
   * Generic-loot distribution metadata — how this item flows through the
   * central loot roller (src/content/loot.ts). Controls WHERE and HOW
   * OFTEN it appears as a drop. Omit for sensible defaults (drops from
   * depth 1, weight 1).
   */
  drop?: {
    /** Earliest depth this can appear from a generic loot roll. Gates
     *  powerful items out of the early floors. Default 1. */
    minDepth?: number;
    /** Relative weight within its rarity band when the roller has picked
     *  that rarity. Default 1. Bump for "common" basics (potions), drop
     *  for things that should be a rarer sight within their tier. */
    weight?: number;
    /** If true, NEVER appears in generic loot rolls — reserved for
     *  starter altars or hand-placed/quest items distributed deliberately.
     *  Default false. */
    noDrop?: boolean;
    /** UNIQUE-POOL membership. When set, this item is EXCLUSIVE to the named
     *  pool (e.g. 'boss', 'cursed') — it never appears in a generic drop, and
     *  ONLY rollPool('boss') / rollLoot({pool:'boss'}) can yield it. The pool's
     *  roll params (bias, rarity floor, category) live in loot-pools.ts, so a
     *  boss item just tags itself here and the manager decides how it drops. */
    pool?: string;
  };
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
    weapon: { class: 'sword', coneHalfAngle: 0.80, damage: 1, critChance: 0.05, critMultiplier: 2.0 },
    affixPool: ['keening', 'gallows', 'spine', 'searing', 'hoarfrost'],
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
    // A cold bite — chance to CHILL on hit (slows the target's movement +
    // attacks). Turns the scimitar into a control weapon: chill a charger
    // mid-rush, or buy spacing against a swarm.
    weapon: {
      class: 'sword', coneHalfAngle: 0.85, damage: 2, critChance: 0.10, critMultiplier: 2.0,
      onHit: { buffId: 'chill', chance: 0.4, duration: 2.5 },
      // The curved, stained edge CARVES on a parry — catch a blow and the
      // riposte opens a bleed. (Authoring example for the onRiposte verb.)
      onRiposte: { buffId: 'bleed', duration: 4 },
    },
    affixPool: ['keening', 'gallows', 'vile', 'patience', 'rending', 'serration'],
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
    // Serrated edge — every hit has a chance to BLEED, and bleed stacks,
    // so the needle's rapid combo ramps it fast. Turns its low base
    // damage into sustained pressure: the fast-weapon payoff.
    weapon: {
      // Reach bumped 1.5 → 1.85 so after the global 20% melee cut it lands at
      // ~1.48 (≈ its pre-cut feel) — a dagger is already short, the cut left it
      // too short to connect. Effectively exempt from the cut, which it didn't
      // need (it never had "too much range").
      class: 'dagger', coneHalfAngle: 0.55, damage: 1, critChance: 0.25, critMultiplier: 2.5,
      onHit: { buffId: 'bleed', chance: 0.5, duration: 3 },
    },
    affixPool: ['keening', 'gallows', 'spine', 'serration', 'venom'],
    maxAffixes: 1,
    setId: 'ossuary',
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
    // Crushing blows SUNDER armour — a chance to make the target take
    // +35% damage for a few seconds. The maul's payoff: it doesn't crit,
    // but it softens whatever it hits for everything that follows
    // (your next swings, a bleed, an ally-less combo).
    weapon: {
      class: 'hammer', reachMul: 1.18, coneHalfAngle: 0.85, damage: 3, critChance: 0, critMultiplier: 1,
      onHit: { buffId: 'sunder', chance: 0.5, duration: 4 },
      // A maul's parry is a GUARD-BREAK: it chunks far more poise than a light
      // blade (default 2), so a heavy-weapon player staggers on the read.
      // (Authoring example for the per-weapon parryPoise.)
      parryPoise: 4,
    },
    affixPool: ['gallows', 'spine', 'patience', 'rending', 'searing'],
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
    // Never quenched — every strike has a good chance to set the target
    // alight (burn: bursty fire DoT). The fabled fire blade lives up to
    // its name.
    weapon: {
      class: 'sword', coneHalfAngle: 0.9, damage: 3, critChance: 0.22, critMultiplier: 2.5, attackSpeed: 1.15,
      onHit: { buffId: 'burn', chance: 0.6, duration: 2.5 },
    },
    affixPool: ['vile', 'patience', 'gallows', 'keening', 'spine', 'searing', 'venom'],
    maxAffixes: 2,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'damage-multiplier', amount: 1.15 },
    ],
    // A prototype power-piece — burn + crit + flat dmg + multiplier stacked.
    // Gate it deep (Act III) so it can't drop casually on the early floors;
    // its fabled rarity already makes it a once-in-a-run event, this makes
    // it a DEEP once-in-a-run event.
    drop: { minDepth: 8, weight: 0.6 },
  },
  // Howling Edge — fabled sword whose CHARGED RELEASE launches a
  // wave of cutting force forward. Tap-and-tap plays like a normal
  // sword; the magic appears the moment you hold to charge. Teaches
  // players that the charge gesture isn't just "+damage" — some
  // weapons rewrite it into a signature mechanic.
  'howling-edge': {
    id: 'howling-edge',
    kind: 'weapon',
    rarity: 'fabled',
    name: 'Howling Edge',
    flavor: 'The blade screams when it remembers.',
    dropModel: HEARTBURN,        // reuse the fabled sword model for V1 — distinct mesh comes later
    viewmodel: HEARTBURN,
    weapon: {
      class: 'sword', coneHalfAngle: 0.85, damage: 3, critChance: 0.18, critMultiplier: 2.4, attackSpeed: 1.10,
      // Charged release fires the wave-slash projectile. Requires at
      // least 60% charge — players quickly learn the moment to release.
      // The projectile carries 1.5× the weapon's base damage; the
      // standard charge multiplier still applies on top in attack.ts.
      chargedEffect: { kind: 'projectile', projectileId: 'wave-slash', minCharge: 0.6, damageMul: 1.5 },
    },
    affixPool: ['vile', 'patience', 'gallows', 'keening', 'spine', 'searing'],
    maxAffixes: 2,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
    ],
    // Signature charged mechanic + fabled stats — a BOSS weapon now: it drops
    // ONLY from the 'boss' pool (loot-pools.ts), never a generic chest. Gate to
    // late Act II so the boss that carries it is deep enough to have earned it.
    drop: { minDepth: 7, weight: 1, pool: 'boss' },
  },
  // ── REACH MELEE ───────────────────────────────────────────────────
  // The in-between weapon. Melee, but its long reach lets it strike from
  // outside enemy range — spacing is the skill, not crit-fishing or
  // wide-cone crowd control. Narrow cone (it pokes, doesn't sweep).
  spear: {
    id: 'spear',
    kind: 'weapon',
    rarity: 'uncommon',
    name: 'A pitted spear',
    flavor: 'Kept the careless at a distance, once.',
    dropModel: SPEAR,
    viewmodel: SPEAR,
    // Long reach, narrow cone, modest damage. Puncture wounds BLEED —
    // the reach weapon's pressure tool: poke, retreat, let the stacks
    // work while you keep spacing.
    weapon: {
      class: 'spear', reachMul: 1.20, coneHalfAngle: 0.42, damage: 2, critChance: 0.12, critMultiplier: 2.2,
      onHit: { buffId: 'bleed', chance: 0.4, duration: 3 },
    },
    affixPool: ['keening', 'gallows', 'patience', 'spine', 'serration', 'venom'],
    maxAffixes: 2,
  },
  // ── MUNDANE BASE WEAPONS (starter-pool fodder) ─────────────────────
  // Plain, honest tools. No on-hit, modest stats — distinct FEEL is the
  // identity (reach, sweep), not power. These widen the starter roll.
  'bent-sickle': {
    id: 'bent-sickle',
    kind: 'weapon',
    rarity: 'mundane',
    name: 'A bent sickle',
    flavor: 'Curved for the harvest. The harvest was never wheat.',
    dropModel: BENT_SICKLE,
    viewmodel: BENT_SICKLE,
    weapon: {
      // Scythe class — wide cone catches a clutch of small things at once.
      // Low damage; the sweep IS the value. The swarm-clearer starter.
      class: 'scythe', reachMul: 1.10, coneHalfAngle: 0.95, damage: 1, critChance: 0.08, critMultiplier: 2.2,
    },
    affixPool: ['keening', 'gallows', 'serration', 'spine'],
    maxAffixes: 1,
  },
  'pilgrims-pike': {
    id: 'pilgrims-pike',
    kind: 'weapon',
    rarity: 'mundane',
    name: "A pilgrim's pike",
    flavor: 'Pitted iron on an ashen haft. Keeps things at arm’s length — for a while.',
    dropModel: PILGRIMS_PIKE,
    viewmodel: PILGRIMS_PIKE,
    weapon: {
      // Spear class — long reach, narrow cone. Poke and retreat; the
      // spacing starter. Mundane: no bleed, just distance.
      class: 'spear', reachMul: 1.18, coneHalfAngle: 0.42, damage: 1, critChance: 0.06, critMultiplier: 2.2,
    },
    affixPool: ['keening', 'gallows', 'patience', 'spine'],
    maxAffixes: 1,
  },
  // ── RANGED WEAPONS ────────────────────────────────────────────────
  // The main-hand ranged class. A ranged weapon's `ranged.projectileId`
  // makes attack.ts fire a bolt instead of swinging a cone. The cadence
  // constraint (slow recover = reload, set in weapon-classes.ts) is what
  // keeps ranged from obsoleting melee — you get one shot, then a beat
  // of vulnerability. Auto-target cone + tap-target focus do the aiming
  // so it stays one-thumb. See docs/WEAPONS.md.
  crossbow: {
    id: 'crossbow',
    kind: 'weapon',
    rarity: 'uncommon',
    name: 'A heavy crossbow',
    flavor: 'Patience, then a single certainty.',
    dropModel: CROSSBOW,
    viewmodel: CROSSBOW,
    // Physical bolt — respects armour, so it's a clean damage check, not
    // a finesse weapon. High base damage to reward the slow reload; the
    // reach/cone fields are vestigial for a ranged weapon (the bolt
    // hit-tests in projectile-pool) but kept for the target-pick cone.
    weapon: {
      class: 'crossbow', reach: 16, coneHalfAngle: 0.6, damage: 4, critChance: 0.15, critMultiplier: 2.5,
      ranged: { projectileId: 'crossbow-bolt' },
    },
    affixPool: ['keening', 'gallows', 'patience', 'spine', 'searing', 'rending'],
    maxAffixes: 2,
  },
  wand: {
    id: 'wand',
    kind: 'weapon',
    rarity: 'rare',
    name: 'A wand of cold fire',
    flavor: 'It asks nothing and gives less.',
    dropModel: WAND,
    viewmodel: WAND,
    // Arcane bolt — MAGIC damage, bypasses physical armour, so it's the
    // answer to plated targets the crossbow struggles with. Lower base
    // than the crossbow (armour-bypass is the payoff) but a touch faster
    // recover lives in weapon-classes. Chance to chill on hit — the
    // caster's control tool.
    weapon: {
      class: 'wand', reach: 16, coneHalfAngle: 0.6, damage: 3, critChance: 0.12, critMultiplier: 2.0,
      ranged: { projectileId: 'arcane-bolt' },
      onHit: { buffId: 'chill', chance: 0.3, duration: 2.5 },
    },
    affixPool: ['vile', 'keening', 'patience', 'gallows', 'hoarfrost', 'venom'],
    maxAffixes: 2,
  },
  // ── NEW MELEE WEAPONS ─────────────────────────────────────────────
  // Three classes added alongside the existing roster. Each ships
  // with its mechanics + moveset; signature effects (lifesteal on
  // scythe, pull on whip) land in a follow-up pass.
  'reapers-toll': {
    id: 'reapers-toll',
    kind: 'weapon',
    rarity: 'rare',
    name: "Reaper's Toll",
    flavor: 'It harvests what little is left.',
    dropModel: REAPERS_TOLL,
    viewmodel: REAPERS_TOLL,
    weapon: {
      // Scythe: very wide cone, multi-target, moderate damage. Wades
      // into swarms. The reap-vs-spin alternation is the rhythm.
      class: 'scythe', reachMul: 1.10, coneHalfAngle: 1.05, damage: 2, critChance: 0.10, critMultiplier: 2.2,
    },
    affixPool: ['vile', 'gallows', 'keening', 'patience'],
    maxAffixes: 1,
  },
  'penitents-chain': {
    id: 'penitents-chain',
    kind: 'weapon',
    rarity: 'rare',
    name: "Penitent's Chain",
    flavor: 'The discipline of distance.',
    dropModel: PENITENTS_CHAIN,
    viewmodel: PENITENTS_CHAIN,
    weapon: {
      // Whip: long reach, narrow cone, snappy. The space-controller.
      class: 'whip', reach: 3.4, coneHalfAngle: 0.40, damage: 2, critChance: 0.12, critMultiplier: 2.3,
      onHit: { buffId: 'bleed', chance: 0.30, duration: 2.5 },
    },
    affixPool: ['keening', 'spine', 'gallows', 'serration'],
    maxAffixes: 1,
  },
  'cord-of-knives': {
    id: 'cord-of-knives',
    kind: 'weapon',
    rarity: 'rare',
    name: 'A cord of knives',
    flavor: 'Throw them all. Carry the rope.',
    dropModel: CORD_OF_KNIVES,
    viewmodel: CORD_OF_KNIVES,
    weapon: {
      // Throwing knives: fan of 3 projectiles per release, modest
      // damage per knife. Coverage rather than precision; the
      // damage spread is the identity. Spread = ±0.18 rad ≈ 10°
      // total cone of arrival.
      class: 'throwing-knives', reach: 12, coneHalfAngle: 0.6, damage: 2, critChance: 0.15, critMultiplier: 2.0,
      ranged: { projectileId: 'crossbow-bolt', count: 3, spread: 0.18 },
    },
    affixPool: ['keening', 'serration', 'spine'],
    maxAffixes: 1,
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
    setId: 'pauper',
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
    setId: 'ossuary',
  },
  // Boss-unique drop from The Boiling King (Act III). Cut from the
  // slime's core — still glistening, still warm. Equipping it
  // gives every melee swing a chance to inflict poison on the
  // target, plus a small magic-armor bump because acid eats
  // chemistry both ways.
  'acid-tongue': {
    id: 'acid-tongue',
    kind: 'amulet',
    rarity: 'fabled',
    name: 'Acid Tongue',
    flavor: 'Cut from something that had eaten kings.',
    dropModel: ACID_TONGUE_AMULET,
    modifiers: [
      { kind: 'magic-armor', amount: 1 },
    ],
    // 30% chance to apply 2 stacks of poison (4s duration) on a melee
    // hit. Pairs with the existing combat:hit pipeline that reads
    // playerOnHits and rolls per swing.
    onHit: { buffId: 'poison', chance: 0.30, duration: 4.0 },
    // Boss-signature: distributed by the Boiling King, never from a generic
    // chest/kill roll.
    drop: { noDrop: true },
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
    setId: 'pauper',
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
    setId: 'pauper',
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
    // The player starts with one; a duplicate is near-useless. Keep it out
    // of generic loot rolls (it's granted at run start / hand-placed).
    drop: { noDrop: true },
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
  // ── SHARP-TRADE CURSED ITEMS ──────────────────────────────────────
  // The risk/reward spine: each is a real power spike bought with a real
  // wound. You feel both halves. They roll from the cursed band (rare —
  // content/loot.ts) and read violet on the floor, so taking one is always
  // a knowing choice. Gated to mid-game (drop.minDepth) — a curse is a
  // commitment, not a floor-1 freebie. Flat modifiers (the negatives are
  // the bite); weapons inherit default attribute scaling.
  gravewake: {
    id: 'gravewake',
    kind: 'weapon',
    rarity: 'cursed',
    name: 'Gravewake',
    flavor: 'It cuts deepest the hand that holds it.',
    dropModel: WEAPON_SCIMITAR,
    viewmodel: WEAPON_SCIMITAR,
    // Big multiplier on a plain blade — but it eats four points of your
    // flesh. Hits like a fabled, lives like a coward.
    weapon: {
      class: 'sword', coneHalfAngle: 0.85, damage: 2, critChance: 0.10, critMultiplier: 2.3,
    },
    modifiers: [
      { kind: 'damage-multiplier', amount: 1.35 },
      { kind: 'max-hp', amount: -4 },
    ],
    affixPool: ['vile', 'gallows', 'keening', 'serration'],
    maxAffixes: 1,
    drop: { minDepth: 4 },
  },
  'eye-of-appetite': {
    id: 'eye-of-appetite',
    kind: 'amulet',
    rarity: 'cursed',
    name: 'Eye of Appetite',
    flavor: 'It watches your enemies. It watches you longer.',
    dropModel: ACID_TONGUE_AMULET,
    // Glass-cannon crit: brutal on the swing, but every blow you TAKE
    // lands 15% harder. Reward the kill, fear the miss.
    modifiers: [
      { kind: 'crit-chance', amount: 0.12 },
      { kind: 'crit-mult', amount: 0.6 },
      { kind: 'incoming-damage-mult', amount: 1.15 },
    ],
    drop: { minDepth: 4 },
  },
  'the-long-hunger': {
    id: 'the-long-hunger',
    kind: 'ring',
    rarity: 'cursed',
    name: 'The Long Hunger',
    flavor: 'Feed it, or it feeds.',
    dropModel: RING_OF_BLOODTHIRST,
    // Heavy lifesteal turns your offence into your healing — but your
    // pool is four shallower, so a dry spell is a death sentence.
    modifiers: [
      { kind: 'lifesteal-pct', amount: 0.30 },
      { kind: 'max-hp', amount: -4 },
    ],
    drop: { minDepth: 3 },
  },
  'cowards-reward': {
    id: 'cowards-reward',
    kind: 'boots',
    rarity: 'cursed',
    name: "Coward's Reward",
    flavor: 'Faster than the thing behind you. Barely.',
    dropModel: SHROUD_STEP_BOOTS,
    // Move + act faster than anything down here, at the cost of three
    // points of flesh. Kiting becomes king; one mistake still kills.
    modifiers: [
      { kind: 'move-speed-mult', amount: 1.22 },
      { kind: 'action-speed-mult', amount: 1.12 },
      { kind: 'max-hp', amount: -3 },
    ],
    drop: { minDepth: 3 },
  },
  'martyrs-cilice': {
    id: 'martyrs-cilice',
    kind: 'armor',
    rarity: 'cursed',
    name: "Martyr's Cilice",
    flavor: 'Pain sharpens. The dungeon is a patient teacher.',
    dropModel: TATTERED_CLOAK,
    // Offence bolted onto a defence slot: you hit much harder, and you
    // are hit harder too (two less physical armour). Pure aggression.
    modifiers: [
      { kind: 'weapon-damage', amount: 2 },
      { kind: 'damage-multiplier', amount: 1.1 },
      { kind: 'physical-armor', amount: -2 },
    ],
    drop: { minDepth: 4 },
  },
  // ── CONTENT EXPANSION ─────────────────────────────────────────────
  // Slot variety pass — most non-ring slots had a single mundane pick
  // and no uncommon/rare options. These add a clear identity per item
  // (defensive / mobility / offensive / hybrid) so the player has a
  // build choice at every floor instead of "did the chest drop the
  // one thing." Affix pools tag the broad theme; setId glues a few
  // together so equipping the matching pieces awards a bonus.
  //
  // ARMOR (chest)
  'penitents-robe': {
    id: 'penitents-robe',
    kind: 'armor',
    rarity: 'uncommon',
    name: "Penitent's Robe",
    flavor: 'Worn against both flesh and weather.',
    dropModel: PENITENTS_ROBE,
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
    setId: 'penitent',
  },
  'cuirass-of-ash': {
    id: 'cuirass-of-ash',
    kind: 'armor',
    rarity: 'rare',
    name: 'Cuirass of Ash',
    flavor: 'Forged in something that did not burn cleanly.',
    dropModel: CUIRASS_OF_ASH,
    modifiers: [
      { kind: 'physical-armor', amount: 3 },
      { kind: 'move-speed-mult', amount: 0.92 },
    ],
  },
  // HELMET
  'heretics-hood': {
    id: 'heretics-hood',
    kind: 'helmet',
    rarity: 'uncommon',
    name: "Heretic's Hood",
    flavor: 'Cuts no draught. Hides everything else.',
    dropModel: HERETICS_HOOD,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
    setId: 'penitent',
  },
  'skullcap-hanged': {
    id: 'skullcap-hanged',
    kind: 'helmet',
    rarity: 'rare',
    name: 'Skullcap of the Hanged',
    flavor: 'Taken before it could rot.',
    dropModel: SKULLCAP_HANGED,
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
      { kind: 'max-hp', amount: 1 },
    ],
  },
  // GLOVES
  'gravecutter-gauntlets': {
    id: 'gravecutter-gauntlets',
    kind: 'gloves',
    rarity: 'uncommon',
    name: 'Gravecutter Gauntlets',
    flavor: 'Brass knuckles, sealed inside leather. For decorum.',
    dropModel: GRAVECUTTER_GAUNTLETS,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'finisher-damage-mult', amount: 0.20 },
    ],
  },
  'vellum-wraps': {
    id: 'vellum-wraps',
    kind: 'gloves',
    rarity: 'rare',
    name: 'Vellum Wraps',
    flavor: 'Old vows, wrapped around the bones that broke them.',
    dropModel: VELLUM_WRAPS,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'action-speed-mult', amount: 1.12 },
    ],
  },
  // BOOTS
  'shroud-step-boots': {
    id: 'shroud-step-boots',
    kind: 'boots',
    rarity: 'uncommon',
    name: 'Shroud-Step Boots',
    flavor: 'For walking past what is left behind.',
    dropModel: SHROUD_STEP_BOOTS,
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'move-speed-mult', amount: 1.10 },
    ],
  },
  'sin-eater-sandals': {
    id: 'sin-eater-sandals',
    kind: 'boots',
    rarity: 'rare',
    name: 'Sin-Eater Sandals',
    flavor: 'Worn thin by other people\'s sins.',
    dropModel: SIN_EATER_SANDALS,
    modifiers: [
      { kind: 'incoming-damage-mult', amount: 0.90 },
    ],
    setId: 'penitent',
  },
  // OFFHAND
  'splintered-aegis': {
    id: 'splintered-aegis',
    kind: 'offhand',
    rarity: 'uncommon',
    name: 'Splintered Aegis',
    flavor: 'Held by someone whose arms got tired.',
    dropModel: SPLINTERED_AEGIS,
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'max-hp', amount: 1 },
    ],
  },
  // AMULETS
  'mendicants-locket': {
    id: 'mendicants-locket',
    kind: 'amulet',
    rarity: 'uncommon',
    name: "Mendicant's Locket",
    flavor: 'Holds a coin that was never spent.',
    dropModel: MENDICANT_LOCKET,
    modifiers: [
      { kind: 'max-hp', amount: 2 },
      { kind: 'physical-armor', amount: 1 },
    ],
  },
  'heart-of-drowned': {
    id: 'heart-of-drowned',
    kind: 'amulet',
    rarity: 'rare',
    name: 'Heart of the Drowned',
    flavor: 'It beats slower than yours.',
    dropModel: HEART_OF_DROWNED,
    modifiers: [
      { kind: 'max-hp', amount: 3 },
      { kind: 'magic-armor', amount: 1 },
    ],
    // The cold seep — chill-on-hit chance. The drowned mark their kills.
    onHit: { buffId: 'chill', chance: 0.30, duration: 2.5 },
  },
  // RINGS
  'ring-of-iron': {
    id: 'ring-of-iron',
    kind: 'ring',
    rarity: 'uncommon',
    name: 'Ring of Iron',
    flavor: 'A length of nail. Bent.',
    dropModel: RING_OF_IRON,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
  },
  'ring-of-ember': {
    id: 'ring-of-ember',
    kind: 'ring',
    rarity: 'uncommon',
    name: 'Ring of Ember',
    flavor: 'Still warm.',
    dropModel: RING_OF_EMBER,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    onHit: { buffId: 'burn', chance: 0.25, duration: 2.0 },
  },
  'ring-of-quickening': {
    id: 'ring-of-quickening',
    kind: 'ring',
    rarity: 'rare',
    name: 'Ring of Quickening',
    flavor: 'The hours run shorter while it is worn.',
    dropModel: RING_OF_QUICKENING,
    modifiers: [
      { kind: 'action-speed-mult', amount: 1.20 },
      { kind: 'max-hp', amount: -2 },
    ],
  },
  // CONSUMABLES
  'steady-tonic': {
    id: 'steady-tonic',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A flask of steady tonic',
    flavor: 'The mending takes its time.',
    dropModel: STEADY_TONIC,
    consumableBuff: { buffId: 'regen-pulse', duration: 3.0 },   // ~7 HP over time (was 6s/~13 — playtest: too strong)
    carryLimit: 2,
  },
  // ── REACTIVE EQUIPMENT ────────────────────────────────────────────
  // Two new design verbs in play here:
  //   on-DAMAGED triggers — fire a buff when the player takes a hit.
  //     Reads as "the wound activates something." Already supported
  //     by the trigger pipeline; just needed items that USE it.
  //   conditionalModifiers — modifiers that only count while a state
  //     condition holds (HP threshold). Enables the berserker /
  //     last-stand archetype without needing a new trigger event.
  //
  // — On-damaged procs —
  'stoneskin-locket': {
    id: 'stoneskin-locket',
    kind: 'amulet',
    rarity: 'uncommon',
    name: 'Stoneskin Locket',
    flavor: 'The first wound stiffens the second.',
    dropModel: MENDICANT_LOCKET,
    passives: [{
      id: 'stoneskin-on-dmg',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'ironhide', duration: 4.0 }] },
    }],
  },
  'ring-of-fury': {
    id: 'ring-of-fury',
    kind: 'ring',
    rarity: 'rare',
    name: 'Ring of Fury',
    flavor: 'It hates whatever hates you.',
    dropModel: RING_OF_EMBER,
    passives: [{
      id: 'fury-on-dmg',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'bloodthirst', duration: 5.0 }] },
    }],
  },
  'mantle-of-hounded': {
    id: 'mantle-of-hounded',
    kind: 'armor',
    rarity: 'rare',
    name: 'Mantle of the Hounded',
    flavor: 'The body learns what the mind refused.',
    dropModel: PENITENTS_ROBE,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
    passives: [{
      id: 'mantle-regen-on-dmg',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'regen-pulse', duration: 2.0 }] },
    }],
  },
  'wrathful-crown': {
    id: 'wrathful-crown',
    kind: 'helmet',
    rarity: 'cursed',
    name: 'Wrathful Crown',
    flavor: "It rewards what shouldn't be rewarded.",
    dropModel: SKULLCAP_HANGED,
    // Cursed: the proc is fierce but the baseline costs you survival.
    modifiers: [{ kind: 'max-hp', amount: -1 }],
    passives: [{
      id: 'wrath-on-dmg',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'berserk', duration: 4.0 }] },
    }],
  },
  // — Conditional (HP-threshold) modifiers —
  'bloodbond-ring': {
    id: 'bloodbond-ring',
    kind: 'ring',
    rarity: 'uncommon',
    name: 'Bloodbond Ring',
    flavor: 'Tighter as the blood gets warmer.',
    dropModel: RING_OF_BLOODTHIRST,
    conditionalModifiers: [{
      // Below half HP: +1 weapon damage. Classic "wounded fights
      // harder" hook. Small enough to stack with other items, big
      // enough to feel.
      condition: { kind: 'below-hp-pct', value: 0.50 },
      modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    }],
  },
  'last-stand-pauldrons': {
    id: 'last-stand-pauldrons',
    kind: 'gloves',
    rarity: 'rare',
    name: 'Last-Stand Pauldrons',
    flavor: 'Sized for the unburied.',
    dropModel: GRAVECUTTER_GAUNTLETS,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    conditionalModifiers: [{
      // Below 30%: a real spike — +2 damage AND magic-armor. Reads
      // as "the body refuses." Pair with healing potions held in
      // reserve for the danger band.
      condition: { kind: 'below-hp-pct', value: 0.30 },
      modifiers: [
        { kind: 'weapon-damage', amount: 2 },
        { kind: 'magic-armor', amount: 1 },
      ],
    }],
  },
  'mantle-of-resolve': {
    id: 'mantle-of-resolve',
    kind: 'armor',
    rarity: 'rare',
    name: 'Mantle of Resolve',
    flavor: "It hardens when there's nowhere left to fall.",
    dropModel: CUIRASS_OF_ASH,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
    conditionalModifiers: [{
      // Below quarter HP, take 25% less damage. The defensive
      // counterpart to the offensive berserker items — buys time
      // to drink a potion or escape rather than spiking output.
      condition: { kind: 'below-hp-pct', value: 0.25 },
      modifiers: [{ kind: 'incoming-damage-mult', amount: 0.75 }],
    }],
  },
  'talon-amulet': {
    id: 'talon-amulet',
    kind: 'amulet',
    rarity: 'uncommon',
    name: 'Talon Amulet',
    flavor: 'Sharpens while the carrier is unblooded.',
    dropModel: HEART_OF_DROWNED,
    conditionalModifiers: [{
      // ABOVE-threshold variant — reward for STAYING healthy.
      // Different reward loop from the low-HP items: a haste boost
      // you LOSE the moment you take serious damage. Pairs with
      // skill-based avoidance over potion-spam.
      condition: { kind: 'above-hp-pct', value: 0.80 },
      modifiers: [{ kind: 'action-speed-mult', amount: 1.10 }],
    }],
  },
  // ── RETALIATION ITEMS — fire effects at the ATTACKER on damaged ─────
  // Uses the new `target: 'attacker'` resolution in the trigger system.
  // The attacker reference is carried through the player:damaged event;
  // if the damage came from an unattributed source (DoT tick, trap),
  // these effects fall back to targeting self — never crash.
  'frostgrip-amulet': {
    id: 'frostgrip-amulet',
    kind: 'amulet',
    rarity: 'rare',
    name: 'Frostgrip Amulet',
    flavor: 'The bite finds its way back along the arm.',
    dropModel: HEART_OF_DROWNED,
    modifiers: [{ kind: 'magic-armor', amount: 1 }],
    passives: [{
      id: 'frostgrip-chill-on-dmg',
      // 60% chance: when hit, chill the attacker for 3s. Slows their
      // movement + attack cadence — buys you a beat to reposition.
      // Perfect counter to charging melee mobs.
      trigger: {
        on: 'damaged',
        chance: 0.60,
        effects: [{ type: 'apply-buff', target: 'attacker', buffId: 'chill', duration: 3.0 }],
      },
    }],
  },
  'spineweave-cloak': {
    id: 'spineweave-cloak',
    kind: 'armor',
    rarity: 'rare',
    name: 'Spineweave Cloak',
    flavor: 'Sewn with their own ribs, by their own hands.',
    dropModel: PENITENTS_ROBE,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
    passives: [{
      id: 'spineweave-bleed-on-dmg',
      trigger: {
        on: 'damaged',
        chance: 0.50,
        effects: [{ type: 'apply-buff', target: 'attacker', buffId: 'bleed', duration: 4.0 }],
      },
    }],
  },
  'thornring': {
    id: 'thornring',
    kind: 'ring',
    rarity: 'rare',
    name: 'Thornring',
    flavor: 'It draws back as it draws.',
    dropModel: RING_OF_EMBER,
    passives: [{
      id: 'thornring-retaliate',
      trigger: {
        on: 'damaged',
        // Always procs but only deals 1 damage — the design is
        // attrition. Twenty hits from a swarm doubles its health
        // shortage. Routes through the damage sink so it can land
        // killing blows + you get kill credit.
        effects: [{ type: 'damage', target: 'attacker', amount: 1 }],
      },
    }],
  },
  // ── CRIT BUILD — items that stack +crit-chance / +crit-mult ────────
  // Single-source crit is small (5% on a starter sword). Each item
  // here contributes a piece; pile them together and you build a
  // weapon-class-agnostic "every fifth swing crushes" identity.
  'jeweler-band': {
    id: 'jeweler-band',
    kind: 'ring',
    rarity: 'uncommon',
    name: "Jeweler's Band",
    flavor: 'Reads weakness like a vein in stone.',
    dropModel: RING_OF_PREDATION,
    modifiers: [{ kind: 'crit-chance', amount: 0.08 }],
  },
  'split-iris-amulet': {
    id: 'split-iris-amulet',
    kind: 'amulet',
    rarity: 'rare',
    name: 'Split-Iris Amulet',
    flavor: "Two pupils. Neither blinks.",
    dropModel: BONE_AMULET,
    modifiers: [
      { kind: 'crit-chance', amount: 0.10 },
      { kind: 'crit-mult',   amount: 0.40 },
    ],
  },
  'executioners-gloves': {
    id: 'executioners-gloves',
    kind: 'gloves',
    rarity: 'rare',
    name: "Executioner's Gloves",
    flavor: 'Worn to thirty-one names. The thirty-second was the same.',
    dropModel: GRAVECUTTER_GAUNTLETS,
    modifiers: [
      { kind: 'crit-chance', amount: 0.05 },
      { kind: 'crit-mult',   amount: 0.50 },
    ],
  },
  // ── LIFESTEAL BUILD — items that grant %-damage-as-heal ────────────
  // Melee sustain answer. Pairs naturally with wide-cone weapons (the
  // scythe, the sword's strafe sweeps) — each target in a cleave
  // contributes its own lifesteal heal, so a 3-target sweep at 15%
  // lifesteal can outpace incoming chip damage.
  'sanguine-ring': {
    id: 'sanguine-ring',
    kind: 'ring',
    rarity: 'uncommon',
    name: 'Sanguine Ring',
    flavor: 'It drinks first, gives second.',
    dropModel: RING_OF_BLOODTHIRST,
    modifiers: [{ kind: 'lifesteal-pct', amount: 0.15 }],
  },
  // ── SUBSTRATE SLICE — the blood-drinker relics (docs/BUILD-ECONOMY.md). Two
  // pieces that each just touch BLEED; together with a bleed weapon they're a
  // machine (bleed → pop → chain → feed). Placeholder ring models for the
  // fun-check; the real 2.5D cursed-object sprites come with the relic art pass.
  'clot-fetish': {
    id: 'clot-fetish',
    kind: 'ring',
    rarity: 'rare',
    name: 'A knot of old blood',
    flavor: 'Gone hard as a knuckle. What dies bleeding near it, its wound calls to the rest.',
    dropModel: RING_OF_BLOODTHIRST,
    // CHAIN payoff — a dying bleeder re-bleeds its neighbours.
    modifiers: [{ kind: 'bleed-chain', amount: 1 }],
  },
  'crimson-leech': {
    id: 'crimson-leech',
    kind: 'ring',
    rarity: 'rare',
    name: 'A crimson leech',
    flavor: 'It fastens to the wrist and drinks whatever you spill. You barely feel it take.',
    dropModel: RING_OF_BLOODTHIRST,
    // FEED payoff — a bleeding kill mends you (build-granted lifesteal).
    modifiers: [{ kind: 'bleed-feed', amount: 1 }],
  },
  'vampire-amulet': {
    id: 'vampire-amulet',
    kind: 'amulet',
    rarity: 'rare',
    name: 'Amulet of the Drinker',
    flavor: "She didn't survive the cellar. The thirst did.",
    dropModel: HEART_OF_DROWNED,
    modifiers: [
      { kind: 'lifesteal-pct', amount: 0.25 },
      { kind: 'max-hp', amount: -2 },
    ],
  },
  'reapers-vow-gauntlets': {
    id: 'reapers-vow-gauntlets',
    kind: 'gloves',
    rarity: 'rare',
    name: "Reaper's Vow Gauntlets",
    flavor: 'Each finger is a kept promise.',
    dropModel: GRAVECUTTER_GAUNTLETS,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'lifesteal-pct', amount: 0.10 },
    ],
  },
  // ── CONSUMABLES ────────────────────────────────────────────────────
  // ── KEYS ──────────────────────────────────────────────────────────
  // Spent by locked things. Scarce on purpose: a key in the bag is a
  // ROUTING decision waiting to happen (spend it on this reliquary,
  // or hold it for a better one deeper down?).
  'skeleton-key': {
    id: 'skeleton-key',
    kind: 'key',
    rarity: 'rare',
    name: 'A skeleton key',
    flavor: 'The eyes know which doors you tried.',
    dropModel: SKELETON_KEY,
    carryLimit: 3,
    drop: { weight: 1, minDepth: 2 },
  },

  // ── PHIALS — the unlabeled draughts ──────────────────────────────
  // Isaac's pills in DELVE's voice: each color maps to ONE permanent
  // run mutation (state/phial-identities.ts), rolled per run, unknown
  // until the first taste — after that, every phial of that color is
  // a KNOWN, deliberate trade you can stack on purpose. UNKNOWN
  // transaction family: you commit, then the dungeon answers.
  'murky-phial': {
    id: 'murky-phial',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A murky phial',
    flavor: 'Something has settled at the bottom.',
    dropModel: MURKY_PHIAL,
    consumableMutation: true,
    carryLimit: 2,
    drop: { weight: 2, minDepth: 2 },
  },
  'black-phial': {
    id: 'black-phial',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A black phial',
    flavor: 'It drinks the light.',
    dropModel: BLACK_PHIAL,
    consumableMutation: true,
    carryLimit: 2,
    drop: { weight: 2, minDepth: 3 },
  },
  'pale-phial': {
    id: 'pale-phial',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A pale phial',
    flavor: 'Cold, and faintly sweet.',
    dropModel: PALE_PHIAL,
    consumableMutation: true,
    carryLimit: 2,
    drop: { weight: 2, minDepth: 4 },
  },
  // LEGACY — retired from every drop table (Estus Stage 2, LOOT-PUNCHLIST #3).
  // The definition survives so an old save still holding vials can drink them;
  // no `drop` field, so the loot roller can never produce another.
  'healing-potion': {
    id: 'healing-potion',
    kind: 'consumable',
    rarity: 'mundane',
    name: 'A vial of dark elixir',
    flavor: 'Tastes of iron and dust.',
    dropModel: HEALING_POTION,
    consumableHeal: 2,
    carryLimit: 3,
    // You never FIND survivability (docs/BUILD-ECONOMY.md — heals are the flask,
    // refilled only at the fire). Legacy item, kept for old saves; never rolls.
    drop: { noDrop: true },
  },
  // The flask economy (docs/LOOT-PUNCHLIST.md #3): healing loot is tiered.
  // Uncommon DRAUGHTS refill flask charges; rare gated SHARDS grow the flask.
  'flask-draught': {
    id: 'flask-draught',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A stoppered draught',
    flavor: 'The flask accepts it without thanks.',
    dropModel: FLASK_DRAUGHT,
    // Pours into the flask INSTANTLY on pickup — never a bag item. At a full
    // flask the vial stays on the ground (pickup.ts canUse), so no carryLimit.
    consumableFlaskCharges: 1,
    // You never FIND survivability (docs/BUILD-ECONOMY.md). Draughts no longer
    // drop from chests/vases — the flask is the heal, refilled at the fire.
    // Safe rooms may still STOCK one via authored placement (unaffected by
    // noDrop, which only blocks the generic roller).
    drop: { noDrop: true },
  },
  'flask-shard': {
    id: 'flask-shard',
    kind: 'consumable',
    rarity: 'rare',
    name: 'A shard of golden glass',
    flavor: 'The flask remembers being larger.',
    dropModel: FLASK_SHARD,
    consumableFlaskCapacity: 1,
    // No pool weight — shards are GATED, never rolled loose: guaranteed on
    // bosses (enemies.ts `guaranteed`), so capacity growth tracks real
    // progress the way the punch-list intends (boss/elite/gold/challenge).
  },
  'berserk-potion': {
    id: 'berserk-potion',
    kind: 'consumable',
    rarity: 'uncommon',
    name: 'A vial of red haze',
    flavor: 'It moves on its own behind the glass.',
    dropModel: BERSERK_POTION,
    consumableBuff: { buffId: 'berserk', duration: 8.0 },
    carryLimit: 3,
  },
};

// ── DERIVE MELEE REACH FROM THE WEAPON MODEL ─────────────────────────────────
// The hit can't drift from the visible blade if reach is computed FROM it. For
// every melee weapon that didn't author an explicit `reach`, reach is derived
// from the model's blade extent — the 3D distance from its grip anchor to its
// reach point (blade_tip / head_top / strike_point / muzzle). Authoring a weapon
// = authoring the model; reach follows. A per-weapon `reachMul` nudges it.
// Skipped (keep explicit `reach`): RANGED (projectile range) and the WHIP (it
// cracks far past its held cord — visual ≠ reach by design).
function meleeReachExtent(model: ModelSpec | undefined): number | null {
  const s = model?.slots as Record<string, { pos: [number, number, number] }> | undefined;
  if (!s) return null;
  const tip = s.blade_tip?.pos ?? s.head_top?.pos ?? s.strike_point?.pos ?? s.muzzle?.pos;
  if (!tip) return null;
  const grip = s.grip_anchor?.pos ?? [0, 0, 0];
  return Math.hypot(tip[0] - grip[0], tip[1] - grip[1], tip[2] - grip[2]);
}

for (const item of Object.values(ITEMS)) {
  const w = item.weapon;
  if (!w || w.ranged || w.reach !== undefined) continue;   // ranged + whip keep explicit reach
  const extent = meleeReachExtent(item.viewmodel ?? item.dropModel);
  w.reach = extent != null
    ? (CONFIG.MELEE_REACH_BASE + extent * CONFIG.MELEE_REACH_PER_EXTENT) * (w.reachMul ?? 1)
    : 1.5;   // no model anchors → a sane default (author a blade_tip to fix)
}

