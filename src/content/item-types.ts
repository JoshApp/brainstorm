// Item spec TYPE SURFACE — the weapon-stat + item interfaces the ITEMS registry
// (items.ts) is authored against and combat/equipment consume. Split out of
// items.ts so the ~1,600-line ITEMS data registry isn't fronted by ~370 lines
// of type + weapon-stat declarations (docs/CONSOLIDATION-PLAN.md 2e). Pure
// types. Re-exported from items.ts, so existing `from './items'` imports are
// unchanged.

import type { ModelSpec } from '../ecs/model-types';
import type { ContentStatus } from './content-status';
import type { StatModifier } from '../combat/modifiers';
import type { MoveStep } from '../combat/move-timeline';
import type { PassiveSpec } from '../ecs/types';
import type { AttributeKind } from '../state/character';
import type { DomainId } from './domains';

export type ItemKind = 'weapon' | 'offhand' | 'vestment' | 'relic'
                     | 'consumable' | 'key'
                     // A RESOURCE picked up off the floor and consumed on touch —
                     // never a bag entry, never a decision. Isaac's soul heart.
                     // See player/ember.ts.
                     | 'ember';

/**
 * Rarity tiers — atmospheric grimdark naming over the standard ARPG palette.
 * Drives the colored border / name tint in the inventory panel and the
 * floor-pickup glow color. Higher rarity = stronger / more numerous effects.
 */
export type Rarity = 'mundane' | 'uncommon' | 'rare' | 'cursed' | 'fabled';

/** Rarity tiers in ascending "richness" order — the axis the loot roller
 *  walks (step down to a lower tier when a rolled rarity has nothing
 *  eligible yet). Cursed sits above rare as a rarer risk/reward tier. */

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
  /** Timeline-authored move COMBO (docs/MOVE-TIMELINE.md). When set, this weapon
   *  routes through the move runtime instead of the phase machine + flurry hack:
   *  pressing chains through the array (like a combo), each entry a MoveSpec the
   *  viewmodel poses from and whose strike times combat fires hits on — one shared
   *  clock, so animation + hits can't desync. Ramp the combo by growing each
   *  entry's `loopCount` (stabs per press). `attackSpeed` scales timing; a
   *  `flurryHits` stat would grow loop counts. A step may be a directional SET
   *  (DirectionalMoves) instead of a plain move — the opener flavors by movement.
   *  Weapons without `moves` are unaffected. */
  moves?: MoveStep[];
  /** HEAVY moveset — the charged (hold→release) combo. Same shape as `moves`
   *  (directional + combo), just bigger/slower/harder. A charged press plays this
   *  track; omitted → a charged press falls back to the light move + charge bonus. */
  heavyMoves?: MoveStep[];
  /**
   * Multiplier applied to all combo-step timings after the class
   * defaults resolve. 1.0 = baseline, 1.2 = 20% faster (smaller
   * timings), 0.8 = slower. Proficiency points feed in alongside it.
   */
  attackSpeed?: number;
  /** Minimum seconds between attack STARTS (docs/MOVE-TIMELINE.md) — the felt
   *  CADENCE, decoupled from the swing animation's length. A move that finishes
   *  faster than this holds at rest until the interval elapses, so you can't
   *  attack again sooner. 0 / omitted = no floor (as fast as the animation). */
  attackCadenceS?: number;
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
  onHit?: {
    buffId: string;
    /** Proc chance on a normal (single / FIRST-of-flurry) hit. */
    chance: number;
    /** Proc chance on each FLURRY sub-hit. A fast weapon authors a LOW `chance`
     *  but a meaningful `flurryChance` so its status comes from the flurry (many
     *  small rolls that add up); a slow single-hit weapon sets a high `chance`
     *  and no flurry, so it never out-applies a dagger. Omitted → sub-hits fall
     *  back to `chance × CONFIG.FLURRY_PROC_DIMINISH` (the safe default). */
    flurryChance?: number;
    duration: number;
  };
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
  /** Include-flag: omit = 'release'. 'dev'/'draft' gate this out of a normal
   *  production build (see content-status.ts). Covers weapons + relics too. */
  status?: ContentStatus;
  /** Rarity tier — drives UI tint + (future) drop weighting. Default mundane. */
  rarity?: Rarity;
  /** Short flavor line shown in the details panel under the name. */
  flavor?: string;
  /** Model used when the item is on the floor as a pickup. */
  dropModel: ModelSpec;
  /**
   * How wide this thing is where it lies, in METRES. Overrides the per-kind
   * default in content/drop-size.ts — the author knows that a battle standard
   * and a signet ring are both `relic` and are not the same size.
   *
   * Only the 2.5D billboard path reads this. A hand-authored `dropModel` already
   * states its size in its own part dimensions, and nothing should second-guess
   * that with a multiplier.
   */
  dropSize?: number;
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
   * ONE-OF-A-KIND: once the player holds it, the loot roller stops offering it.
   * Defaults to true for anything with a `setId` — set membership is by DISTINCT
   * piece (content/sets.ts), so a duplicate advances nothing and reads as the
   * dungeon repeating itself at exactly the wrong moment. Set false to let a
   * set piece drop again anyway; set true on a non-set item that should still
   * only ever be found once.
   */
  unique?: boolean;
  /** The domain this item belongs to — one of the nine ABSTRACTS in
   *  content/domains.ts (its fantasy / register / affinity palette). The tag
   *  lets the starter altar deal one weapon per domain, biases the deep's
   *  support toward what you're building, feeds Resonance counts, and (for
   *  relics) drives the acquisition reveal's accent colour. The concrete
   *  mechanics live on the item, not the domain — see domains.ts. */
  domain?: DomainId;
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
     *  roll params (bias, rarity floor, category) live in drop-tables.ts, so a
     *  boss item just tags itself here and the manager decides how it drops. */
    pool?: string;
  };
}

