import type { ModelSpec, Vec3 } from '../ecs/model-types';
import type { DamageType } from '../combat/damage';
import type { EnemyDeathSize, VocalArchetype } from '../audio/sfx';
import type { Ability } from './abilities';
import { creature } from './creature';
import {
  humanoidGhoulModel, quadrupedRatModel, acolyteModel, skirmisherModel,
  wraithModel, stoneguardModel, oozeModel, kingOozeModel, spiderModel,
  pitMothModel, lasherModel,
} from './enemy-models';
import { mimicModel } from './mimic';
import { burrowerModel } from './burrower';

// Ranged config — if present on a spec, the enemy fires a projectile from
// `muzzleOffset` (local to the container) during the strike phase instead
// of dealing melee damage. `attackRange` / `strikeRange` keep their
// meaning: how far the enemy commits / hits from. Tune them up for
// shooters so they keep their distance.
export interface RangedSpec {
  /** Spawn offset relative to the enemy container, in local meters. */
  muzzleOffset: Vec3;
  /** ProjectileType id (see src/content/projectiles.ts). */
  projectileId: string;
}

// Enemy library. Each entry is data; enemy.ts consumes a spec instead of
// reading constants. Adding a new enemy = add an entry here + reference its
// ID from a LevelSpec spawn.
//
// Stats trade off so combat has rhythm variety:
//   - GHOUL: slow heavy hitter. Long telegraph, easy to read; punishing if missed.
//   - SKIRMISHER: fast light hitter. Short telegraph, attacks more often; small
//     reaction window. Forces you out of the slow ghoul rhythm.

export interface EnemySpec {
  id: string;
  /** Display name (for future tooltip / kill log / epitaph use). */
  name: string;

  /** Boss flag — drives the Dark Souls-style boss bar + "this is a boss"
   *  treatment (the bar finds the live boss enemy by this). */
  isBoss?: boolean;
  /** Name shown on the boss bar (grimdark, e.g. "The Hollow Choir"). */
  bossName?: string;
  /** Visual model scale multiplier — bosses loom larger than trash. The
   *  built model group is scaled by this; gameplay reach/collision still
   *  come from the explicit stat fields. Default 1. */
  scale?: number;

  // --- Stats ---
  hp: number;
  moveSpeed: number;          // m/s while chasing
  attackDamage: number;       // HP removed from player per successful strike

  // --- Reach ---
  attackRange: number;        // m — starts windup when player within this distance
  strikeRange: number;        // m — strike hits if player still within this when striking

  // --- Timings ---
  windupTime: number;         // s — telegraph duration (eyes flare, body tilts)
  strikeTime: number;         // s — hit window
  recoverTime: number;        // s — locked out after strike

  // --- Visuals ---
  model: ModelSpec;
  /** Base emissive intensity for the 'eye' material (used by AI for windup flare). */
  baseEyeEmissive: number;
  collisionRadius: number;
  /** Height the swing aims at + where the damage number floats from.
   *  Defaults to 0.6 × scale, which assumes a body centred around that
   *  height. Override when a model's mass (e.g. the king's core) sits
   *  elsewhere — `0.6 × scale` badly overshoots a low-rigged giant. */
  aimHeight?: number;
  /** Combat hit radius — the swing's reach extends to the body's SURFACE
   *  this far out from `position`, so a big enemy is hittable without
   *  having to stand on its exact centre. Default 0 (point target).
   *  Independent of collisionRadius (movement) — a translucent walk-into
   *  boss can be small for movement yet large for hits. */
  hitRadius?: number;

  // --- Animation hooks (part names within `model`) ---
  /** Part name to tilt forward during windup/strike. Usually 'body' or the root. */
  tiltPartName: string;
  /** Material name to lerp during hit-flash. Usually 'body'. */
  flashMaterialName: string;
  /** Material name whose emissiveIntensity is animated during windup/strike. Usually 'eyes'. */
  eyeMaterialName: string;

  // --- Defense (damage pipeline) ---
  /** Flat reduction to incoming physical damage. Default 0. */
  physicalArmor?: number;
  /** Flat reduction to incoming magic damage. Default 0. */
  magicArmor?: number;
  /** Damage type the enemy's melee strike does. Default 'physical'. */
  damageType?: DamageType;

  // --- Aggro / perception ---
  /**
   * Vision range in meters. Player must be inside this AND in the sight
   * cone AND in line-of-sight (no wall between) to be spotted. Default 7.
   */
  sightRange?: number;
  /**
   * Vision cone half-angle in radians. ~1.05 rad = 60° half (120° total
   * FOV) is a reasonable predator cone. Tight cones make the enemy
   * exploitable from the sides; wide cones make it harder to sneak.
   * Default 1.05.
   */
  sightConeHalfAngle?: number;
  /**
   * Proximity radius that triggers aggro regardless of vision/LOS — the
   * enemy "hears" or "smells" the player at this distance. Smaller than
   * sightRange. Default 2.5.
   */
  hearingRange?: number;
  /**
   * Seconds without LOS before deaggro. Default 4. Damage taken refreshes
   * this timer (a hurt enemy stays aware).
   */
  loseSightTime?: number;

  // --- Drops ---
  /**
   * Drop table — see DropTable above for semantics. Guaranteed items
   * always drop; pool items roll once vs `rate` then pick one by
   * weight. Multiple drops from one kill spread in a small arc.
   */
  drops?: DropTable;

  // --- Reward ---
  /**
   * XP granted on kill. Spawned as that many XP wisps from the mob's
   * death position; each wisp homes in on the player and grants 1 XP
   * when absorbed. Default 1 (trash mob); bosses go much higher.
   */
  xp?: number;
  /** Gold range [min, max] dropped on kill. Credited directly to the
   *  run's gold counter — no floor pickup for now (shop wiring comes later). */
  gold?: [number, number];

  // --- Ranged ---
  /**
   * If set, the enemy is a SHOOTER — striking phase fires a projectile
   * instead of resolving a melee hit. attackDamage / damageType still
   * apply, carried by the projectile.
   */
  ranged?: RangedSpec;

  /**
   * KITER standoff distance (meters). If set and > 0, the enemy backs
   * AWAY from the player whenever the player is closer than this — it
   * tries to hold the band [preferredRange, attackRange] and shoot from
   * there. Without this a "ranged" enemy just stands still once the
   * player closes and becomes a free point-blank kill; with it, the
   * enemy teaches "close the gap under fire / pin it against a wall."
   * Rushing it during its windup still works (it can't retreat while
   * locked in a strike). Pairs with `ranged` but doesn't require it.
   */
  preferredRange?: number;

  /**
   * Cooldown (s) on the DEFAULT ability synthesized from the legacy
   * fields. 0 = attack as fast as windup/strike/recover allow (holders
   * like the acid-spitter). Kiters need a non-zero value so there's a
   * window AFTER each shot to reposition (flee) before the next — without
   * it a kiter just stands and shoots. Ignored when `abilities` is set
   * (declare per-ability cooldowns there). Default 0. */
  attackCooldown?: number;

  /**
   * On-hit status this enemy inflicts on the PLAYER. When a melee or
   * dash strike connects, rolls `chance` and applies the buff (from
   * content/buffs.ts) for `duration` seconds — spider → venom (poison),
   * a future hellhound → burn, etc. Cuts the status system both ways.
   */
  onHit?: { buffId: string; chance: number; duration: number };

  // --- Abilities ---
  /**
   * Explicit ability list (highest-priority first). When set, the AI's
   * attack runner uses these instead of the single default ability
   * synthesized from the legacy windup/strike/recover/attackRange/
   * ranged fields. Use for enemies that need more than one attack or a
   * movement-attack (charge / lunge). See src/content/abilities.ts.
   *
   * The legacy flat fields remain (they still feed the default ability,
   * the debug poser, and audio sizing), so adding `abilities` to one
   * enemy doesn't touch any other.
   */
  abilities?: Ability[];

  // --- Presence ---
  /**
   * Optional continuous animation overlay applied each frame on top of
   * the per-state animation. Each variant has its own character:
   *
   *   spectral — floating ghost: slow vertical bob + micro yaw sway.
   *              Layers on top of state animation.
   *   lurch    — shambling corpse: lateral roll + shamble-step dip.
   *              Reads as heavy, off-balance.
   *   twitch   — small frantic creature: fast yaw micro-shudder +
   *              scurry bob. Reads as nervous, restless.
   *   coiled   — predator under tension: subtle shoulder bob +
   *              weight-shift roll. Reads as ready to spring.
   *   chant    — channelling caster: slow side rock + position drift
   *              + orb material emissive pulse.
   *
   * Phase is randomized per-instance so a pair of the same mob drift
   * out of sync. Cost = a couple of sin() per mob per frame.
   */
  presence?: 'spectral' | 'lurch' | 'twitch' | 'coiled' | 'chant';

  // --- Phasing (ghost-style movement) ---
  /**
   * If true, this mob ignores OBSTACLE collision (pillars, altar,
   * fountain, chest, etc.) — they pass through props. Walls still
   * bound them; pathfinding uses a separate phasing grid that only
   * accounts for walls. Wraiths use this.
   */
  phasing?: boolean;

  /**
   * If true, the PLAYER walks through this mob with no collision —
   * useful for small, scurrying creatures (rats, ooze offspring,
   * future creepy-crawler swarms) where bumping into one shouldn't
   * stop forward motion. The mob still takes damage normally and
   * still tries to damage the player; this is a movement-only
   * affordance. The mob's `collisionRadius` is unchanged so spawn
   * resolution + future mob-mob behaviour stays intact.
   */
  noPlayerCollision?: boolean;

  // --- Inside-aura (the "stuck in the body" mechanic) ---
  /**
   * If set, this enemy emits a movement-slow + damage-tick aura
   * around its body. Player walking inside the radius is:
   *   1. Slowed by `slowFactor` (e.g. 0.4 = 40% speed).
   *   2. After `gracePeriod` seconds, takes `dotDamage` damage
   *      every `dotInterval` seconds while still inside.
   * Designed for the boiling king — pair with `noPlayerCollision`
   * so the player can walk INTO the body. Getting out before the
   * next tick is the skill expression; the slow makes that harder.
   */
  aura?: {
    /** Distance from the enemy centre that counts as "inside." */
    radius: number;
    /** Move-speed multiplier while inside. 1.0 = no slow, 0.4 =
     *  60% reduction. Default 1.0. */
    slowFactor?: number;
    /** Damage per tick while inside (after grace expires). */
    dotDamage: number;
    /** Seconds between damage ticks. */
    dotInterval: number;
    /** Seconds the player can be inside before damage starts.
     *  Short contact (rolling through) costs no HP. */
    gracePeriod: number;
  };

  // --- Burrowed (floor ambush) ---
  /**
   * If set, this enemy spawns BURIED — its model sits below floor
   * level, invisible to the player, with a small dirt-mound "tell"
   * on the ground above it. When the player walks within
   * `triggerDistance` (metres), the mob emerges over `emergeTime`
   * seconds (model rises from y=-1.2 to y=0 with an ease-out)
   * and then behaves as a normal melee mob. While buried/emerging
   * the mob is invulnerable, ignores perception, and cannot move.
   * Pairs with a fast windup + tight strike so the emerge-into-bite
   * lands as one motion.
   */
  burrowed?: {
    /** Player distance (m) that flips the mob from buried to emerging. */
    triggerDistance: number;
    /** Seconds the rise takes (model y interpolates -1.2 → 0). */
    emergeTime: number;
  };

  // --- Split on death ---
  /**
   * If set, when this enemy dies the builder spawns `count` enemies
   * of `enemyId` at the death position (small angular offsets so they
   * don't stack on a single pixel). Children inherit room membership
   * so room-clear detection still works correctly — you have to kill
   * the spawned offspring too.
   *
   * Recursion terminates naturally: the child enemy spec should NOT
   * carry its own `splitsInto`, otherwise oozes would multiply forever.
   */
  splitsInto?: {
    enemyId: string;
    count: number;
    /** Radial distance to scatter children. Default 0.4m. */
    radius?: number;
  };
}

// ── Drop table ──────────────────────────────────────────────────────
// Drop semantics — scarce-but-exciting, ARPG-lite:
//
//   1. `guaranteed` items ALWAYS drop. Use for boss signature loot.
//   2. ONE roll against `rate` decides whether the pool fires. If it
//      fires, the pool picks ONE item by weight. So a kill produces
//      at MOST one pool-rolled item (plus guaranteed).
//   3. `rate` is depth-scaled in scaleEnemySpec — deeper floors have
//      slightly better odds, capped at 0.75.
//
// Why pool-pick-one (vs the old per-entry independent rolls): when
// every entry rolled independently, killing a ghoul almost always
// dropped 2-3 items. Loot stopped reading as a reward. With pool-pick-
// one + a stingier rate, most kills give nothing and the occasional
// drop feels like an event.

export interface DropPoolEntry {
  itemId: string;
  /** Relative weight inside the pool. Higher = more likely picked. */
  weight: number;
}

export interface DropTable {
  /** Items that always drop. Empty/undefined = nothing guaranteed. */
  guaranteed?: string[];
  /** Probability that ONE pool item drops. Default 0.30. Scales with
   *  depth (see scaleEnemySpec). */
  rate?: number;
  /** Weighted pool — one item picked if the rate gate succeeds. */
  pool?: DropPoolEntry[];
}

// --- Audio vocabulary ---------------------------------------------------
// Which sound an enemy makes lives with the enemy data, not in the mob
// runtime. mobs/enemy.ts reads these by spec id (default 'medium' / silent
// for anything unlisted) so adding a creature's voice is a content edit.

/** Death + windup size bucket — keeps big mobs sounding big and the
 *  wraith reading as spectral rather than physical. Default: 'medium'. */
export const ENEMY_AUDIO_SIZE: Record<string, EnemyDeathSize> = {
  wraith: 'spectral',
  rat: 'small',
  // New mob audio sizes.
  'sump-wisp':   'spectral',   // floating, magical — same ethereal palette as the wraith
  'plague-spore':'small',      // small body, soft pop on death
  'carrion-hound':'medium',    // dog-sized — same as ghoul/skirmisher
  mimic:          'medium',    // chunky thud on death
  'pit-moth':     'small',     // tiny crunch
  lasher:         'medium',    // plant-creature death
  burrower:       'medium',    // wet thud, then collapse
};

/** Idle/aware vocalisation per enemy (mobs/enemy.ts ticks a timer and
 *  plays it positionally). Unlisted = silent (no betraying sound). */
export const ENEMY_VOCAL_ARCHETYPE: Record<string, VocalArchetype> = {
  spider: 'skitter',
  skeleton: 'rattle',
  wraith: 'groan',
  ghoul: 'groan',
  skirmisher: 'groan',
  rat: 'squeak',
  ooze: 'gurgle',
  'ooze-small': 'gurgle',
  stoneguard: 'grind',
  'acid-spitter': 'hiss',
  acolyte: 'hiss',
  defiler: 'hiss',
  // New mobs.
  'sump-wisp':    'groan',     // low spectral hum — fits the wraith family
  'plague-spore': 'hiss',      // wet release
  'carrion-hound':'squeak',    // panting/growling; nearest match in the existing pool
  mimic:          'groan',     // low chest-rattle from the throat
  'pit-moth':     'skitter',   // wing-rustle / tiny clicks
  lasher:         'gurgle',    // wet plant-throat
  burrower:       'gurgle',    // subterranean wet — same family as ooze
};


// --- Enemy registry -----------------------------------------------------

export const ENEMIES: Record<string, EnemySpec> = {
  ghoul: {
    id: 'ghoul',
    name: 'ghoul',
    hp: 3,
    moveSpeed: 1.4,
    attackDamage: 1,
    // attackRange = the distance at which the enemy COMMITS to a swing.
    // strikeRange = the distance at which the swing actually LANDS.
    // strikeRange < attackRange means: if the player backs away during the
    // windup, the swing misses. This is what makes the telegraph escapable.
    attackRange: 1.7,
    strikeRange: 1.55,
    windupTime: 0.90,    // long ghoul tell — heavy enemy, big wind-up animation
    strikeTime: 0.18,
    recoverTime: 0.60,
    model: humanoidGhoulModel(0x14100c, 0xff5530, 2.0),
    baseEyeEmissive: 2.0,
    collisionRadius: 0.45,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'lurch',     // shambling lateral roll + shamble-step dip
    // Ghoul has decent eyes, moderate hearing. Wide cone — has to face you
    // generally to spot you, but the cone is forgiving.
    sightRange: 7,
    sightConeHalfAngle: 1.05,   // ~60° half / 120° total
    hearingRange: 2.5,
    loseSightTime: 4,
    xp: 6,
    gold: [0, 8],
    drops: {
      // Mid-tier melee. Bumped 0.30 → 0.45 so kills actually
      // contribute to the player's kit and the trash mob (rat)
      // bump doesn't end up giving ghouls a smaller relative
      // drop rate. Scimitar is the standout weight; rare rolls
      // give a potion or piece of armor. Ring-of-bloodthirst
      // stays rare so finding one is genuinely exciting.
      rate: 0.45,
      pool: [
        { itemId: 'scimitar', weight: 5 },
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'iron-coif', weight: 2 },
        { itemId: 'ring-of-bloodthirst', weight: 1 },
      ],
    },
  },

  rat: {
    id: 'rat',
    name: 'rat',
    hp: 1,           // dies in one hit — the trash mob
    moveSpeed: 2.3,  // slower than player retreat (player MOVE_SPEED = 2.5)
    attackDamage: 1,
    attackRange: 1.0,
    strikeRange: 0.85,   // smaller than attackRange — escapable
    windupTime: 0.70,    // even the trash mob has a clear tell now
    strikeTime: 0.12,
    recoverTime: 0.65,
    model: quadrupedRatModel(0x2a1a14, 0xff2a0a, 2.0),
    baseEyeEmissive: 2.0,
    collisionRadius: 0.18,
    // Player walks RIGHT THROUGH rats — they're foot-high scurriers
    // and getting bodyblocked by one mid-fight feels bad. Still
    // pathfind / take damage / deal damage normally; just no
    // movement collision against the player.
    noPlayerCollision: true,
    tiltPartName: 'rig',     // 'rig' slot — pre-rotated body rotates correctly when this tilts
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'twitch',      // fast yaw micro-shudder + scurry bob
    // Rats hear / smell better than they see. Bad eyes, wide nose. Easy
    // to sneak past visually if you stay quiet, but step into the cone of
    // their hearing radius and they'll come.
    sightRange: 4,
    sightConeHalfAngle: 0.8,    // ~46° half — narrow, head-bobbing predator
    hearingRange: 3.5,
    loseSightTime: 3,
    xp: 1,
    gold: [0, 3],
    drops: {
      // Trash mob — empty hands more often than not. Bumped from
      // ~10% so the trash kills aren't pure XP grind.
      rate: 0.22,
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  // Skirmisher — the CHARGER. No longer "fast ghoul-lite": its identity
  // is the gap-close lunge. From a few metres out it coils, then dashes
  // across the gap and slams into you — so backpedalling no longer
  // saves you the way it does against a ghoul. The verb it teaches is
  // SIDESTEP, not retreat: dodge perpendicular to the charge line, then
  // punish the recovery. At point-blank it falls back to a quick slash.
  // First user of the data-driven ability system (src/content/abilities).
  skirmisher: {
    id: 'skirmisher',
    name: 'skirmisher',
    hp: 2,
    moveSpeed: 2.0,        // player retreat (2.5) outruns the WALK...
    attackDamage: 1,
    // Legacy fields kept for audio sizing + the debug poser; the
    // abilities array below is what actually drives combat.
    attackRange: 1.5,
    strikeRange: 1.35,
    windupTime: 0.65,
    strikeTime: 0.14,
    recoverTime: 0.55,
    abilities: [
      // CHARGE — coil (windup), then a fast dash that DOES catch a
      // backpedalling player (dash speed 7.5 >> player 2.5). Cooldown
      // so it can't chain; the recovery is the punish window.
      {
        id: 'charge',
        minRange: 1.8, maxRange: 6.5,
        windup: 0.55, strike: 0.42, recover: 0.75, cooldown: 2.6,
        pose: 'charge', creep: false,
        steps: [{ trigger: { at: 0 }, action: { kind: 'dash', toward: 'player', speed: 7.5, contactReach: 1.35, damage: 1, element: 'physical' } }],
      },
      // SLASH — point-blank fallback when the player is already in melee
      // (or after a charge lands and they're still close).
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.4, strike: 0.14, recover: 0.5,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.5, damage: 1, element: 'physical' } }],
      },
    ],
    model: skirmisherModel(0x18130d, 0xffb060, 2.0),
    baseEyeEmissive: 2.0,
    collisionRadius: 0.35,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'coiled',      // taut shoulder bob — reads as ready to spring
    // Skirmisher is a scout — best vision of the trash mobs. Tighter
    // cone (predator focus) and longer range. Bad hearing for sneak-up.
    sightRange: 9,
    sightConeHalfAngle: 0.9,
    hearingRange: 2.0,
    loseSightTime: 5,
    xp: 3,
    gold: [0, 6],
    drops: {
      rate: 0.38,                  // bumped from 0.22
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'worn-boots', weight: 2 },
        { itemId: 'ring-of-predation', weight: 1 },
        // The charger drops its reach weapon — uncommon spear. Fits the
        // aggressive melee fantasy and gives the player the spacing tool
        // to answer chargers in kind.
        { itemId: 'spear', weight: 2 },
      ],
    },
  },

  // Acolyte — the KITER. Hurls a slow magic bolt AND backs away when you
  // close, holding a standoff band so you can never just walk up and
  // free-kill it. Teaches "run it down": chase it into a corner, cut it
  // off, or rush it during its windup (it can't retreat mid-cast).
  // Squishy — two hits — so the payoff for closing is quick. The verb
  // that distinguishes it from the acid-spitter (which holds ground) is
  // MOBILITY: the acolyte makes you cover ground, the spitter makes you
  // commit through chip damage.
  acolyte: {
    id: 'acolyte',
    name: 'acolyte',
    hp: 2,                  // squishy — closing on it pays off fast
    moveSpeed: 1.7,         // mobile enough to actually kite a retreating gap
    attackDamage: 1,
    attackRange: 9,         // commits to casting from far out
    strikeRange: 9,         // projectile spawns at strike regardless of range
    preferredRange: 5.5,    // backs away when the player gets nearer than this
    attackCooldown: 1.4,    // reposition window between shots — without it the
                            // kiter would just stand and shoot, never fleeing
    windupTime: 1.10,       // long, readable telegraph (orb pulses brighter)
    strikeTime: 0.15,
    recoverTime: 0.80,
    damageType: 'magic',
    model: acolyteModel(0x1a1a22, 0x66ffaa, 2.5, 0x66ffaa),
    baseEyeEmissive: 2.5,
    collisionRadius: 0.32,
    physicalArmor: 0,
    magicArmor: 1,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'chant',       // slow side rock + orb emissive pulse
    // Best line-of-sight perception of any mob — they're casters, scanning
    // the room. Tight cone (they focus). Hearing radius small.
    sightRange: 11,
    sightConeHalfAngle: 0.95,
    hearingRange: 2.0,
    loseSightTime: 5,
    ranged: {
      // Muzzle = orb position in rig-local space (rig is at +0.85 y from
      // container origin). World-y of the orb ≈ 0.85 + 0.80 = 1.65, which
      // sits about at player chest height. Player hit-test in projectile-pool
      // is generous on Y, so this lands cleanly.
      muzzleOffset: [0.30, 1.65, -0.05],
      projectileId: 'acolyte-spit',
    },
    xp: 5,
    gold: [0, 8],
    drops: {
      rate: 0.42,                  // bumped from 0.28
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'bone-amulet', weight: 1 },
        // The caster drops its implement — a rare arcane-bolt wand. Low
        // weight so it's a genuine find, thematically sourced from the
        // thing that was casting at you.
        { itemId: 'wand', weight: 1 },
      ],
    },
  },

  // Antechamber boss — taller, slower, hits hard with MAGIC damage. Physical
  // armor (cloak, boots, gloves, helmet) does nothing against it. Bone amulet's
  // magic-armor passive is the soft-counter: equip it before the antechamber.
  // Drops the first fabled-rarity weapon plus other rare loot.
  wraith: {
    id: 'wraith',
    name: 'wraith',
    // BOSS — only ever spawned via the 'B' boss slot (never in roll tables),
    // so the boss treatment lives right on the spec. Bigger, far tankier than
    // trash, and named, so it reads as a set-piece, not a stray mob.
    isBoss: true,
    bossName: 'The Hollow Choir',
    scale: 1.5,
    hp: 12,                 // boss HP — a real fight, gives the bar range
    moveSpeed: 1.5,         // slow — heavily telegraphed bossier feel
    attackDamage: 2,        // hits twice as hard as the trash mobs
    attackRange: 1.9,
    strikeRange: 1.75,
    windupTime: 0.95,       // long, readable telegraph
    strikeTime: 0.22,
    recoverTime: 0.75,
    damageType: 'magic',    // bypasses physical armor entirely
    model: wraithModel(0x1a2a32, 0x66ffaa, 3.0),
    baseEyeEmissive: 3.0,
    collisionRadius: 0.55,
    physicalArmor: 0,       // vulnerable to physical (your sword cuts it)
    magicArmor: 2,          // but resistant to magic
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'spectral',       // continuous bob + sway so it never reads as a statue
    phasing: true,              // ghost — drifts through pillars/altars/chests
    // Wraith sees ECHO of you — basically supernatural perception. Long
    // range, wide cone, but small hearing radius (no body to feel
    // footsteps). Long lose-sight: it follows even if you break LOS.
    sightRange: 12,
    sightConeHalfAngle: 1.3,    // ~75° half / 150° total
    hearingRange: 1.5,
    loseSightTime: 7,
    xp: 25,
    gold: [15, 30],
    drops: {
      // Boss — always drops the consolation potion. Then a single pool
      // roll for one of the rare items (heartburn fabled or the amulet).
      // No matter what, the player walks away with at least a heal.
      guaranteed: ['healing-potion'],
      rate: 1.0,
      pool: [
        { itemId: 'heartburn', weight: 1 },          // fabled — the headline
        { itemId: 'bone-amulet', weight: 2 },
      ],
    },
  },

  // Ooze — slow contact-damage blob. Dies in two strikes, BUT splits
  // into two small oozes on death (see splitsInto). Kills net more
  // total HP than facing a single small mob; the math is "spend two
  // sword swings to make the problem WORSE." The teach: AoE / cone-
  // catch matters; if you can clip two small oozes in one wide arc,
  // the split is contained. If you take them one at a time after a
  // careless kill, you spend three more swings on cleanup.
  ooze: {
    id: 'ooze',
    name: 'ooze',
    hp: 2,
    moveSpeed: 1.4,
    attackDamage: 1,
    attackRange: 1.0,
    strikeRange: 0.85,
    windupTime: 0.55,           // short — it just lurches into you
    strikeTime: 0.18,
    recoverTime: 0.45,
    damageType: 'physical',
    model: oozeModel(0x355230, 0x88dd33, 1.0),
    baseEyeEmissive: 0,         // no eyes — emissive lives in the core orb instead
    collisionRadius: 0.32,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',    // re-use the core orb for the windup flare
    presence: 'twitch',         // wobbly micro-scurry; reads "alive jelly"
    sightRange: 5,
    sightConeHalfAngle: 1.4,    // ~80° — basically omnidirectional sensing
    hearingRange: 3.0,
    loseSightTime: 5,
    xp: 4,
    gold: [0, 5],
    splitsInto: { enemyId: 'ooze-small', count: 2, radius: 0.5 },
    drops: {
      rate: 0.35,                  // bumped from 0.20
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  // Small ooze — the offspring. Less HP, less damage, no further
  // splitting. The reward for killing a parent ooze cleanly is that
  // these two replace it; the punishment for killing it sloppily is
  // that you face them anyway.
  'ooze-small': {
    id: 'ooze-small',
    name: 'ooze',
    hp: 1,                       // one-shot kill, like a rat
    moveSpeed: 1.6,              // slightly faster — they're "cleanup speed"
    attackDamage: 1,
    attackRange: 0.8,
    strikeRange: 0.7,
    windupTime: 0.45,
    strikeTime: 0.14,
    recoverTime: 0.40,
    damageType: 'physical',
    model: oozeModel(0x355230, 0x88dd33, 0.55),
    baseEyeEmissive: 0,
    collisionRadius: 0.20,
    // Same player-walk-through affordance as rats — the split kids
    // are knee-high and should feel like swarm cleanup, not body-
    // blockers.
    noPlayerCollision: true,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',
    presence: 'twitch',
    sightRange: 4,
    sightConeHalfAngle: 1.4,
    hearingRange: 2.0,
    loseSightTime: 3,
    xp: 1,
    gold: [0, 2],
    // No splitsInto — recursion terminator.
    drops: {
      rate: 0.12,                // mostly nothing — they're cleanup
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  // Acid spitter — the HOLDER. The deliberate foil to the acolyte: where
  // the acolyte runs from you, the spitter plants and refuses to move,
  // lobbing acid on a fast cadence so the longer you stay at range the
  // more chip you eat. It does NOT kite (no preferredRange) — closing on
  // it WORKS, that's the lesson, but it's tanky (4 HP) and its acid
  // bypasses armour, so "commit and burst it down before the chip adds
  // up" is the verb. Pack glue: a spitter behind a melee line punishes
  // turtling — you can't out-wait it, you have to push.
  //
  // No splitting on death — a ranged splitter would be a "back-line
  // cleared → back-line refilled" trap that punishes correct kill order.
  'acid-spitter': {
    id: 'acid-spitter',
    name: 'acid spitter',
    hp: 4,                       // tanky — closing on it is a real commitment
    moveSpeed: 0.8,              // glacial — it holds ground, doesn't chase
    attackDamage: 1,
    attackRange: 7,              // ranged commit distance; no preferredRange (holds)
    strikeRange: 7,
    windupTime: 0.85,            // faster cadence than the acolyte — chip pressure
    strikeTime: 0.15,
    recoverTime: 0.55,           // short recovery → it shoots OFTEN
    damageType: 'magic',         // acid bypasses physical armour
    // Blue body + bright cyan core — reads as a different chemistry
    // than the green ground ooze.
    model: oozeModel(0x1a3a78, 0x66ccff, 1.05),
    baseEyeEmissive: 2.6,        // brighter than the green ooze's 0 — the spitter's
                                 // core is the windup tell, so it needs to pulse hard
    collisionRadius: 0.34,
    physicalArmor: 0,
    magicArmor: 0,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',     // re-use the core orb for the windup flare
    presence: 'twitch',          // same wobble as the green ooze — it's the same species
    sightRange: 9,               // sees well — caster-class perception
    sightConeHalfAngle: 1.3,
    hearingRange: 2.5,
    loseSightTime: 5,
    ranged: {
      // Muzzle at the core orb's height — visually the spit
      // emerges from the bright cyan ball at the centre of the
      // blob, which sells the "this orb is the thing shooting."
      // y ≈ rig (0.19) + body offset (0) = ~0.19m; bump up to 0.30
      // so the projectile clears the body silhouette on launch.
      muzzleOffset: [0, 0.30, 0],
      projectileId: 'acid-spit',
    },
    xp: 6,
    gold: [0, 7],
    drops: {
      rate: 0.38,
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'bone-amulet', weight: 1 },
      ],
    },
  },

  // Stoneguard — slow, armoured, hits like a truck. Changes combat
  // rhythm: the fast mobs taught you to flail; this one teaches you to
  // time the dodge. The huge windup is escapable on sight, but the
  // recovery is short enough that you can't punish endlessly — you
  // get ONE strike per cycle, two if you read it perfectly. Physical
  // armor 2 means trash-tier weapons take a few hits to chew through.
  stoneguard: {
    id: 'stoneguard',
    name: 'stoneguard',
    hp: 6,                       // tankiest non-boss
    moveSpeed: 1.0,              // glacial — player retreat (2.5) outruns easily
    attackDamage: 3,             // biggest single-hit damage in the roster
    attackRange: 1.9,            // long reach (maul + heavy frame)
    strikeRange: 1.65,           // big gap → big punish for misreading the windup
    windupTime: 1.40,            // the giveaway tell — slow overhead heave
    strikeTime: 0.22,
    recoverTime: 1.00,           // long recovery — missed swings are exploitable
    damageType: 'physical',
    model: stoneguardModel(0x3a3530, 0xff5530),
    baseEyeEmissive: 1.2,
    collisionRadius: 0.55,       // wider footprint — harder to slip around
    physicalArmor: 2,            // the defining stat — chips through trash weapons
    magicArmor: 0,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'lurch',           // shambling weight-shift; reads heavy
    // Sees and hears poorly — slow, lumbering. Easy to sneak past if
    // you commit to it. Once aggro'd, sticks for a long time.
    sightRange: 6,
    sightConeHalfAngle: 0.95,    // ~55° half / 110° — narrower than ghoul
    hearingRange: 3.0,           // can feel footfalls through the floor
    loseSightTime: 6,
    xp: 12,
    gold: [10, 20],
    drops: {
      rate: 0.55,                  // bumped from 0.40 — tanks are real fights
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'wooden-shield', weight: 2 },     // shield drops feel earned from a tank
        { itemId: 'iron-coif', weight: 2 },
        { itemId: 'ring-of-bloodthirst', weight: 1 },
      ],
    },
  },

  // Defiler — the ZONE controller. The one enemy that teaches "don't
  // stand there." It calls a crushing hex down onto the ground where
  // you're standing: a ring marks the floor through a long readable
  // windup, and if you're still inside it when the hex lands you eat a
  // heavy magic hit. The whole fight is footwork — keep moving, never
  // root yourself, punish it in the recovery after a hex resolves. A
  // weak slash covers point-blank so you can't just hug it safely.
  //
  // Magic damage (the hex ignores physical armour) so plate doesn't
  // trivialise it — the answer is positioning, not mitigation. First
  // user of the `aoe` ability effect.
  //
  // NOTE: reuses the ghoul silhouette recoloured violet for now; a
  // distinct hexer model is pending the parametric-creature pass.
  defiler: {
    id: 'defiler',
    name: 'defiler',
    hp: 4,
    moveSpeed: 1.1,              // slow drifter — it controls space, doesn't chase
    attackDamage: 2,            // legacy/default mirror of the hex damage
    attackRange: 7,
    strikeRange: 1.5,
    windupTime: 1.15,
    strikeTime: 0.25,
    recoverTime: 0.9,
    damageType: 'magic',
    abilities: [
      // HEX — telegraphed ground AoE at the player's feet. Long windup
      // (1.15s) + radius 1.9 = clearly dodgeable by walking off the
      // marker; cooldown 2.8 spaces the hexes so footwork has rhythm.
      {
        id: 'hex',
        minRange: 1.8, maxRange: 7,
        windup: 1.15, strike: 0.25, recover: 0.9, cooldown: 2.8,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'lockedTarget', radius: 1.9, damage: 2, element: 'arcane' } }],
      },
      // SLASH — point-blank deterrent so hugging it isn't a free safe spot.
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.55, strike: 0.16, recover: 0.6,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.5, damage: 1, element: 'arcane' } }],
      },
    ],
    // Own silhouette via the parametric builder: tall, gaunt, stooped,
    // long reaching arms (it pulls the hex down), violet with a sickly
    // rim. Distinct from the bulky ghoul + lean skirmisher. Inherits
    // the full rig (arm-swing, gait, head-crane) for free.
    model: creature({
      id: 'defiler-creature',
      palette: { body: 0x281830, eye: 0xbb55ff, eyeEmissive: 2.6, bodyEmissive: 0x140a1e },
      rim: { color: 0x7a4ac0, power: 3.0, intensity: 0.7 },
      height: 1.15,      // tall
      build: 0.82,       // gaunt
      armLength: 0.62,   // long, reaching
      legLength: 0.5,
      headRadius: 0.21,
      hunch: 0.12,       // stooped, head thrust forward
    }),
    baseEyeEmissive: 2.6,
    collisionRadius: 0.42,
    physicalArmor: 0,
    magicArmor: 1,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'chant',           // ritual side-rock; sells "calling something down"
    sightRange: 9,
    sightConeHalfAngle: 1.0,
    hearingRange: 2.5,
    loseSightTime: 5,
    xp: 10,
    gold: [5, 14],
    drops: {
      rate: 0.45,
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'bone-amulet', weight: 1 },
      ],
    },
  },

  // Skeleton — the PRESSURE enemy: dangerous at every range. It hurls
  // bone shards while it advances, then slashes once it's on you. Where
  // the acolyte flees and the acid-spitter plants, the skeleton just
  // keeps coming AND keeps throwing, so backing off doesn't buy safety —
  // the answer is to close and break it fast (it's brittle: 3 HP).
  // Built entirely from creature() + two abilities — no new mechanics;
  // a showcase of both systems (first mob with a ranged AND a melee
  // ability it uses by range).
  skeleton: {
    id: 'skeleton',
    name: 'skeleton',
    hp: 3,
    moveSpeed: 1.5,            // advances steadily (no kite, no preferredRange)
    attackDamage: 1,
    // Legacy mirrors for audio/debug; the abilities drive combat.
    attackRange: 1.7,
    strikeRange: 1.5,
    windupTime: 0.55,
    strikeTime: 0.15,
    recoverTime: 0.45,
    damageType: 'physical',
    abilities: [
      // BONE THROW — ranged poke from mid distance while closing. Cooldown
      // so it's a periodic shard, not a stream; minRange keeps it from
      // throwing point-blank (it slashes there instead).
      {
        id: 'bone-throw',
        minRange: 2.4, maxRange: 8,
        windup: 0.6, strike: 0.15, recover: 0.5, cooldown: 2.0,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: { kind: 'projectile', projectileId: 'bone-shard', muzzle: [0.28, 1.35, -0.1], damage: 1 } }],
      },
      // SLASH — the close-range bite once it reaches you.
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.5, strike: 0.15, recover: 0.45,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.5, damage: 1, element: 'physical' } }],
      },
    ],
    // Gaunt, pale, cold-eyed bones via the parametric builder — its own
    // brittle silhouette, and it inherits the full rig (arms gesture the
    // throw + slash, it strides in, skull cranes at you).
    model: creature({
      id: 'skeleton-creature',
      palette: { body: 0x7c7464, eye: 0x9fd8ff, eyeEmissive: 2.4, bodyEmissive: 0x0c0f12 },
      rim: { color: 0xb8d4f0, power: 3.0, intensity: 0.4 },
      height: 1.05,
      build: 0.78,        // skeletal — thin
      armLength: 0.54,
      legLength: 0.5,
      headRadius: 0.2,
      hunch: 0.04,
      head: 'skull',      // cranium + jaw + dark eye-sockets
      torso: 'ribcage',   // thin spine + exposed rib slats
    }),
    baseEyeEmissive: 2.4,
    collisionRadius: 0.34,
    physicalArmor: 0,
    magicArmor: 0,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'lurch',         // bony shamble
    sightRange: 8,
    sightConeHalfAngle: 1.0,
    hearingRange: 2.5,
    loseSightTime: 5,
    xp: 7,
    gold: [0, 9],
    drops: {
      rate: 0.42,
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'bone-amulet', weight: 1 },
        { itemId: 'iron-coif', weight: 2 },
        // The armed undead drops its crossbow — uncommon physical ranged.
        // Modest weight so it shows up reliably enough to let a player
        // try the ranged playstyle without being guaranteed.
        { itemId: 'crossbow', weight: 2 },
      ],
    },
  },

  // Spider — fast, fragile POUNCER that comes in packs. Scuttles in,
  // coils, then leaps the gap with a lunge-bite (the dash ability, like
  // the skirmisher's charge — but spiders are a SWARM of them: low HP,
  // faster, several at once). Verb: read the pounce + sidestep it, and
  // don't get surrounded. The nest mob; lives in web rooms.
  spider: {
    id: 'spider',
    name: 'spider',
    hp: 2,
    moveSpeed: 2.2,            // fast scuttle
    attackDamage: 1,
    attackRange: 1.5,
    strikeRange: 1.3,
    windupTime: 0.4,
    strikeTime: 0.14,
    recoverTime: 0.4,
    damageType: 'physical',
    // Venom — bites have a chance to poison. Poison stacks, so a swarm
    // still ramps attrition when it surrounds you, but the per-bite chance
    // is moderate so a single spider isn't a guaranteed stacking machine.
    onHit: { buffId: 'poison', chance: 0.4, duration: 4 },
    abilities: [
      // POUNCE — coil then leap across the gap with a bite on contact.
      {
        id: 'pounce',
        minRange: 1.6, maxRange: 5,
        windup: 0.45, strike: 0.38, recover: 0.55, cooldown: 2.0,
        pose: 'charge', creep: false,
        steps: [{ trigger: { at: 0 }, action: { kind: 'dash', toward: 'player', speed: 8.5, contactReach: 1.2, damage: 1, element: 'physical' } }],
      },
      // BITE — point-blank snap when already on top of the player.
      {
        id: 'bite',
        minRange: 0, maxRange: 1.5,
        windup: 0.35, strike: 0.12, recover: 0.38,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.3, damage: 1, element: 'physical' } }],
      },
    ],
    model: spiderModel(0x1a1016, 0xff3a55, 2.4),   // near-black chitin, red eyes
    baseEyeEmissive: 2.4,
    collisionRadius: 0.30,
    physicalArmor: 0,
    magicArmor: 0,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'twitch',        // restless scuttle
    sightRange: 8,
    sightConeHalfAngle: 1.3,   // wide — wall-crawler awareness
    hearingRange: 3.0,
    loseSightTime: 4,
    xp: 4,
    gold: [0, 4],
    drops: {
      rate: 0.30,
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  // The Boiling King — Act III boss (depth 12).
  //
  // A king slime, big and viscous, swollen with everything it's eaten.
  // The act's verdant-rot palette (sickly greens) gives us a perfect
  // home for an acid theme that doesn't read as cute. Designed as the
  // SIMPLEST possible "real boss" — one telegraphed mechanic + one
  // dramatic death — to validate the whole pipeline (boss bar,
  // unique drop, splits-on-death, boss music state) before we author
  // more elaborate fights for Acts I and II.
  //
  // Fight loop:
  //   1. Player enters the boss arena, slime sees them, boss bar
  //      appears (handled by ui/boss-bar.ts — keyed off isBoss + aware).
  //   2. Slime telegraphs a HOP — long windup, ground ring at the
  //      player's feet, then a leap that lands as a radial AoE.
  //      Player steps out of the ring to dodge.
  //   3. Repeat until dead.
  //   4. On death, BURSTS into 3 boiling-prince smaller slimes
  //      (splitsInto). The fight isn't over yet — clean them up.
  //   5. Guaranteed drop: a poison-themed unique relic.
  //
  // Phase-2 / mid-fight transition mechanic (e.g. spitting acid
  // droplets between hops) is deliberately deferred to a follow-up
  // pass once V1 plays well.
  'boiling-king': {
    id: 'boiling-king',
    name: 'boiling king',
    // No tileChar — bosses bypass the ASCII char dictionary
    // entirely. populateTemplate's B-tile expansion records the
    // cell coords + boss id; vault-compose converts to a spawn
    // entry directly. Keeps the 26-uppercase ceiling from biting
    // as more bosses + named mobs land.
    isBoss: true,
    bossName: 'The Boiling King',
    scale: 7.0,                      // WAY bigger than the player (~2× player height, 3.5m wide)
    hp: 28,                          // bigger body, more HP — fight pacing stays similar
    moveSpeed: 1.2,                  // a touch less glacial; the chase HOP does the real closing
    attackDamage: 3,                 // hits hard — the AoE is the threat
    attackRange: 10.0,               // proportional to body — leaps across the room
    strikeRange: 4.0,                // landing splash radius matches the bulk
    windupTime: 1.20,                // generous telegraph — readable on phone
    strikeTime: 0.50,                // longer strike so the leap actually crosses ground
    recoverTime: 1.40,               // more downtime so the king doesn't spam-leap
    damageType: 'magic',             // acid bypasses physical armour — boss earns its name
    // Translucent green flesh with swallowed regalia (crown, sword,
    // skull) drifting inside — sells the "it has eaten kings" line.
    model: kingOozeModel(0x4a6a18, 0xa8ff44),
    baseEyeEmissive: 0,              // no eyes — core orb carries the read
    // collisionRadius used to be 1.5 to match the visual bulk, but
    // that meant the dash path couldn't get close to pillars / great
    // braziers in the boss arena — the king slid sideways and never
    // reached the AoE landing zone. Drop to 0.7 so the king navigates
    // around obstacles instead of bumping off them. The aura (1.6)
    // remains the actual gameplay zone; this is just for movement.
    collisionRadius: 0.7,
    // The core orb sits at the model's rig (local y 0.18) → ~1.3m up at
    // scale 7. The default 0.6×scale = 4.2m would put the aim point WAY
    // above the body, so only a long-lunge swing could reach it. Pin the
    // aim to the actual core height so every swing connects with it.
    aimHeight: 1.3,
    // Hittable at the body's SURFACE, not its centre. With the aim pinned
    // to the core, a 2.1-reach sword already connects ~2m out (the body is
    // ~1.8m wide); this small radius is just grace so SHORTER swing
    // variants (low reachMul) also land cleanly and you're not nudging the
    // exact edge. Tunable — raise the aura (1.6) toward this if you want
    // attacking to demand more aura exposure.
    hitRadius: 0.6,
    // KEY MECHANIC: player walks INTO the king. No solid body. Once
    // inside, the aura ticks (defined below): slowed move + acid damage
    // after a grace window. The pressure is "get out before the next
    // tick" not "knockback clears you instantly."
    noPlayerCollision: true,
    aura: {
      radius: 1.6,                   // matches the visible body footprint at scale 7
      slowFactor: 0.4,               // 60% slow — sticky slime feel, escapable but costly
      dotDamage: 1,                  // tick is mild — the pressure is the slow + multiple ticks
      dotInterval: 1.0,              // ticks once per second while inside
      gracePeriod: 1.0,              // a full second of "I'm in, get out" before damage starts
    },
    tiltPartName: 'rig',
    // Damage flash hits the CORE, not the body. The body is translucent
    // green at 0.55 opacity so a base-colour flash barely reads; enemy.ts
    // gives the core a heartbeat + a white-hot flare/pop on hit.
    flashMaterialName: 'core',
    // The king has NO eyes (baseEyeEmissive 0). Pointing eyeMaterialName at
    // 'core' made the eye system drive the core's emissive to 0 every frame
    // — blacking out the very orb that's supposed to glow. Aim it at a
    // material that doesn't exist so the eye system no-ops and the core
    // hit-reaction in enemy.ts fully owns the orb.
    eyeMaterialName: 'no-eyes',
    presence: 'twitch',              // pulsing blob feel even when idle
    physicalArmor: 0,
    magicArmor: 0,
    sightRange: 14,                  // sees you anywhere in the arena — no sneaking past
    sightConeHalfAngle: 1.8,         // near-omnidirectional — it's a blob, no front
    hearingRange: 4,
    loseSightTime: 12,               // never really gives up
    abilities: [
      // LASH — a melee deterrent so you can't camp the core risk-free
      // between leaps. The king coils (windup) then lashes a pseudopod
      // out to ~3m — far enough to clip you at the body's edge where you
      // strike the core. Highest priority at close range; cooldown keeps
      // it from chaining. creep so a stationary player still gets caught.
      {
        id: 'lash',
        minRange: 0, maxRange: 4.5,
        windup: 0.55, strike: 0.22, recover: 0.70, cooldown: 2.6,
        pose: 'charge', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 3.0, damage: 2, element: 'arcane' } }],
      },
      // LEAP — a committed airborne jump. A ground ring telegraphs the
      // landing zone at the player's feet during windup; the king then
      // arcs ONTO that locked point (it commits to where you WERE, so
      // kiting off the marker is the dodge — a slow giant can't course-
      // correct mid-air). One self-contained `leap` effect owns the
      // whole thing: the arc, the landing splash, the screen-shake, and
      // the shove. If you eat the landing you're knocked to the body's
      // edge and the aura (slow + acid ticks, defined above) becomes the
      // inside-the-body pressure. Getting out is the skill expression.
      // minRange 3 so it commits to a real gap, not an awkward point-blank
      // leap (the lash/hop cover close range).
      {
        id: 'leap',
        minRange: 3, maxRange: 14,
        // strike 0.65 (was 0.50) + riseFraction 0.4 below = a faster launch
        // and a longer, readable descent — the player gets time to dodge
        // off the marker as the king hangs and drops.
        windup: 1.20, strike: 0.65, recover: 1.40,
        // Full cycle ≈ 1.2 + 0.5 + 1.4 + 2.5 = 5.6s — ~4s of safety
        // between leaps to advance on the king or strike its core.
        cooldown: 2.5,
        pose: 'cast',
        steps: [
          // JUMP — committed airborne leap onto the locked landing zone.
          {
            id: 'jump', trigger: { at: 0 },
            action: {
              kind: 'leap', toward: 'lockedTarget',
              // 4m peak at mid-strike — reads unmistakably as airborne,
              // not a flat charge. Deterministic travel (takeoff → marker
              // over the 0.5s strike) lands exactly on the ring.
              arcHeight: 4.0,
              // Splash radius ≈ the body/aura footprint (1.6) so the dodge
              // is "step OFF the marker," not "sprint to the far wall."
              landingRadius: 1.8,
              damage: 3,
              element: 'arcane',   // magic damage, no status (the aura carries acid)
              shake: 0.35,         // chunky boss-slam thud
              shakeDuration: 0.45,
              // Shove the player to the body's edge on impact so they're in
              // the aura, not pinned dead-centre — escapable, but costly.
              knockbackSpeed: 4.0,
              // Guarantee a real arc even if the player is hugging the body
              // at windup: the landing point is pushed out to ≥3m.
              minDistance: 3.0,
              // Launch fast, descend slow — the drop is the dodge window.
              riseFraction: 0.4,
            },
          },
          // SPILL — on touchdown, leave a slow acid puddle at the impact
          // point (the `landing` anchor the leap just wrote). It lingers 5s
          // after the king has moved on: a denied tile that slows + ticks
          // anyone who stands in it. Reuse over invention — a placed,
          // time-limited copy of the king's own body aura.
          {
            id: 'spill', trigger: { after: 'jump', on: 'land' },
            action: {
              kind: 'field', origin: 'landing',
              radius: 2.0, lifetime: 5.0,
              slow: 0.5, dps: 1, dotInterval: 1.0,
              element: 'acid',
            },
          },
        ],
      },
      // HOP — small homing chase hop so the king actually closes on a
      // kiting player BETWEEN big leaps (LAST priority: only fires when the
      // lash/leap are on cooldown). Homes to where you ARE (toward
      // 'player'), short windup + short cooldown, low arc, no ground ring
      // (it's movement, not a committed AoE). A little chip if it lands on
      // you. minRange 1.5 so it doesn't hop in your face when adjacent.
      {
        id: 'hop',
        minRange: 1.5, maxRange: 9,
        windup: 0.35, strike: 0.40, recover: 0.30, cooldown: 0.8,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: {
          kind: 'leap', toward: 'player', arcHeight: 1.3, landingRadius: 0.8, damage: 1,
          element: 'arcane', shake: 0.08, knockbackSpeed: 2.0, riseFraction: 0.42,
          maxDistance: 3.5,   // small fixed step — closes a kiting player over several hops
        } }],
      },
    ],
    xp: 60,                          // significant haul — earns the depth
    gold: [40, 80],
    drops: {
      // Guaranteed: healing potion (the soft landing) + the unique
      // boss drop. Pool roll on top adds variance.
      guaranteed: ['healing-potion', 'acid-tongue'],
      rate: 1.0,
      pool: [
        { itemId: 'heartburn',   weight: 1 },
        { itemId: 'bone-amulet', weight: 1 },
      ],
    },
    // Death = bursts into three smaller slimes. The fight isn't over
    // yet; the prince spec terminates the recursion (no splitsInto on
    // it). 0.8m scatter radius spreads them around the corpse.
    splitsInto: { enemyId: 'boiling-prince', count: 3, radius: 0.8 },
  },

  // Boiling Prince — the children of the king. Smaller, faster, no
  // further splitting. They're cleanup — the king's last gasp before
  // the room unseals.
  'boiling-prince': {
    id: 'boiling-prince',
    name: 'boiling prince',
    // No tileChar — only spawned via the king's splitsInto.
    // The split stays part of the boss fight: each prince is a boss, so
    // the boss bar tracks all three (as three smaller bars). The fight
    // ends only when the last prince dies.
    isBoss: true,
    bossName: 'Spawn of the King',
    hp: 3,
    moveSpeed: 1.6,                  // a touch faster so it can pressure a kiter
    attackDamage: 1,
    attackRange: 1.0,                // legacy fields (unused — `abilities` below drives it)
    strikeRange: 0.85,
    windupTime: 0.55,
    strikeTime: 0.18,
    recoverTime: 0.45,
    damageType: 'magic',             // still acid — keeps the king's theme
    // A smaller version of the king's kit: a committed leap (telegraphed,
    // dodgeable) + a close-range bite. No puddle — three princes spilling
    // acid would carpet the arena.
    abilities: [
      {
        id: 'prince-leap',
        minRange: 2, maxRange: 7,
        windup: 0.70, strike: 0.45, recover: 0.70, cooldown: 2.4,
        pose: 'cast',
        steps: [{ trigger: { at: 0 }, action: {
          kind: 'leap', toward: 'lockedTarget', arcHeight: 1.8, landingRadius: 1.0, damage: 1,
          element: 'arcane', shake: 0.12, shakeDuration: 0.3, knockbackSpeed: 2.5,
          minDistance: 2.0, riseFraction: 0.42,
        } }],
      },
      {
        id: 'bite',
        minRange: 0, maxRange: 1.6,
        windup: 0.35, strike: 0.14, recover: 0.40,
        pose: 'swing', creep: true,
        steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.2, damage: 1, element: 'arcane' } }],
      },
    ],
    model: oozeModel(0x4a6a18, 0xa8ff44, 0.85),
    baseEyeEmissive: 0,
    collisionRadius: 0.30,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',
    presence: 'twitch',
    sightRange: 5,
    sightConeHalfAngle: 1.6,
    hearingRange: 2.5,
    loseSightTime: 4,
    xp: 4,
    gold: [2, 6],
    // No splitsInto — recursion terminator.
    drops: {
      rate: 0.20,
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  // ── Mob variety pass ───────────────────────────────────────────────
  // Three new mob types filling underrepresented combat verbs:
  //   - stationary AoE turret (plague spore)
  //   - floating fast caster, non-humanoid (sump wisp)
  //   - fast pack melee, bleed-on-hit (carrion hound)
  // Each ships with a distinct model so the silhouette reads
  // immediately, even in low-light corridors.

  // Plague Spore — stationary fungal turret. Doesn't move; periodically
  // inflates and releases a poison cloud AoE around itself. Reads as
  // "do I kill it or sprint past?" — the player chooses commitment.
  // Verdant Rot themed but appears act 2+.
  'plague-spore': {
    id: 'plague-spore',
    name: 'plague spore',
    hp: 3,
    moveSpeed: 0,                  // truly stationary
    attackDamage: 2,
    attackRange: 2.4,              // AoE radius; player must clear this
    strikeRange: 2.4,
    windupTime: 1.10,              // long telegraph — body inflates
    strikeTime: 0.18,
    recoverTime: 1.40,             // long cooldown — sprint past is viable
    damageType: 'magic',
    model: spore_modelV1(0x6a4a18, 0xa8d870),
    baseEyeEmissive: 0,
    collisionRadius: 0.40,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',
    sightRange: 6,
    sightConeHalfAngle: 1.8,       // near-omnidirectional — it's a fungus
    hearingRange: 4,
    loseSightTime: 99,             // never disengages — stationary
    abilities: [{
      id: 'spore-burst',
      minRange: 0, maxRange: 2.4,
      windup: 1.10, strike: 0.18, recover: 1.40, cooldown: 1.0,
      pose: 'cast',
      steps: [{ trigger: { at: 0 }, action: { kind: 'aoe', origin: 'self', radius: 2.4, damage: 2, element: 'arcane' } }],
    }],
    // Poison-on-hit because spores. Player who eats the cloud bleeds
    // damage for a few seconds after stepping out.
    onHit: { buffId: 'poison', chance: 0.8, duration: 4 },
    xp: 4,
    gold: [0, 4],
    drops: {
      rate: 0.20,
      pool: [{ itemId: 'healing-potion', weight: 1 }],
    },
  },

  // Sump Wisp — floating non-humanoid caster. Distinct from the
  // acolyte (humanoid robed caster) by being a small glowing orb
  // that drifts. Fast move speed + low HP = hit-and-run kiter.
  // Reads as "ambient malevolence" rather than "person."
  'sump-wisp': {
    id: 'sump-wisp',
    name: 'sump wisp',
    hp: 2,                          // one-shot for most weapons — closing matters
    moveSpeed: 1.8,                 // fast — it kites
    attackDamage: 1,
    attackRange: 8,
    strikeRange: 8,
    windupTime: 0.70,
    strikeTime: 0.14,
    recoverTime: 0.55,
    damageType: 'magic',
    model: wisp_modelV1(0x66a8e0, 0xaaccff, 2.8),
    baseEyeEmissive: 2.2,           // the core pulses on windup
    collisionRadius: 0.22,
    noPlayerCollision: true,        // ghosts through you, doesn't body-block
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'core',
    presence: 'spectral',           // floats + bobs
    phasing: true,                  // drifts through obstacles like the wraith
    sightRange: 12,
    sightConeHalfAngle: 1.6,
    hearingRange: 4,
    loseSightTime: 6,
    preferredRange: 5.5,            // backs off if you close
    attackCooldown: 0.4,
    ranged: {
      muzzleOffset: [0, 0, 0],
      projectileId: 'acolyte-spit',  // reuse the spectral spit; tinted by the wisp's blue
    },
    xp: 5,
    gold: [0, 5],
    drops: {
      rate: 0.25,
      pool: [
        { itemId: 'healing-potion', weight: 2 },
      ],
    },
  },

  // Mimic — chest-disguised ambush mob. Never roll-placed in a vault
  // (no tileChar). Spawned in by the chest interactable when the
  // player "opens" a chest that was marked mimic in procgen. Stats
  // skew chunky: more HP than a ghoul, slower chase, big chomping
  // bite. Doesn't perceive the world normally — sightRange/hearingRange
  // are wide so the spawn-frame aggro on the player who JUST opened
  // the chest is automatic; no need to be facing it.
  mimic: {
    id: 'mimic',
    name: 'mimic',
    // No tileChar — never roll-placed. The chest interactable is the
    // only spawn path.
    hp: 6,
    moveSpeed: 1.8,
    attackDamage: 2,
    attackRange: 1.6,
    strikeRange: 1.40,
    windupTime: 0.55,     // big maw-gape tell — long enough to read
    strikeTime: 0.18,
    recoverTime: 0.55,
    damageType: 'physical',
    model: mimicModel(),
    baseEyeEmissive: 2.4,
    collisionRadius: 0.32,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'lurch',
    // Wide perception so the post-reveal frame aggros the player
    // even if they jumped sideways the instant they opened it.
    sightRange: 8,
    sightConeHalfAngle: Math.PI,   // full sphere — it's already on you
    hearingRange: 4,
    loseSightTime: 8,
    xp: 12,
    gold: [4, 16],
    // Surviving a mimic is its own loot event. Always drops a pool
    // pick (rate = 1.0) so the betrayal pays out, with quality
    // weighted toward gear over potions — the dungeon rewards a
    // player who keeps their footing after the trap springs.
    drops: {
      rate: 1.0,
      pool: [
        { itemId: 'ring-of-bloodthirst', weight: 1 },
        { itemId: 'iron-coif', weight: 3 },
        { itemId: 'leather-gloves', weight: 3 },
        { itemId: 'scimitar', weight: 4 },
        { itemId: 'healing-potion', weight: 4 },
      ],
    },
  },

  // Carrion Hound — fast quadruped pack predator. Sits between rat
  // (too soft) and skirmisher (humanoid melee) in the difficulty
  // curve. Bleeds on hit so being mobbed by a pack actually adds up.
  'carrion-hound': {
    id: 'carrion-hound',
    name: 'carrion hound',
    hp: 3,
    moveSpeed: 2.6,                 // fast chase
    attackDamage: 2,
    attackRange: 1.4,
    strikeRange: 1.20,
    windupTime: 0.40,               // shorter than the skirmisher — it bites quick
    strikeTime: 0.14,
    recoverTime: 0.40,
    damageType: 'physical',
    // Bigger than a rat (scale 3.0 vs rat's 2.0) + black-brown
    // palette + yellow-green sickly eyes. Reads as "starving dog,
    // not vermin."
    model: quadrupedRatModel(0x18120c, 0xc8d030, 3.0),
    baseEyeEmissive: 2.0,
    collisionRadius: 0.30,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    sightRange: 8,
    sightConeHalfAngle: 1.4,
    hearingRange: 4.5,
    loseSightTime: 5,
    // Bleed-on-hit — the bites tear and they STAY torn. A pack of
    // hounds quickly stacks bleed; the kill isn't the worst part.
    onHit: { buffId: 'bleed', chance: 0.4, duration: 4 },
    xp: 5,
    gold: [0, 6],
    drops: {
      rate: 0.28,
      pool: [
        { itemId: 'healing-potion', weight: 3 },
        { itemId: 'leather-gloves', weight: 1 },
      ],
    },
  },

  // Pit Moth — flying insectoid melee swarmer. The mob whose job is
  // teaching you to LOOK UP and to use CLEAVING swings, not single-
  // target pokes. Each moth alone is trivial (1 HP — one hit kills),
  // but they're rolled in clusters at mid-depth so encountering
  // one usually means encountering 3-5. Hovers at head-height via
  // the model's elevated 'rig' slot + the spectral presence overlay.
  // No phasing — they're physical (a sword cone catches them) — but
  // noPlayerCollision so a swarm doesn't body-block your retreat.
  'pit-moth': {
    id: 'pit-moth',
    name: 'pit moth',
    hp: 1,
    moveSpeed: 2.6,                 // fast — outruns retreat
    attackDamage: 1,
    attackRange: 1.4,
    strikeRange: 1.20,
    windupTime: 0.30,               // brief tell — the bite is fast
    strikeTime: 0.10,
    recoverTime: 0.40,
    damageType: 'physical',
    model: pitMothModel(),
    baseEyeEmissive: 2.6,
    collisionRadius: 0.10,          // very small footprint
    noPlayerCollision: true,        // swarm shouldn't body-block
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    // 'spectral' gives the float + bob — exactly what we want for
    // "hovering above the floor."
    presence: 'spectral',
    // Wide spheric vision + decent hearing — they're a swarm, you
    // can't sneak past one without all of them noticing.
    sightRange: 7,
    sightConeHalfAngle: 1.8,        // near-omnidirectional eyes
    hearingRange: 3.5,
    loseSightTime: 5,
    xp: 1,
    gold: [0, 2],
    drops: {
      rate: 0.10,                   // chaff — drops are rare per moth
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  // Lasher — STATIONARY plant-creature with a long whip-arm tendril
  // ending in a fanged maw. moveSpeed: 0 (rooted), but strikeRange:
  // 3.5m means the player's safe zone is "very close OR very far."
  // The middle band (1.5–3.5m) is the kill zone — get past the
  // sweep, hug the bulb, and the maw can't reach you. Forces a
  // commit decision on approach instead of the standard backpedal
  // dance. A new attack-distance pattern in the roster (everything
  // else either chases at melee or sits at range; the lasher does
  // long-reach melee from a fixed spot).
  lasher: {
    id: 'lasher',
    name: 'lasher',
    hp: 4,
    moveSpeed: 0,                   // rooted in the floor
    attackDamage: 2,
    attackRange: 3.8,               // long reach — the threat band
    strikeRange: 3.5,
    windupTime: 0.90,               // long telegraph — you can read the lunge
    strikeTime: 0.20,
    recoverTime: 0.85,
    damageType: 'physical',
    model: lasherModel(),
    baseEyeEmissive: 2.4,
    collisionRadius: 0.40,          // the bulb is wide
    physicalArmor: 1,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    // 'coiled' fits — a tense plant ready to strike. The shoulder-
    // bob shows up faintly on the maw segment.
    presence: 'coiled',
    // Near-omnidirectional perception so the lasher isn't bypassable
    // from the side; it's a deliberate room-control encounter.
    sightRange: 7,
    sightConeHalfAngle: 1.8,
    hearingRange: 3.5,
    loseSightTime: 99,              // stationary — sticks indefinitely
    xp: 8,
    gold: [3, 10],
    drops: {
      rate: 0.45,
      pool: [
        { itemId: 'healing-potion', weight: 3 },
        { itemId: 'acid-tongue', weight: 2 },
        { itemId: 'cord-of-knives', weight: 1 },
      ],
    },
  },

  // Burrower — floor ambush predator. Spawns BURIED under a small
  // dirt-mound tell; emerges when the player walks within 2m. Once
  // surfaced it's a normal chunky melee mob — slower than a ghoul
  // but bigger bite (the ambush is the threat, not the chase).
  // Pairs with the pit moth thematically: moths teach "look up,"
  // burrowers teach "scan the floor."
  burrower: {
    id: 'burrower',
    name: 'burrower',
    hp: 4,
    moveSpeed: 1.6,                  // moderate — the surprise IS the threat
    attackDamage: 2,
    attackRange: 1.5,
    strikeRange: 1.30,
    windupTime: 0.50,                // medium telegraph — the maw gapes
    strikeTime: 0.16,
    recoverTime: 0.55,
    damageType: 'physical',
    model: burrowerModel(),
    baseEyeEmissive: 2.4,
    collisionRadius: 0.32,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'lurch',
    // Buried — emerge at 2m. The trigger distance is generous so
    // the player has half a beat to react; the emergeTime is short
    // (0.45s) so the rise reads as a BURST, not a slow elevator.
    burrowed: {
      triggerDistance: 2.0,
      emergeTime: 0.45,
    },
    // Once emerged, wide-sphere perception so the post-emerge
    // aggro on the player who just triggered it is automatic.
    sightRange: 8,
    sightConeHalfAngle: Math.PI,
    hearingRange: 4,
    loseSightTime: 8,
    xp: 8,
    gold: [3, 12],
    drops: {
      rate: 0.40,
      pool: [
        { itemId: 'healing-potion', weight: 3 },
        { itemId: 'leather-gloves', weight: 2 },
        { itemId: 'bone-needle', weight: 1 },
      ],
    },
  },
};

// ── Inline model builders for the variety pass ────────────────────
// Kept next to the specs that use them — small enough not to deserve
// their own enemy-models.ts entry. Both share the existing material
// + sprite vocabulary so they slot into the style cleanly.

/** Spore — short stem + flattened mushroom cap + a few drooping
 *  tendrils. The cap has a glowing core that pulses on windup. */
function spore_modelV1(bodyColor: number, coreColor: number): ModelSpec {
  return {
    id: `spore-${bodyColor.toString(16)}`,
    materials: {
      body: { color: bodyColor, roughness: 1.0, flatShading: 'auto' },
      core: { color: 0x000000, emissive: coreColor, emissiveIntensity: 1.4, roughness: 1.0 },
      tendril: { color: bodyColor, roughness: 1.0 },
    },
    slots: { rig: { pos: [0, 0.18, 0] } },
    parts: [
      // Stem.
      { kind: 'cylinder', pos: [0, 0.08, 0], radius: 0.10, radiusTop: 0.08, height: 0.16, segments: 8, mat: 'body' },
      // Cap — flattened oblate sphere on top of the stem.
      { name: 'body', parent: 'rig', kind: 'sphere', pos: [0, 0.04, 0], scale: [1.0, 0.55, 1.0], radius: 0.28, segments: [12, 10], mat: 'body', jitter: 0.02 },
      // Glowing core inside the cap — pulses on windup via the
      // existing eyeMaterialName hook.
      { name: 'core', parent: 'rig', kind: 'sphere', pos: [0, 0.04, 0], radius: 0.10, segments: [10, 8], mat: 'core' },
      // Drooping tendrils — small cylinders splayed out.
      { kind: 'cylinder', pos: [-0.18, 0.16, 0],    rot: [0, 0,  0.6], radius: 0.014, height: 0.18, segments: 6, mat: 'tendril' },
      { kind: 'cylinder', pos: [ 0.18, 0.16, 0],    rot: [0, 0, -0.6], radius: 0.014, height: 0.18, segments: 6, mat: 'tendril' },
      { kind: 'cylinder', pos: [ 0.00, 0.18, -0.18], rot: [-0.6, 0, 0], radius: 0.014, height: 0.18, segments: 6, mat: 'tendril' },
    ],
  };
}

/** Wisp — a floating sphere with a brighter glowing core. Designed
 *  to read as "ambient light gone wrong" rather than a creature
 *  with body parts. The spectral presence overlay adds the float. */
function wisp_modelV1(bodyColor: number, coreColor: number, coreEmissive: number): ModelSpec {
  return {
    id: `wisp-${bodyColor.toString(16)}`,
    materials: {
      body: {
        color: bodyColor, roughness: 0.4, metalness: 0.0,
        emissive: bodyColor, emissiveIntensity: 0.6,
        rim: { color: coreColor, power: 2.0, intensity: 0.7 },
        dissolvable: true,
      },
      core: { color: 0x000000, emissive: coreColor, emissiveIntensity: coreEmissive, roughness: 1.0 },
    },
    slots: { rig: { pos: [0, 0.85, 0] } },
    parts: [
      // Outer luminous body — translucent-looking sphere.
      { name: 'body', parent: 'rig', kind: 'sphere', pos: [0, 0, 0], radius: 0.20, segments: [14, 10], mat: 'body', jitter: 0.012 },
      // Inner bright core — the windup tell pulses this.
      { name: 'core', parent: 'rig', kind: 'sphere', pos: [0, 0, 0], radius: 0.09, segments: [10, 8], mat: 'core' },
    ],
  };
}

// Per-enemy ASCII tile chars are GONE. Placement is always either
// procgen-driven (X / B slots in a vault map, expanded by
// populateTemplate into SpawnCell records) or explicit (a vault
// author drops { kind: 'spawn', enemyId, x, z } in the props array).
// The 26-letter ceiling can't bite a new mob anymore.
