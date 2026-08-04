import type { ModelSpec } from '../ecs/model-types';
import type { ContentStatus } from './content-status';
import { CONFIG } from '../config';
import type { StatModifier } from '../combat/modifiers';
import type { MoveStep } from '../combat/move-timeline';
import { HARROW_MOVES } from './weapon-moves';
import type { PassiveSpec } from '../ecs/types';
import type { AttributeKind } from '../state/character';
import type { DomainId } from './domains';
import { SWORD_RUSTED } from './sword';
import { SKELETON_KEY } from './skeleton-key';
import { WEAPON_SCIMITAR, HEARTBURN, BONE_NEEDLE, IRON_MAUL, SPEAR, CROSSBOW, WAND } from './weapons';
import { REAPERS_TOLL, PENITENTS_CHAIN, CORD_OF_KNIVES, BENT_SICKLE, PILGRIMS_PIKE } from './new-weapons';
import {
  HEALING_POTION, FLASK_DRAUGHT, FLASK_SHARD, RING_OF_VIGOR, RING_OF_PREDATION, RING_OF_BLOODTHIRST,
  RING_OF_FRENZY, TATTERED_CLOAK, BERSERK_POTION,
  BONE_AMULET, ACID_TONGUE_AMULET, LEATHER_GLOVES, WOODEN_SHIELD,
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
  RELIC_BUNDLE,
} from './loot-models';
import { PASSIVES } from './passives';

// The spec TYPE surface (ItemKind, Rarity, WeaponStats, ItemSpec, …) lives in
// item-types.ts. Re-exported here so existing `from './items'` imports keep
// working, and imported locally so the registry + rarity tables can reference them.
import type {
  ItemKind, Rarity, WeaponClass, ScalingGrade, WeaponScaling, ProficiencyProfile,
  CombatVerb, FlurrySpec, ComboStepTuning, WeaponStats, ItemSpec,
} from './item-types';
export type {
  ItemKind, Rarity, WeaponClass, ScalingGrade, WeaponScaling, ProficiencyProfile,
  CombatVerb, FlurrySpec, ComboStepTuning, WeaponStats, ItemSpec,
};

// Item registry. An ItemSpec is the canonical definition of a thing the
// player can collect: kind, display name, drop model, optional viewmodel
// (weapons), optional combat stats (weapons), optional stat modifiers
// (relics/vestments).

// The gear model (docs/BUILD-ECONOMY.md): three SLOTS — weapon / offhand /
// VESTMENT (one worn garment) — plus RELICS, which never occupy a slot:
// they COLLECT into the reliquary (player/reliquary.ts), stack uncapped,
// and all apply. 'consumable' lives on the consumable bar; 'key' is
// carried, not worn or drunk — spent by locked things (reliquaries),
// counted like a consumable but never on the bar.
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
    domain: 'blood',
  },
  // ── BLOOD DOMAIN — "the frenzy" (docs/BUILD-ECONOMY.md). The Harrow is the
  // frenzy verb: where the needle crit-FISHES (few precise stabs), the Harrow
  // SHREDS — an all-flurry moveset that buries bleed stacks fast and rewards
  // never stopping. Low per-hit, high hit-COUNT: the ramp is the fun, not the
  // burst. Placeholder needle model for now — judge the FEEL, not the look.
  'harrow': {
    id: 'harrow',
    kind: 'weapon',
    rarity: 'mundane',
    name: 'The Harrow',
    flavor: 'It does not cut. It rips, and rips, and rips.',
    dropModel: BONE_NEEDLE,
    viewmodel: BONE_NEEDLE,
    domain: 'blood',
    weapon: {
      class: 'dagger',
      coneHalfAngle: 0.62,
      damage: 1,
      critChance: 0.12,
      critMultiplier: 2.0,
      // Baseline dagger cadence — the frenzy is in the hit-COUNT, not raw speed
      // (playtest: faster read as too strong AND truncated the flurries).
      attackSpeed: 1.0,
      // Cadence inherited from the dagger class (0.72). Override here if the
      // Harrow should feel faster/slower than a stock dagger.
      // Bleed is AUTHORED as a flurry weapon (docs/BUILD-ECONOMY.md): a single
      // stab barely bleeds (low `chance`), but the flurry carries it — many
      // sub-hits at `flurryChance` add up to the dagger's signature pressure.
      // This is the weapon that makes the blood-drinker machine hum.
      onHit: { buffId: 'bleed', chance: 0.25, flurryChance: 0.28, duration: 3.5 },
      // TIMELINE combo (docs/MOVE-TIMELINE.md) — a RAMP, not a flat flurry: a
      // single deliberate stab → a double → a triple finisher. The reward is
      // chaining to the 3-stab payoff; a starter weapon shouldn't open with a
      // spasm. Each step is the same committed stab motion, more reps.
      // SIGNATURE moveset override (weapon-moves.ts): the Harrow's frenzy —
      // thrust → cut → rapid TRIPLE finisher, where a generic dagger inherits the
      // class default's double-stab. Its damage/stagger now live in the moves.
      moves: HARROW_MOVES,
    },
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
    // ONLY from the 'boss' pool (drop-tables.ts), never a generic chest. Gate to
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
  // ── VESTMENTS (the one worn-garment slot) ──────────────────────────
  'tattered-cloak': {
    id: 'tattered-cloak',
    kind: 'vestment',
    rarity: 'mundane',
    name: 'A cloak, frayed and stained',
    flavor: 'Smells of cellar and old fire.',
    dropModel: TATTERED_CLOAK,
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
    affixPool: ['cinder', 'salt', 'spine', 'patience'],
    maxAffixes: 1,
  },
  // ── RELICS (converted paperdoll jewelry — provenance pieces) ───────
  'bone-amulet': {
    id: 'bone-amulet',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A vertebra on a cord',
    flavor: 'Someone wore their own bone before the deep took the rest. It still holds the shape of standing.',
    dropModel: BONE_AMULET,
    domain: 'bone',
    modifiers: [
      { kind: 'max-hp', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
  },
  // Boss-unique drop from The Boiling King (Act III). Cut from the
  // slime's core — still glistening, still warm. Equipping it
  // gives every melee swing a chance to inflict poison on the
  // target, plus a small magic-armor bump because acid eats
  // chemistry both ways.
  'acid-tongue': {
    id: 'acid-tongue',
    kind: 'relic',
    rarity: 'fabled',
    name: 'Acid Tongue',
    flavor: 'Cut from something that had eaten kings.',
    dropModel: ACID_TONGUE_AMULET,
    domain: 'rot',
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
  // ── More vestments ─────────────────────────────────────────────────
  'leather-gloves': {
    id: 'leather-gloves',
    kind: 'vestment',
    rarity: 'mundane',
    name: 'Worn leather gloves',
    flavor: 'Stiffened by old blood. Someone else\'s.',
    dropModel: LEATHER_GLOVES,
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
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
  // ── More relics ────────────────────────────────────────────────────
  'ring-of-vigor': {
    id: 'ring-of-vigor',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A knuckle of the stubborn',
    flavor: 'Worried smooth by a thumb that would not quit. The habit outlived the hand.',
    dropModel: RING_OF_VIGOR,
    domain: 'bone',
    modifiers: [{ kind: 'max-hp', amount: 2 }],
  },
  'ring-of-bloodthirst': {
    id: 'ring-of-bloodthirst',
    kind: 'relic',
    rarity: 'uncommon',
    name: "A butcher's thumb-ring",
    flavor: 'Worn on the hand that held the knife. Each kill fed him steadier than the meat did.',
    dropModel: RING_OF_BLOODTHIRST,
    domain: 'blood',
    passives: [PASSIVES['bloodthirst-onkill']],
  },
  // ── BLOOD-ALTAR OFFERINGS ─────────────────────────────────────────
  // Cursed items with REAL downsides — what you get for paying HP at
  // a blood altar. Each trades raw flesh (max-hp) for a meaningful
  // combat advantage. Model reuses an existing ring silhouette; the
  // cursed-violet rarity tint on pickup is the visual giveaway.
  'ring-of-marrow': {
    id: 'ring-of-marrow',
    kind: 'relic',
    rarity: 'cursed',
    name: 'The Marrow-Thief',
    flavor: "A surgeon's band, worn while he took from the living what the dying no longer needed. It takes from you too.",
    dropModel: RING_OF_FRENZY,
    domain: 'bone',
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
    kind: 'relic',
    rarity: 'cursed',
    name: 'Eye of Appetite',
    flavor: 'It looks at everything as a meal. Including out.',
    dropModel: ACID_TONGUE_AMULET,
    domain: 'greed',
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
    kind: 'relic',
    rarity: 'cursed',
    name: 'The Long Hunger',
    flavor: 'It was a rich man\'s fast, then a poor man\'s famine. It kept what both men lost.',
    dropModel: RING_OF_BLOODTHIRST,
    domain: 'greed',
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
    kind: 'vestment',
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
    kind: 'vestment',
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
  // ── VESTMENTS v2 (task #99) — worn build pieces defined by a UNIQUE EFFECT,
  //    NOT armour stats. With two vestment slots now, these are mix-and-match
  //    "how you play" picks: fast, or leeching, or a duelist — you commit to two.
  'quicksilver-anklets': {
    id: 'quicksilver-anklets',
    kind: 'vestment',
    rarity: 'uncommon',
    name: 'Quicksilver Anklets',
    flavor: 'The dark is slower than you, for once.',
    dropModel: SHROUD_STEP_BOOTS,
    // Pure speed — no defence, no cost. The clean mobility pick.
    modifiers: [{ kind: 'move-speed-mult', amount: 1.18 }],
  },
  'leech-mantle': {
    id: 'leech-mantle',
    kind: 'vestment',
    rarity: 'rare',
    name: 'Leech Mantle',
    flavor: 'It drinks what you spill from them, and gives a little back.',
    dropModel: TATTERED_CLOAK,
    // Sustain build enabler — a slice of every blow returns as life.
    modifiers: [{ kind: 'lifesteal-pct', amount: 0.06 }],
  },
  'duelists-gloves': {
    id: 'duelists-gloves',
    kind: 'vestment',
    rarity: 'rare',
    name: "Duelist's Gloves",
    flavor: 'Every seam sits where a killing grip needs it.',
    dropModel: LEATHER_GLOVES,
    // A crit build in a worn slot — more crits, harder crits.
    modifiers: [
      { kind: 'crit-chance', amount: 0.12 },
      { kind: 'crit-mult', amount: 0.30 },
    ],
  },

  // ── CONTENT EXPANSION ─────────────────────────────────────────────
  // Variety pass — each item carries a clear identity (defensive /
  // mobility / offensive / hybrid) so the player has a build choice at
  // every floor instead of "did the chest drop the one thing." Affix
  // pools tag the broad theme.
  //
  // VESTMENTS
  'penitents-robe': {
    id: 'penitents-robe',
    kind: 'vestment',
    rarity: 'uncommon',
    name: "Penitent's Robe",
    flavor: 'Worn against both flesh and weather.',
    dropModel: PENITENTS_ROBE,
    modifiers: [
      { kind: 'physical-armor', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
  },
  'cuirass-of-ash': {
    id: 'cuirass-of-ash',
    kind: 'vestment',
    rarity: 'rare',
    name: 'Cuirass of Ash',
    flavor: 'Forged in something that did not burn cleanly.',
    dropModel: CUIRASS_OF_ASH,
    modifiers: [
      { kind: 'physical-armor', amount: 3 },
      { kind: 'move-speed-mult', amount: 0.92 },
    ],
  },
  'heretics-hood': {
    id: 'heretics-hood',
    kind: 'vestment',
    rarity: 'uncommon',
    name: "Heretic's Hood",
    flavor: 'Cuts no draught. Hides everything else.',
    dropModel: HERETICS_HOOD,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
  },
  'skullcap-hanged': {
    id: 'skullcap-hanged',
    kind: 'vestment',
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
  'gravecutter-gauntlets': {
    id: 'gravecutter-gauntlets',
    kind: 'vestment',
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
    kind: 'vestment',
    rarity: 'rare',
    name: 'Vellum Wraps',
    flavor: 'Old vows, wrapped around the bones that broke them.',
    dropModel: VELLUM_WRAPS,
    modifiers: [
      { kind: 'weapon-damage', amount: 1 },
      { kind: 'action-speed-mult', amount: 1.12 },
    ],
  },
  'shroud-step-boots': {
    id: 'shroud-step-boots',
    kind: 'vestment',
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
    kind: 'vestment',
    rarity: 'rare',
    name: 'Sin-Eater Sandals',
    flavor: 'Worn thin by other people\'s sins.',
    dropModel: SIN_EATER_SANDALS,
    modifiers: [
      { kind: 'incoming-damage-mult', amount: 0.90 },
    ],
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
  // RELICS
  'mendicants-locket': {
    id: 'mendicants-locket',
    kind: 'relic',
    rarity: 'mundane',
    name: "A mendicant's locket",
    flavor: 'Empty. Whatever face it held, he gave the deep everything else first.',
    dropModel: MENDICANT_LOCKET,
    domain: 'grace',
    modifiers: [
      { kind: 'max-hp', amount: 2 },
      { kind: 'physical-armor', amount: 1 },
    ],
  },
  'ring-of-iron': {
    id: 'ring-of-iron',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A band of grave-iron',
    flavor: 'Cut from a coffin nail by a sexton who feared his own yard. The iron remembers holding shut.',
    dropModel: RING_OF_IRON,
    domain: 'bone',
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
  },
  'ring-of-ember': {
    id: 'ring-of-ember',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A coal in silver',
    flavor: 'A lamplighter set his last ember in a ring rather than let the dark have it. It has not forgiven the setting.',
    dropModel: RING_OF_EMBER,
    domain: 'ash',
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    onHit: { buffId: 'burn', chance: 0.25, duration: 2.0 },
  },
  'ring-of-quickening': {
    id: 'ring-of-quickening',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A ring worn on no finger',
    flavor: "Found sewn under a courier's skin. Whatever she outran, she outran it twice.",
    dropModel: RING_OF_QUICKENING,
    domain: 'forbidden',
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
    // DISABLED — consumables are being reworked; the regeneration tonic doesn't
    // drop for now. Definition kept for old saves + the revisit.
    drop: { noDrop: true },
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
    kind: 'relic',
    rarity: 'rare',
    name: 'A locket of grey dust',
    flavor: 'She powdered the wall of the deepest cell and wore it. What patience calcifies, pain cannot open.',
    dropModel: MENDICANT_LOCKET,
    domain: 'bone',
    passives: [{
      id: 'stoneskin-on-dmg',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'ironhide', duration: 4.0 }] },
    }],
  },
  'ring-of-fury': {
    id: 'ring-of-fury',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A cracked signet',
    flavor: 'He struck the wall until the crest was gone. The anger set like mortar.',
    dropModel: RING_OF_EMBER,
    domain: 'valor',
    passives: [{
      id: 'fury-on-dmg',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'bloodthirst', duration: 5.0 }] },
    }],
  },
  'mantle-of-hounded': {
    id: 'mantle-of-hounded',
    kind: 'vestment',
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
    kind: 'vestment',
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
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A vow scratched in iron',
    flavor: 'The oath is illegible now. Whoever swore it hit harder bleeding than whole.',
    dropModel: RING_OF_BLOODTHIRST,
    domain: 'valor',
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
    kind: 'vestment',
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
    kind: 'vestment',
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
    kind: 'relic',
    rarity: 'uncommon',
    name: "A falcon's talon",
    flavor: 'The bird struck only from clean sky. Its keeper starved it into perfection.',
    dropModel: HEART_OF_DROWNED,
    domain: 'dawn',
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
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A shackle-charm of unlight',
    flavor: 'Carved in a cell that had no window and no cold, yet frost grew on it. The jailer never touched it twice.',
    dropModel: HEART_OF_DROWNED,
    domain: 'forbidden',
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
    kind: 'vestment',
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
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A ring of fused barbs',
    flavor: 'A trapper wore it to remember what teeth felt like. Now the remembering is outward.',
    dropModel: RING_OF_EMBER,
    domain: 'bone',
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
    kind: 'relic',
    rarity: 'mundane',
    name: 'A lens of pale glass',
    flavor: "A cutter's loupe, ground to see the one flaw in anything. Everything has it.",
    dropModel: RING_OF_PREDATION,
    domain: 'dawn',
    modifiers: [{ kind: 'crit-chance', amount: 0.08 }],
  },
  'split-iris-amulet': {
    id: 'split-iris-amulet',
    kind: 'relic',
    rarity: 'rare',
    name: 'The Split Iris',
    flavor: 'An eye that saw where to cut, set in gold by someone who wanted the seeing. Both are gone; the seeing keeps.',
    dropModel: BONE_AMULET,
    domain: 'dawn',
    modifiers: [
      { kind: 'crit-chance', amount: 0.10 },
      { kind: 'crit-mult',   amount: 0.40 },
    ],
  },
  'executioners-gloves': {
    id: 'executioners-gloves',
    kind: 'vestment',
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
  // ── BLOOD RELICS — the first domain's set, authored as real `kind:'relic'`
  // grotesque objects (docs/BUILD-ECONOMY.md). They accrete UNCAPPED in the
  // reliquary and combine through the BLEED substrate: apply (weeping splinter)
  // → amplify (stack appliers) → detonate (clot fetish's chain) → feed (crimson
  // leech). The premise is provenance — each belonged to a delver who became
  // something down here; taking it takes on a piece of them. Spectrum runs
  // common numeric TEXTURE → conditional PROCS → a cursed rule with a cost.
  // Drop model is the shared RELIC_BUNDLE placeholder (or a fitting existing
  // object) until the 2.5D AI-art sprite pass; the mechanics are final.

  // — COMMON (mundane): stacking texture. Boring alone; the machine's fuel. —
  'gorged-tick': {
    id: 'gorged-tick',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A gorged tick',
    flavor: 'Swollen fat on someone who went the whole way down. It feeds for you now.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    drop: { minDepth: 1 },
  },
  'weeping-splinter': {
    id: 'weeping-splinter',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A weeping splinter',
    flavor: 'A shard of some saint that will not scar over. What it opens keeps opening.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    // APPLY — hits reopen the wound. Stack a few and bleed becomes reliable.
    onHit: { buffId: 'bleed', chance: 0.18, duration: 2.5 },
    drop: { minDepth: 1 },
  },
  // — UNCOMMON: the connective proc. —
  'sanguine-ring': {
    id: 'sanguine-ring',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A blood-drinker’s stone',
    flavor: 'It drinks first, gives second. The setting is worn to nothing where a finger held it.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    modifiers: [{ kind: 'lifesteal-pct', amount: 0.15 }],
  },
  // — RARE: the machine's payoff pieces (detonate + feed). —
  'clot-fetish': {
    id: 'clot-fetish',
    kind: 'relic',
    rarity: 'rare',
    name: 'A knot of old blood',
    flavor: 'Gone hard as a knuckle. What dies bleeding near it, its wound calls to the rest.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    // DETONATE — a dying bleeder re-bleeds its neighbours.
    modifiers: [{ kind: 'bleed-chain', amount: 1 }],
    drop: { minDepth: 3 },
  },
  'crimson-leech': {
    id: 'crimson-leech',
    kind: 'relic',
    rarity: 'rare',
    name: 'A crimson leech',
    flavor: 'It fastens to the wrist and drinks whatever you spill. You barely feel it take.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    // FEED — a bleeding kill mends you (the loop closes).
    modifiers: [{ kind: 'bleed-feed', amount: 1 }],
    drop: { minDepth: 3 },
  },
  // — CURSED: a rule with a real wound. The grotesque identity piece. —
  'drowned-heart': {
    id: 'drowned-heart',
    kind: 'relic',
    rarity: 'cursed',
    name: 'The Drowned Heart',
    flavor: "She didn't survive the cellar. The thirst did. It beats when yours does.",
    dropModel: HEART_OF_DROWNED,
    domain: 'blood',
    modifiers: [
      { kind: 'lifesteal-pct', amount: 0.25 },
      { kind: 'max-hp', amount: -2 },
    ],
    drop: { minDepth: 4, pool: 'cursed' },
  },

  // ── DOMAIN TOP-UP (docs/ITEM-GRAMMAR.md) — every thin domain filled to a
  // real spectrum, each new engine hook shown working: hyperbolic stacking
  // (morningstar-chip), compounding multipliers (usurers-seal, stolen-heel),
  // victim-state kills (carrion-tongue, ashen-psalm), tempo triggers
  // (chime-of-still-air, patient-aegis, untouched-oath), economy triggers
  // (beggars-bowl, counting-itch). Authoring rules §5 apply: appliers scarce,
  // rarity = shape, EV-honest numerics, provenance on everything.

  // — ROT: what festers, wins (poison / curse / anti-heal) —
  'grave-mould-clump': {
    id: 'grave-mould-clump',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A clump of grave-mould',
    flavor: 'Scraped from the underside of a coffin lid. It spreads to whatever you open.',
    dropModel: RELIC_BUNDLE,
    domain: 'rot',
    onHit: { buffId: 'poison', chance: 0.12, duration: 3.0 },
    drop: { minDepth: 1 },
  },
  'plaguewick': {
    id: 'plaguewick',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A wick soaked in bile',
    flavor: 'The lamplighter of the sixth stair dipped his wicks in his own sickness. Touch his light and carry it.',
    dropModel: RELIC_BUNDLE,
    domain: 'rot',
    passives: [{
      id: 'plaguewick-retaliate',
      trigger: {
        on: 'damaged', chance: 0.45,
        effects: [{ type: 'apply-buff', buffId: 'poison', duration: 4.0, target: 'attacker' }],
      },
    }],
    drop: { minDepth: 2 },
  },
  'carrion-tongue': {
    id: 'carrion-tongue',
    kind: 'relic',
    rarity: 'rare',
    name: 'A carrion-bird’s tongue',
    flavor: 'Dried and strung on gut. The bird ate only what was already dying. It never went hungry.',
    dropModel: RELIC_BUNDLE,
    domain: 'rot',
    // Rot's FEED — the victim-condition hook: only a kill on a poisoned foe pays.
    passives: [{
      id: 'carrion-feed',
      trigger: {
        on: 'killed', condition: { victimHasBuff: 'poison' },
        effects: [{ type: 'heal', amount: 1 }],
      },
    }],
    drop: { minDepth: 3 },
  },

  // — ASH: the fire passes to you (burn / crowd) —
  'ashen-psalm': {
    id: 'ashen-psalm',
    kind: 'relic',
    rarity: 'rare',
    name: 'A psalm burned onto slate',
    flavor: 'The words are gone. The heat that spoke them is not. Finish what burns and it comes to you.',
    dropModel: RELIC_BUNDLE,
    domain: 'ash',
    passives: [{
      id: 'ashen-psalm-fury',
      trigger: {
        on: 'killed', condition: { victimHasBuff: 'burn' },
        effects: [{ type: 'apply-buff', buffId: 'berserk', duration: 2.5 }],
      },
    }],
    drop: { minDepth: 3 },
  },
  'martyrs-tallow': {
    id: 'martyrs-tallow',
    kind: 'relic',
    rarity: 'cursed',
    name: 'A candle of martyr’s tallow',
    flavor: 'Rendered from someone who volunteered. It gives a strong light and takes its fuel from the bearer.',
    dropModel: RELIC_BUNDLE,
    domain: 'ash',
    modifiers: [{ kind: 'damage-multiplier', amount: 1.25 }],
    // The wound: every hit you take sets you briefly alight. Power, paid in kind.
    passives: [{
      id: 'tallow-selfburn',
      trigger: { on: 'damaged', effects: [{ type: 'apply-buff', buffId: 'burn', duration: 1.2 }] },
    }],
    drop: { minDepth: 4, pool: 'cursed' },
  },

  // — DAWN: the killing light (crit / execute) —
  'morningstar-chip': {
    id: 'morningstar-chip',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A chip of the morning star',
    flavor: 'A fleck of the light above, carried down. Each one you find glints a little less alone.',
    dropModel: RELIC_BUNDLE,
    domain: 'dawn',
    // HYPERBOLIC stacking showcase: each copy is another independent glint —
    // 1 chip = +4%, 5 chips ≈ +18.5%, never 100%. Hoard them.
    modifiers: [{ kind: 'crit-chance', amount: 0.04, stack: 'hyperbolic' }],
    drop: { minDepth: 1 },
  },
  'cleanest-cut': {
    id: 'cleanest-cut',
    kind: 'relic',
    rarity: 'rare',
    name: 'The cleanest cut',
    flavor: 'A sliver of edge from a sword that only ever needed one stroke. It remembers how endings feel.',
    dropModel: RELIC_BUNDLE,
    domain: 'dawn',
    // Execute spike — crits carve deeper (flat bonus damage on the crit).
    passives: [{
      id: 'cleanest-cut-carve',
      trigger: { on: 'crit', effects: [{ type: 'damage', amount: 2, target: 'victim' }] },
    }],
    drop: { minDepth: 3 },
  },

  // — GRACE: mastery is the only clean heal (deflect) —
  'chime-of-still-air': {
    id: 'chime-of-still-air',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A chime of still air',
    flavor: 'It rings only when a blade stops where it should not have. The sound closes small wounds.',
    dropModel: RELIC_BUNDLE,
    domain: 'grace',
    // The tempo lane made real: skill IS the heal economy here.
    passives: [{
      id: 'chime-heal',
      trigger: { on: 'deflect', effects: [{ type: 'heal', amount: 1 }] },
    }],
    drop: { minDepth: 2 },
  },
  'patient-aegis': {
    id: 'patient-aegis',
    kind: 'relic',
    rarity: 'rare',
    name: 'A shard of the patient aegis',
    flavor: 'The shield outlived three bearers who understood it and one who did not. Meet the blow, and it stands with you.',
    dropModel: RELIC_BUNDLE,
    domain: 'grace',
    passives: [{
      id: 'aegis-harden',
      trigger: { on: 'deflect', effects: [{ type: 'apply-buff', buffId: 'ironhide', duration: 4.0 }] },
    }],
    drop: { minDepth: 3 },
  },

  // — VALOR: most dangerous at the edge (brink / finisher) —
  'oath-scrap': {
    id: 'oath-scrap',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A scrap of a written oath',
    flavor: '"…to the last of…" — the rest is blood. Whoever swore it, meant it most near the end.',
    dropModel: RELIC_BUNDLE,
    domain: 'valor',
    conditionalModifiers: [{
      condition: { kind: 'below-hp-pct', value: 0.5 },
      modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    }],
    drop: { minDepth: 1 },
  },
  'horn-of-the-brink': {
    id: 'horn-of-the-brink',
    kind: 'relic',
    rarity: 'rare',
    name: 'A horn cracked at the mouth',
    flavor: 'Sounded once, at a last stand that held. The note lives in the crack and answers only desperation.',
    dropModel: RELIC_BUNDLE,
    domain: 'valor',
    conditionalModifiers: [{
      condition: { kind: 'below-hp-pct', value: 0.35 },
      modifiers: [{ kind: 'damage-multiplier', amount: 1.3 }],
    }],
    drop: { minDepth: 3 },
  },

  // — GREED: the ledger is a weapon (gold / chests / deals) —
  'beggars-bowl': {
    id: 'beggars-bowl',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A beggar’s bowl',
    flavor: 'Held out for thirty years. Everything opened before it eventually gave something up.',
    dropModel: RELIC_BUNDLE,
    domain: 'greed',
    passives: [{
      id: 'bowl-tithe',
      trigger: { on: 'chest', effects: [{ type: 'heal', amount: 1 }] },
    }],
    drop: { minDepth: 1 },
  },
  'counting-itch': {
    id: 'counting-itch',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'The counting itch',
    flavor: 'A dried finger, still crooked mid-tally. Every coin it counts, it wants the next one more.',
    dropModel: RELIC_BUNDLE,
    domain: 'greed',
    // Fires per coin absorbed — small chance, brief fury; a gold shower after a
    // kill keeps the appetite lit.
    passives: [{
      id: 'itch-appetite',
      trigger: { on: 'gold', chance: 0.06, effects: [{ type: 'apply-buff', buffId: 'bloodthirst', duration: 2.0 }] },
    }],
    drop: { minDepth: 2 },
  },
  'usurers-seal': {
    id: 'usurers-seal',
    kind: 'relic',
    rarity: 'rare',
    name: 'A usurer’s seal',
    flavor: 'Interest accrues. The usurer never once forgave a debt, and neither does the arithmetic.',
    dropModel: RELIC_BUNDLE,
    domain: 'greed',
    // COMPOUNDING showcase: multiplier kinds stack per copy (×1.06 each — two
    // seals ×1.124, five ×1.338). The engine relic you hoard.
    modifiers: [{ kind: 'damage-multiplier', amount: 1.06 }],
    drop: { minDepth: 3 },
  },

  // — FORBIDDEN: the rules bend for the quick (just-dodge / mobility) —
  'stolen-heel': {
    id: 'stolen-heel',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A heel-bone, stolen',
    flavor: 'Taken from the fastest thing in the third dark. It is not done running.',
    dropModel: RELIC_BUNDLE,
    domain: 'forbidden',
    // Multiplicative — copies compound (×1.04 each). Quietly absurd at depth.
    modifiers: [{ kind: 'move-speed-mult', amount: 1.04 }],
    drop: { minDepth: 1 },
  },
  'untouched-oath': {
    id: 'untouched-oath',
    kind: 'relic',
    rarity: 'rare',
    name: 'The untouched oath',
    flavor: 'Sworn by a trespasser the deep never once laid a hand on. Slip the blow entirely and borrow their fury.',
    dropModel: RELIC_BUNDLE,
    domain: 'forbidden',
    passives: [{
      id: 'untouched-fury',
      trigger: { on: 'just-dodge', effects: [{ type: 'apply-buff', buffId: 'berserk', duration: 2.0 }] },
    }],
    drop: { minDepth: 3 },
  },

  // ── PROVENANCE SETS (content/sets.ts) — a named dead delver's belongings,
  // scattered through the deep. Distinct pieces advance the set; what the
  // owner was becoming starts becoming you at 2 and 3 pieces.

  // — VESS, who kept the lamps (ash). She fought the dark with fire,
  //   rationed in drops, until she was burning what she wore. —
  'vess-striker': {
    id: 'vess-striker',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A flint striker, thumb-worn',
    flavor: 'Vess lit every lamp on the way down. The dark took them anyway, one by one behind her.',
    dropModel: RELIC_BUNDLE,
    domain: 'ash',
    setId: 'vess',
    onHit: { buffId: 'burn', chance: 0.10, duration: 2.0 },
    drop: { minDepth: 1 },
  },
  'vess-oil-phial': {
    id: 'vess-oil-phial',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A phial of lamp oil',
    flavor: 'She rationed it in drops, like medicine. The last measure is still full.',
    dropModel: RELIC_BUNDLE,
    domain: 'ash',
    setId: 'vess',
    onHit: { buffId: 'burn', chance: 0.15, duration: 2.5 },
    drop: { minDepth: 2 },
  },
  'vess-last-wick': {
    id: 'vess-last-wick',
    kind: 'relic',
    rarity: 'rare',
    name: 'The last wick',
    flavor: 'Cut from her own coat hem when the spares ran out. She was down to burning what she wore.',
    dropModel: RELIC_BUNDLE,
    domain: 'ash',
    setId: 'vess',
    modifiers: [{ kind: 'weapon-damage', amount: 1 }],
    onHit: { buffId: 'burn', chance: 0.20, duration: 3.0 },
    drop: { minDepth: 3 },
  },

  // — MAREN, of the shallow grave (bone). She mended, tied, counted,
  //   endured. Her things hold the shape of standing. —
  'maren-thimble': {
    id: 'maren-thimble',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A tin thimble',
    flavor: 'Maren mended for the others. The needle outlived every coat she closed.',
    dropModel: RELIC_BUNDLE,
    domain: 'bone',
    setId: 'maren',
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
    drop: { minDepth: 1 },
  },
  'maren-prayer-knot': {
    id: 'maren-prayer-knot',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A prayer knot',
    flavor: 'Tied tighter each night she heard the stairs. There are forty-one knots.',
    dropModel: RELIC_BUNDLE,
    domain: 'bone',
    setId: 'maren',
    modifiers: [{ kind: 'max-hp', amount: 2 }],
    drop: { minDepth: 2 },
  },
  'maren-milk-tooth': {
    id: 'maren-milk-tooth',
    kind: 'relic',
    rarity: 'rare',
    name: 'A milk tooth, kept',
    flavor: 'Not hers. She never said whose. She counted it every night against the dark.',
    dropModel: RELIC_BUNDLE,
    domain: 'bone',
    setId: 'maren',
    modifiers: [
      { kind: 'max-hp', amount: 1 },
      { kind: 'magic-armor', amount: 1 },
    ],
    drop: { minDepth: 3 },
  },
  // — CAEL, the plaguebearer (rot). He carried the sickness down and let it
  //   work. His things fester; what they touch withers (poison bypasses
  //   physical armour — the answer to a tank). —
  'cael-black-poultice': {
    id: 'cael-black-poultice',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A poultice gone black',
    flavor: 'Cael pressed it to every wound. It stopped none of them, and it never dried.',
    dropModel: RELIC_BUNDLE,
    domain: 'rot',
    setId: 'cael',
    onHit: { buffId: 'poison', chance: 0.12, duration: 3.0 },
    drop: { minDepth: 1 },
  },
  'cael-grave-earth': {
    id: 'cael-grave-earth',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A jar of grave-earth',
    flavor: 'He ate a spoonful a day, to make friends of what waited. It did not help. It did not stop him.',
    dropModel: RELIC_BUNDLE,
    domain: 'rot',
    setId: 'cael',
    onHit: { buffId: 'poison', chance: 0.16, duration: 3.5 },
    drop: { minDepth: 2 },
  },
  'cael-plague-beak': {
    id: 'cael-plague-beak',
    kind: 'relic',
    rarity: 'rare',
    name: 'The plague-mask beak',
    flavor: 'Stuffed with herbs long turned to rot. He breathed it to the end, and the end was slow.',
    dropModel: RELIC_BUNDLE,
    domain: 'rot',
    setId: 'cael',
    modifiers: [{ kind: 'magic-armor', amount: 1 }],
    onHit: { buffId: 'poison', chance: 0.22, duration: 4.0 },
    drop: { minDepth: 3 },
  },

  // — YSOLDE, who bled the dark (blood). She learned the wound heals the one
  //   who opens it. Her things drink. —
  'ysolde-leech-glass': {
    id: 'ysolde-leech-glass',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A leech-glass, cracked',
    flavor: 'Ysolde kept them fat and let them work. The last one starved on her wrist.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    setId: 'ysolde',
    onHit: { buffId: 'bleed', chance: 0.12, duration: 3.0 },
    drop: { minDepth: 1 },
  },
  'ysolde-tourniquet': {
    id: 'ysolde-tourniquet',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'A tourniquet, stiff with old blood',
    flavor: 'She tied it above the wound, never on it. Let the rest run, she said. It feeds.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    setId: 'ysolde',
    modifiers: [{ kind: 'lifesteal-pct', amount: 0.06 }],
    drop: { minDepth: 2 },
  },
  'ysolde-vein-knife': {
    id: 'ysolde-vein-knife',
    kind: 'relic',
    rarity: 'rare',
    name: 'Her opened vein-knife',
    flavor: 'Thin as a whisper, honed on both edges. She bled the dark, and at the last she bled herself.',
    dropModel: RELIC_BUNDLE,
    domain: 'blood',
    setId: 'ysolde',
    modifiers: [{ kind: 'lifesteal-pct', amount: 0.06 }],
    onHit: { buffId: 'bleed', chance: 0.18, duration: 3.5 },
    drop: { minDepth: 3 },
  },

  // — ALDRIC, who did not kneel (valor). He held a line no one asked him to
  //   hold, and the last blow was always his. His things stand. —
  'aldric-pauldron-strap': {
    id: 'aldric-pauldron-strap',
    kind: 'relic',
    rarity: 'mundane',
    name: 'A dented pauldron strap',
    flavor: 'Aldric buckled it the same way ten thousand times. The dent is where the dark kept trying.',
    dropModel: RELIC_BUNDLE,
    domain: 'valor',
    setId: 'aldric',
    modifiers: [{ kind: 'physical-armor', amount: 1 }],
    drop: { minDepth: 1 },
  },
  'aldric-oath-ring': {
    id: 'aldric-oath-ring',
    kind: 'relic',
    rarity: 'uncommon',
    name: 'His notched oath-ring',
    flavor: 'One notch for each stair he would not retreat down. The band is nearly worn through.',
    dropModel: RELIC_BUNDLE,
    domain: 'valor',
    setId: 'aldric',
    modifiers: [{ kind: 'crit-chance', amount: 0.05 }],
    drop: { minDepth: 2 },
  },
  'aldric-standard': {
    id: 'aldric-standard',
    kind: 'relic',
    rarity: 'rare',
    name: 'The standard he would not drop',
    flavor: 'They found the pole in his fist and nothing else of him. He did not kneel.',
    dropModel: RELIC_BUNDLE,
    domain: 'valor',
    setId: 'aldric',
    modifiers: [
      { kind: 'finisher-damage-mult', amount: 1.25 },
      { kind: 'crit-chance', amount: 0.03 },
    ],
    drop: { minDepth: 3 },
  },

  'reapers-vow-gauntlets': {
    id: 'reapers-vow-gauntlets',
    kind: 'vestment',
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
    // NO minDepth. A key is the FIRST currency you learn, and gating it off
    // floor 1 meant the gold chest you found there was a locked box with no
    // answer. It falls from the very first pot.
    drop: { weight: 1 },
  },

  // ── EMBER — borrowed life, lying on the floor ─────────────────────
  // The soul heart. Walk over it and it's yours: a temporary health layer that
  // is spent before your own and can later be spent as a PRICE. It is NOT
  // healing — the flask and the fountains never touch it, and resting never
  // restores it. It only comes from the deep.
  'guttering-ember': {
    id: 'guttering-ember',
    kind: 'ember',
    rarity: 'uncommon',
    name: 'A guttering ember',
    flavor: 'Someone else\u2019s last warmth. It will burn for you a while, and it will not thank you.',
    dropModel: SKELETON_KEY,   // placeholder silhouette until it gets its own
    drop: { weight: 1 },
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
    // DISABLED — consumables are being reworked; the mutation phials ("suspicious
    // vials") don't drop for now. Definition kept for old saves + the revisit.
    drop: { noDrop: true },
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
    drop: { noDrop: true },   // DISABLED — consumable rework (see murky-phial)
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
    drop: { noDrop: true },   // DISABLED — consumable rework (see murky-phial)
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
    // DISABLED — consumables are being reworked; the berserk vial doesn't drop
    // for now. Definition kept for old saves + the revisit.
    drop: { noDrop: true },
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

