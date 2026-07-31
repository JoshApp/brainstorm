// Enemy spec TYPE SURFACE — the interfaces the enemy registry (enemies.ts) is
// authored against and the engine (mobs/enemy.ts) consumes. Split out of
// enemies.ts so the 2,000+-line ENEMIES data registry isn't fronted by ~430
// lines of interface (docs/CONSOLIDATION-PLAN.md 2e). Pure types — no runtime.
// Re-exported from enemies.ts, so existing `from './enemies'` imports are unchanged.

import type { ModelSpec, Vec3 } from '../ecs/model-types';
import type { ContentStatus } from './content-status';
import type { DamageType } from '../combat/damage';
import type { Ability } from './abilities';
import type { CreatureSpec } from './creature-types';
import type { Clip } from '../anim/types';
import type { DropTableId } from './drop-tables';

export interface RangedSpec {
  /** Spawn offset relative to the enemy container, in local meters. */
  muzzleOffset: Vec3;
  /** ProjectileType id (see src/content/projectiles.ts). */
  projectileId: string;
}

export interface EnemySpec {
  id: string;
  /** Display name (for future tooltip / kill log / epitaph use). */
  name: string;
  /** Include-flag: omit = 'release'. 'dev'/'draft' gate this out of a normal
   *  production build (see content-status.ts). */
  status?: ContentStatus;

  /** What this creature spills when cut. Defaults to mortal red.
   *  Oozes run ichor-green; skeletons shed pale dust (see bloodAmount). */
  bloodColor?: number;
  /** Gore multiplier on stamp size + opacity (default 1). Skeletons
   *  barely stain (0.3) — bone does not bleed; it powders. */
  bloodAmount?: number;
  /** How the corpse leaves. 'collapse' (default for physical) topples to the
   *  floor then melts into it; 'fade' (default for spectral presence) dissolves
   *  in place at once, like a ghost; 'crumble' clatters apart into falling bone
   *  / debris (skeletons, constructs). */
  deathStyle?: 'collapse' | 'fade' | 'crumble';
  /** Joints that can be DISMEMBERED on a killing blow to the matching hurtbox
   *  zone (e.g. ['head'] → a head-zone kill beheads). The zone id must equal
   *  the joint name. Omit → no dismemberment. */
  severable?: string[];

  /** Boss flag — drives the Dark Souls-style boss bar + "this is a boss"
   *  treatment (the bar finds the live boss enemy by this). */
  isBoss?: boolean;
  /** Stay dormant (no perception / aggro / attacks) until the boss
   *  ENCOUNTER is engaged — i.e. the player crosses the fog gate. Souls-
   *  style: the fight begins on commitment, not on line-of-sight. Requires
   *  a fog wall in the level (else it would never wake). */
  dormantUntilEngaged?: boolean;
  /** Cinematic ENTRANCE played when a dormant boss wakes (crosses the fog gate).
   *  'ceiling-drop': the boss waits hidden above the arena, then plummets to the
   *  floor with an impact quake during the engage grace. Requires
   *  dormantUntilEngaged. Omit for a boss that's simply already standing there. */
  entrance?: 'ceiling-drop';
  /** Name shown on the boss bar (grimdark, e.g. "The Hollow Choir"). */
  bossName?: string;
  /** Visual model scale multiplier — bosses loom larger than trash. The
   *  built model group is scaled by this; gameplay reach/collision still
   *  come from the explicit stat fields. Default 1. */
  scale?: number;

  // --- Stats ---
  hp: number;
  /** Poise — the stagger pool the player's heavy/Might-scaled hits chip
   *  at; break it and the enemy is staggered (action cancelled, free-hit
   *  window). Omitted → default scales with hp (bosses get a much larger
   *  pool). Set explicitly to make a mob tankier or flimsier vs stagger
   *  independent of its HP. See the poise system in mobs/enemy.ts. */
  poise?: number;
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
  /** Skeleton-first creature — the one model path. Dimensions + hurtbox are
   *  MEASURED from the built Creature (see docs/CREATURE-SYSTEM.md). Bespoke
   *  bosses (marrow, mimic) reach their old geometry through a custom skeleton
   *  on the spec, so they ride this path too. */
  creature: CreatureSpec;
  /** Base emissive intensity for the 'eye' material (used by AI for windup flare). */
  baseEyeEmissive: number;
  collisionRadius: number;
  /** Height the swing aims at + where the damage number floats from.
   *  Defaults to the creature's MEASURED body centre × scale. Pin it only to
   *  override that measurement (e.g. aim at a boss's core rather than its
   *  bounding-box centre). */
  aimHeight?: number;
  /** Combat hit radius — the swing's reach extends to the body's SURFACE
   *  this far out from `position`, so a big enemy is hittable without
   *  having to stand on its exact centre. Default 0 (point target).
   *  Independent of collisionRadius (movement) — a translucent walk-into
   *  boss can be small for movement yet large for hits. */
  hitRadius?: number;
  // --- Animation hooks (part / material names within `creature`) ---
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
   * Peripheral-sight radius — within this, the enemy notices the player in ANY
   * direction provided it has line of sight (no cone), even while idle/looking
   * away. Bigger than hearingRange (which is through-wall); needs LOS. Stops
   * "only aggros when you're on top of it" while keeping long-range stealth past
   * this radius (the cone still gates distant detection). Default
   * CONFIG.ENEMY_AI.PERIPHERAL_RANGE (4.5). Raise for an alert predator.
   */
  peripheralRange?: number;
  /**
   * Seconds without LOS before deaggro. Default 4. Damage taken refreshes
   * this timer (a hurt enemy stays aware).
   */
  loseSightTime?: number;

  // --- Drops ---
  /** Which unified DROP TABLE (content/drop-tables.ts) this mob rolls on death.
   *  Omitted → 'enemy' (the small layer: gold + the odd key/consumable). Tag
   *  elites 'enemy-elite', bosses 'boss' (a relic). Gold + items both come from
   *  the table — no per-enemy pool arrays or gold ranges anymore. */
  dropTable?: DropTableId;

  // --- Reward ---
  /**
   * XP granted on kill. Spawned as that many XP wisps from the mob's
   * death position; each wisp homes in on the player and grants 1 XP
   * when absorbed. Default 1 (trash mob); bosses go much higher.
   */
  xp?: number;

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
   * Personality defaults for the Intent layer (Enemy AI V2 — docs/ENEMY-AI-V2.md).
   * Each 0..1; omitted fields default to 0.5, and spawn adds ±jitter so a pack
   * has a coward and a berserker. `boldness` = rushes in + swings vs hangs back;
   * `patience` = waits for openings vs constant pressure; `packLoyalty` reserved
   * for Stage 3 flank coordination. A tank might be {boldness:0.3, patience:0.8};
   * a swarm rat {boldness:0.8, patience:0.2}. Ignored for bosses (they opt out).
   */
  disposition?: { boldness?: number; patience?: number; packLoyalty?: number };

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
  presence?: 'spectral' | 'lurch' | 'twitch' | 'coiled' | 'chant' | 'gelatinous';

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

  // --- Multi-phase boss ---
  /**
   * Phase progression. When set, the enemy starts in phase[0] (its HP,
   * abilities, and stat overrides replace the top-level ones for as long
   * as the phase is active). When current phase HP hits 0 AND there's
   * a next phase, the boss transitions: enters an invuln window, hides
   * the phase's `hideParts` from the model, applies stat/rig overrides
   * for the new phase. When the LAST phase HP hits 0, the boss dies
   * normally.
   *
   * Existing single-phase enemies omit this field — top-level hp +
   * abilities apply directly, no transitions. Backwards-compat.
   */
  phases?: PhaseSpec[];

  /**
   * Optional keyframe animation bundle. When set, the mob spawns with
   * a clip Animator driving the model's joint slots — idle/walk loops
   * for locomotion, one-shot ability clips on windup. The bundle's
   * `joints` array names the slots; only mobs whose ModelSpec exposes
   * those slots get animated. Omitted = the legacy body-anim only
   * (head crane + gait hips), unchanged.
   */
  animation?: AnimationBundle;
}

/**
 * Animation bundle — the clip set + joint set a mob uses. `walk` plays
 * while chasing, `idle` everywhere else; `crawl` overrides walk when a
 * phase declares `useCrawlAnimation`. Ability clips are looked up by
 * `Ability.id` and stretched to fit the ability's full window.
 */
export interface AnimationBundle {
  idle: Clip;
  walk: Clip;
  crawl?: Clip;
  abilities: Record<string, Clip>;
  /** Joint slot names the animator may write into. Slots the model
   *  doesn't declare are silently skipped. */
  joints: readonly string[];
}

export interface PhaseSpec {
  /** Phase-specific HP pool. */
  hp: number;
  /** Phase-specific ability list. Replaces top-level abilities while
   *  this phase is active. */
  abilities: Ability[];
  /** Optional move-speed override. Defaults to the spec's moveSpeed. */
  moveSpeed?: number;
  /** Optional POISE override for this phase — the stagger pool the player's
   *  heavy hits chip. A very high value makes the phase effectively UNSTUNNABLE
   *  ("it sings through your blows"); omit to keep the pool from the previous
   *  phase. Refilled on phase entry either way. See the poise system in enemy.ts. */
  poise?: number;
  /** Names of model parts to HIDE when this phase begins (e.g. legs
   *  for the skeleton's crawl phase). Cumulative — parts hidden in
   *  earlier phases stay hidden. */
  hideParts?: string[];
  /** Rig Y offset applied when this phase begins. Negative = lower
   *  the model (crawl). Stacks with the rig's authored y. */
  rigYOffset?: number;
  /** Rig X-rotation applied when this phase begins. Forward tilt for
   *  a crawl pose. */
  rigPitch?: number;
  /** Invulnerability duration on phase entry (seconds). Use to play
   *  the transition animation without taking damage. Default 0. */
  invulnEntryTime?: number;
  /** If true, the keyframe animator uses the bundle's `crawl` clip in
   *  place of `walk` while this phase is active (and `idle` still plays
   *  when stopped — falls back to walk if the bundle has no crawl). */
  useCrawlAnimation?: boolean;
  /** Intra-phase HP thresholds — when current phase HP drops below
   *  `atHp`, hide the specified parts. Used for cosmetic feedback
   *  like "kill the left leg first, then the right." Threshold check
   *  fires once per threshold per phase. */
  partBreaks?: Array<{ atHp: number; hideParts: string[] }>;
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

// (Enemy drops are the unified drop-table system now — content/drop-tables.ts.
//  A mob names a tier via `dropTable`; there are no per-enemy pool arrays.)

// --- Audio vocabulary ---------------------------------------------------
// Which sound an enemy makes lives with the enemy data, not in the mob
// runtime. mobs/enemy.ts reads these by spec id (default 'medium' / silent
// for anything unlisted) so adding a creature's voice is a content edit.

/** Death + windup size bucket — keeps big mobs sounding big and the
 *  wraith reading as spectral rather than physical. Default: 'medium'. */
