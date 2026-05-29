import type { ModelSpec, Vec3 } from '../ecs/model-types';
import type { DamageType } from '../combat/damage';
import type { Ability } from './abilities';

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

  /**
   * ASCII tile character used to place this enemy in a vault map AND
   * the char procgen emits for it. THE SINGLE SOURCE OF TRUTH for this
   * enemy's map char — `tilemap.ts` (parsing + FLOOR_CHARS) and
   * `procgen.ts` (roll → char) both DERIVE from this via the registry
   * maps below, so the char can't drift out of sync across files.
   *
   * Must be unique and must not collide with a reserved structural /
   * placeholder char (validated at module load — a clash throws). Omit
   * for enemies that are never placed directly (e.g. ooze-small, which
   * only appears via split-on-death).
   */
  tileChar?: string;

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

// --- Model factories ----------------------------------------------------

// Two simple, distinct humanoid silhouettes built from primitives. Defined as
// functions of (bodyColor, eyeColor) so a future "elite ghoul" with a different
// palette doesn't need a duplicate model — it's the same shape with new
// material colors.

function humanoidGhoulModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Grounded lurching corpse. Rig sits HIGHER (1.05) so the torso isn't
  // a capsule dragging on the floor — it's a body STANDING on stumpy
  // legs and flat ankle-less feet. Heavy asymmetry up top (left shoulder
  // bigger, left arm longer), wide bowed legs below. Faint festering
  // emissive; no rim (this is flesh, not spectral).
  return {
    id: 'ghoul-humanoid',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x180806,
        emissiveIntensity: 0.35,
        flatShading: 'auto',
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 1.05, 0] },
      weapon:   { pos: [0.35, 1.15, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.9, 0] satisfies Vec3 },
      // Shoulder pivots (parented to rig) — the pose-clip layer swings
      // these so the ghoul's arms heave up on windup + slam on strike.
      shoulderL: { pos: [-0.34, 0.20, 0.06], parent: 'rig' },
      shoulderR: { pos: [ 0.34, 0.20, 0.06], parent: 'rig' },
    },
    parts: [
      // FEET — wide low cylinders flat on the floor. The "stumps" the
      // body stands on. Slight forward offset on one foot so the stance
      // reads as off-balance.
      { parent: 'rig', kind: 'cylinder', pos: [-0.20, -1.00, 0.04], radius: 0.16, height: 0.08, segments: 8, mat: 'body', jitter: 0.012 },
      { parent: 'rig', kind: 'cylinder', pos: [ 0.20, -1.00, -0.02], radius: 0.16, height: 0.08, segments: 8, mat: 'body', jitter: 0.012 },
      // LEGS — thick stumpy capsules bowed outward (different lengths
      // matching the asymmetric body theme).
      { parent: 'rig', kind: 'capsule', pos: [-0.20, -0.65, 0], radius: 0.13, height: 0.40, mat: 'body', jitter: 0.018 },
      { parent: 'rig', kind: 'capsule', pos: [ 0.20, -0.62, 0], radius: 0.12, height: 0.36, mat: 'body', jitter: 0.018 },
      // BODY — sits on top of the legs. Shorter than before (0.55) so
      // proportions read "torso on legs" not "leg-less capsule."
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.10, 0], scale: [1.10, 0.95, 0.95], radius: 0.34, height: 0.55, mat: 'body', jitter: 0.030 },
      // ASYMMETRIC SHOULDER HUMPS — left noticeably larger.
      { parent: 'rig', kind: 'sphere', pos: [-0.32, 0.30, 0], radius: 0.22, segments: [12, 10], mat: 'body', jitter: 0.022 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.32, 0.35, 0], radius: 0.16, segments: [12, 10], mat: 'body', jitter: 0.022 },
      // ARMS — different lengths (left longer). Hung from the shoulder
      // pivots (pos relative to each pivot) so the pose layer swings them.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.085, height: 0.50, mat: 'body', jitter: 0.020 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.15, 0], radius: 0.080, height: 0.35, mat: 'body', jitter: 0.020 },
      // FISTS — asymmetric (left larger, hanging lower).
      { parent: 'shoulderL', kind: 'sphere', pos: [0, -0.54, 0], radius: 0.105, segments: [10, 8], mat: 'body', jitter: 0.018 },
      { parent: 'shoulderR', kind: 'sphere', pos: [0, -0.34, 0], radius: 0.088, segments: [10, 8], mat: 'body', jitter: 0.018 },
      // HEAD — hunched forward (z=-0.05) on a short thick neck.
      { name: 'head', parent: 'rig', kind: 'sphere',  pos: [0, 0.55, -0.05], scale: [1.08, 0.95, 1], radius: 0.27, mat: 'body', jitter: 0.025 },
      // Eyes — slightly closer together than wraith, set deep.
      { parent: 'rig', kind: 'sphere', pos: [-0.08, 0.58, -0.30], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.08, 0.58, -0.30], radius: 0.045, segments: [12, 10], mat: 'eyes' },
    ],
  };
}

// Quadruped — body horizontal, four small leg capsules, long tail. Demonstrates
// the model system handling a fundamentally different silhouette from primitives.
function quadrupedRatModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Mangy, twitchy quadruped. Light jitter (small creature — heavy jitter
  // would collapse the silhouette). Whiskers added as thin cones forward
  // of the snout. Eye glow turned up so a darting red pinprick reads at
  // a glance even when the body's near-black against floor.
  return {
    id: 'rat-quadruped',
    materials: {
      // Slight emissive on the body so the rat doesn't black out completely
      // in unlit floor gaps. Dark warm tone.
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x0a0604,
        emissiveIntensity: 0.5,
        flatShading: 'auto',
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      // Whisker material — flat, no jitter, very dim.
      whisker: { color: 0x1a1410, roughness: 1.0, flatShading: 'auto' },
    },
    slots: {
      rig: { pos: [0, 0.14, 0] },
      back: { pos: [0, 0.22, 0] },
    },
    parts: [
      // Body — light jitter; the rat is small so big amplitudes would
      // tear the capsule.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], radius: 0.10, height: 0.28, mat: 'body', jitter: 0.008 },
      // Head — same light jitter as body.
      { name: 'head', parent: 'rig', kind: 'sphere', pos: [0, -0.01, -0.22], radius: 0.085, mat: 'body', jitter: 0.008 },
      // Snout
      { parent: 'rig', kind: 'cone', pos: [0, -0.025, -0.30], rot: [-Math.PI / 2, 0, 0], radius: 0.04, height: 0.07, segments: 8, mat: 'body' },
      // Eyes — popped out of the head surface.
      { parent: 'rig', kind: 'sphere', pos: [-0.05, 0.025, -0.305], radius: 0.022, mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.05, 0.025, -0.305], radius: 0.022, mat: 'eyes' },
      // Eye halo sprites — tiny additive flares so the eyes read at distance
      // (the spheres alone go to a pixel each on a phone screen).
      { parent: 'rig', kind: 'sprite', pos: [-0.05, 0.025, -0.31], size: [0.08, 0.08], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { parent: 'rig', kind: 'sprite', pos: [ 0.05, 0.025, -0.31], size: [0.08, 0.08], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      // Whiskers — four thin cones sticking forward, slightly fanned. Sells
      // "rodent" in one glance.
      { parent: 'rig', kind: 'cylinder', pos: [-0.045, -0.005, -0.35], rot: [-Math.PI / 2, 0,  0.5], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      { parent: 'rig', kind: 'cylinder', pos: [-0.04,  -0.025, -0.35], rot: [-Math.PI / 2, 0,  0.3], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      { parent: 'rig', kind: 'cylinder', pos: [ 0.045, -0.005, -0.35], rot: [-Math.PI / 2, 0, -0.5], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      { parent: 'rig', kind: 'cylinder', pos: [ 0.04,  -0.025, -0.35], rot: [-Math.PI / 2, 0, -0.3], radius: 0.001, radiusTop: 0.003, height: 0.08, segments: 4, mat: 'whisker' },
      // Four legs
      { parent: 'rig', kind: 'capsule', pos: [-0.07, -0.10, -0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.07, -0.10, -0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [-0.07, -0.10,  0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.07, -0.10,  0.10], radius: 0.022, height: 0.05, mat: 'body' },
      // Tail — light jitter for irregular mangy look.
      { parent: 'rig', kind: 'cylinder', pos: [0, 0, 0.28], rot: [Math.PI / 2, 0, 0], radius: 0.015, radiusTop: 0.005, height: 0.30, segments: 6, mat: 'body', jitter: 0.006 },
    ],
  };
}

// Acolyte — hooded ranged caster. Wider robe extrude underneath (no
// visible feet — looks like it's floating in fabric), tall thin body
// capsule, dark hooded head (eyes deep-set, glowing slits), staff parented
// to the weapon slot with a glowing orb at the tip that matches the
// projectile color. Reads at a glance: "thin dark figure with a glowing
// stick — that one shoots."
function acolyteModel(bodyColor: number, eyeColor: number, eyeEmissive: number, staffGlow: number): ModelSpec {
  // Ritual caster. Robe gets heavy jitter (torn ceremonial fabric);
  // body gets a faint green rim — the magic they channel illuminates
  // them from within at the edges. 'chant' presence pulses the orb's
  // emissive each frame so the staff feels alive even at rest.
  return {
    id: 'acolyte-caster',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        flatShading: 'auto',
        // Subtle channelled-magic rim — same green family as the orb
        // but desaturated so it reads as reflected glow, not the orb
        // itself bleeding through the body.
        rim: { color: 0x3a8060, power: 3.5, intensity: 0.6 },
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      robe: {
        color: 0x080a0e,
        roughness: 1.0,
        flatShading: 'auto',
        // Robe gets the same faint green rim as the body — keeps the
        // overall silhouette outlined in the magic palette.
        rim: { color: 0x224c3a, power: 3.5, intensity: 0.5 },
        dissolvable: true,
      },
      staff: { color: 0x1a140e, roughness: 0.9, flatShading: 'auto', dissolvable: true },
      orb: { color: 0x000000, emissive: staffGlow, emissiveIntensity: 2.6, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 0.85, 0] },
      muzzle: { pos: [0.30, 1.20, -0.15] satisfies Vec3 },
    },
    parts: [
      // Robed trailing tail — torn fabric look via heavy jitter on the
      // extruded silhouette.
      {
        kind: 'extrude', parent: 'rig',
        pos: [0, -0.55, 0],
        shape: [
          [-0.26, 0.55], [-0.34, 0.10], [-0.22, -0.35], [-0.08, -0.50],
          [ 0.08, -0.50], [ 0.22, -0.35], [ 0.34, 0.10], [ 0.26, 0.55],
        ],
        depth: 0.05,
        mat: 'robe',
        jitter: 0.025,
      },
      // Body — light jitter (the body is mostly hidden by robe; heavy
      // jitter would distort the robe shape too).
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0.05, 0], radius: 0.26, height: 0.85, mat: 'robe', jitter: 0.012 },
      // Head — slightly elongated, light jitter.
      { name: 'head', parent: 'rig', kind: 'sphere', pos: [0, 0.75, 0], scale: [1, 1.10, 1], radius: 0.22, mat: 'body', jitter: 0.014 },
      // Hood — cone with jitter so the fabric reads as crumpled/torn,
      // not factory-made.
      { parent: 'rig', kind: 'cone', pos: [0, 0.86, 0.02], radius: 0.30, height: 0.40, segments: 10, mat: 'robe', jitter: 0.020 },
      // Eyes — small mesh spheres deep under the hood.
      { parent: 'rig', kind: 'sphere', pos: [-0.08, 0.74, -0.20], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.08, 0.74, -0.20], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { name: 'eyeHaloL', parent: 'rig', kind: 'sprite', pos: [-0.08, 0.74, -0.24], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { name: 'eyeHaloR', parent: 'rig', kind: 'sprite', pos: [ 0.08, 0.74, -0.24], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      // Staff — thin, slight jitter for hand-carved feel.
      { parent: 'rig', kind: 'cylinder', pos: [0.30, 0.10, -0.05], radius: 0.025, height: 1.4, segments: 6, mat: 'staff', jitter: 0.008 },
      // Orb — clean (no jitter; magic geometry should look intentional).
      { parent: 'rig', kind: 'sphere', pos: [0.30, 0.80, -0.05], radius: 0.085, segments: [12, 10], mat: 'orb' },
      // Halo around the orb so the projectile color reads at distance.
      { parent: 'rig', kind: 'sprite', pos: [0.30, 0.80, -0.05], size: [0.40, 0.40], texture: 'fire-wisp', blending: 'additive', color: staffGlow },
    ],
  };
}

function skirmisherModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Grounded lean predator — distinct from the ghoul by silhouette
  // alone:
  //   - Tall + narrow (vs ghoul's bulky + hunched).
  //   - Symmetric (vs ghoul's asymmetric).
  //   - Thin legs + small box feet (vs ghoul's stumpy cylinders).
  //   - Crossed-belt sash + ribbed loincloth (clothed; the ghoul is
  //     bare flesh).
  // Faint amber rim catches light on edges — reads as taut skin over
  // wiry muscle, not wraith-style spectral glow.
  return {
    id: 'skirmisher-humanoid',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        flatShading: 'auto',
        rim: { color: 0x9c6a3a, power: 3.5, intensity: 0.55 },
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      strap: { color: 0x0d0a07, roughness: 1.0, flatShading: 'auto', dissolvable: true },
    },
    slots: {
      rig: { pos: [0, 1.00, 0] },
      weapon:   { pos: [0.28, 1.0, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.85, 0] satisfies Vec3 },
      // Shoulder PIVOTS — parented to the rig so they follow the body
      // lean AND can swing the arms independently (the pose-clip layer
      // rotates these). Arms + fists hang below each pivot.
      shoulderL: { pos: [-0.24, 0.16, 0], parent: 'rig' },
      shoulderR: { pos: [ 0.24, 0.16, 0], parent: 'rig' },
    },
    parts: [
      // FEET — narrow boxes (not cylinders like ghoul). Reads pointier,
      // more pickpocket than zombie.
      { parent: 'rig', kind: 'box', size: [0.13, 0.06, 0.22], pos: [-0.11, -0.96, 0.05], mat: 'body', jitter: 0.009 },
      { parent: 'rig', kind: 'box', size: [0.13, 0.06, 0.22], pos: [ 0.11, -0.96, 0.05], mat: 'body', jitter: 0.009 },
      // LEGS — thin (radius 0.075, taller 0.50 height). Held vertical,
      // closer together than ghoul's bowed stance.
      { parent: 'rig', kind: 'capsule', pos: [-0.11, -0.55, 0], radius: 0.075, height: 0.55, mat: 'body', jitter: 0.010 },
      { parent: 'rig', kind: 'capsule', pos: [ 0.11, -0.55, 0], radius: 0.075, height: 0.55, mat: 'body', jitter: 0.010 },
      // BODY — narrower than ghoul (radius 0.25 vs 0.34), TALLER torso.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.05, 0], scale: [0.90, 1.10, 1.0], radius: 0.25, height: 0.60, mat: 'body', jitter: 0.013 },
      // CROSSED-BELT SASH — angled across the chest.
      { parent: 'rig', kind: 'extrude', pos: [0, 0.15, -0.24], rot: [0, 0, 0.55],
        shape: [[-0.30, -0.03], [0.30, -0.03], [0.30, 0.03], [-0.30, 0.03]],
        depth: 0.04, mat: 'strap' },
      // LOINCLOTH — small extruded strip around the waist. Sells "clothed"
      // and visually separates body from legs.
      { parent: 'rig', kind: 'extrude', pos: [0, -0.30, 0],
        shape: [[-0.22, -0.05], [0.22, -0.05], [0.22, 0.05], [-0.22, 0.05]],
        depth: 0.32, mat: 'strap' },
      // Shoulder humps — small + symmetric.
      { parent: 'rig', kind: 'sphere', pos: [-0.22, 0.25, 0], radius: 0.12, segments: [12, 10], mat: 'body', jitter: 0.011 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.22, 0.25, 0], radius: 0.12, segments: [12, 10], mat: 'body', jitter: 0.011 },
      // Arms — long thin capsules, hung from the shoulder PIVOTS (not
      // the rig) so the pose-clip layer can swing them on the charge.
      // pos is relative to the shoulder slot; the capsule hangs below it.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.28, 0.04], radius: 0.050, height: 0.55, mat: 'body', jitter: 0.011 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.28, 0.04], radius: 0.050, height: 0.55, mat: 'body', jitter: 0.011 },
      // Small fists — at the end of each arm, also under the pivot.
      { parent: 'shoulderL', kind: 'sphere', pos: [0, -0.58, 0.04], radius: 0.060, segments: [10, 8], mat: 'body', jitter: 0.010 },
      { parent: 'shoulderR', kind: 'sphere', pos: [0, -0.58, 0.04], radius: 0.060, segments: [10, 8], mat: 'body', jitter: 0.010 },
      // Head — narrow + slightly forward (craned, scout-like).
      { name: 'head', parent: 'rig', kind: 'sphere',  pos: [0, 0.50, -0.06], scale: [0.85, 1.05, 1.05], radius: 0.20, mat: 'body', jitter: 0.012 },
      // Eyes — wider apart than ghoul, push the alert-predator read.
      { parent: 'rig', kind: 'sphere', pos: [-0.08, 0.52, -0.26], radius: 0.040, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.08, 0.52, -0.26], radius: 0.040, segments: [12, 10], mat: 'eyes' },
      // Eye halos (amber).
      { parent: 'rig', kind: 'sprite', pos: [-0.08, 0.52, -0.29], size: [0.14, 0.14], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { parent: 'rig', kind: 'sprite', pos: [ 0.08, 0.52, -0.29], size: [0.14, 0.14], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
    ],
  };
}

// Wraith — tall hovering spectral figure. Pale glowing body, sunken eyes,
// magic-damage melee. Slow + telegraphed but hits hard and bypasses
// physical armor entirely (only magic-armor reduces). Pairs with the bone
// amulet's magic-armor passive as a real soft-counter.
function wraithModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Spectral palette tuned for "soft ghost glow at body edges" — emissive
  // ramped up so the silhouette reads in shadow, color shifted slightly
  // cooler than the previous teal.
  return {
    id: 'wraith',
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x2a4a5c,
        emissiveIntensity: 0.55,
        flatShading: 'auto',
        // Fresnel rim — fragments at the silhouette edge get a soft
        // teal glow. Sells "ghost" without translucency. Tuned cooler
        // than the eye color so it reads as ambient spectral presence,
        // not as the eyes themselves leaking.
        rim: { color: 0x4a8cb0, power: 2.2, intensity: 1.4 },
        dissolvable: true,
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      robe: {
        color: 0x070b10,
        roughness: 1.0,
        flatShading: 'auto',
        // Robe gets a much subtler rim — it's near-black, so a soft
        // edge glow keeps its silhouette visible against the fog.
        rim: { color: 0x1f3340, power: 3.0, intensity: 0.8 },
        dissolvable: true,
      },
      // 'bone' — used for the gnarled arms + claw tips. Paler than the
      // body to read as exposed bone reaching out of the robe sleeves.
      bone: {
        color: 0x4a4338,
        roughness: 1.0,
        emissive: 0x1a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
        // Bone rim is pale cyan-white — reads as cold light catching
        // on bone surfaces.
        rim: { color: 0xa8d4e0, power: 2.8, intensity: 1.1 },
        dissolvable: true,
      },
    },
    slots: {
      // 'rig' sits HIGHER than other enemies so the wraith visibly floats —
      // feet should be off the floor. The presence-tick adds a slow bob
      // on top of this baseline.
      rig: { pos: [0, 1.05, 0] },
      // Shoulder pivots — the spindly arms reach forward on the strike.
      shoulderL: { pos: [-0.32, 0.20, 0.06], parent: 'rig' },
      shoulderR: { pos: [ 0.32, 0.20, 0.06], parent: 'rig' },
    },
    parts: [
      // OUTER AURA — large additive sprite behind everything else. Reads
      // as "this thing has presence beyond its physical body." Cool teal
      // matches the body emissive. Big enough to bloom outside the
      // silhouette, low enough alpha that it doesn't wash the room.
      { parent: 'rig', kind: 'sprite', pos: [0, 0.20, 0.05], size: [1.7, 2.2], texture: 'fire-wisp', blending: 'additive', color: 0x224058 },

      // ROBE TAIL — wider, more irregular silhouette than the original
      // (note the asymmetric points — left side shorter, right side
      // ragged). Heavy jitter on the extrude vertices gives torn-fabric
      // edges that vary per-instance.
      {
        kind: 'extrude', parent: 'rig',
        pos: [0, -0.55, 0],
        shape: [
          [-0.22, 0.55], [-0.34, 0.10], [-0.30, -0.20], [-0.22, -0.45], [-0.08, -0.55],
          [ 0.04, -0.50], [ 0.16, -0.58], [ 0.28, -0.35], [ 0.34, -0.05], [ 0.30, 0.25], [ 0.22, 0.55],
        ],
        depth: 0.06,
        mat: 'robe',
        jitter: 0.035,
      },

      // BODY — tall capsule, jittered so the surface looks gnarled rather
      // than a polished pill. Slight horizontal scale so it's not a perfect
      // cylinder of revolution; reads more like robed shoulders.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0.05, 0], scale: [1.05, 1, 1], radius: 0.30, height: 0.80, mat: 'body', jitter: 0.035 },

      // SHOULDER HUMPS — small spheres jutting out at the shoulders to
      // break the cylindrical body silhouette. Each one gets independent
      // jitter so the two shoulders aren't symmetric.
      { parent: 'rig', kind: 'sphere', pos: [-0.30, 0.40, 0.02], radius: 0.16, segments: [12, 10], mat: 'body', jitter: 0.025 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.30, 0.40, 0.02], radius: 0.16, segments: [12, 10], mat: 'body', jitter: 0.025 },

      // ARMS — long thin capsules hung from the shoulder pivots.
      // "Spindly," not muscular. The bone material reads paler so they
      // pop against the dark body. Heavy jitter twists them into gnarled
      // limbs. The pivots let them reach forward on the strike.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.045, height: 0.55, mat: 'bone', jitter: 0.020 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.25, 0], radius: 0.045, height: 0.55, mat: 'bone', jitter: 0.020 },

      // CLAW TIPS — small jittered spheres at the bottom of each arm so
      // the silhouette ends in something pointy rather than rounded.
      { parent: 'shoulderL', kind: 'sphere', pos: [-0.02, -0.62, 0], radius: 0.055, segments: [10, 8], mat: 'bone', jitter: 0.025 },
      { parent: 'shoulderR', kind: 'sphere', pos: [ 0.02, -0.62, 0], radius: 0.055, segments: [10, 8], mat: 'bone', jitter: 0.025 },

      // HEAD — sphere with vertical scale + jitter. Used to be a clean
      // ovoid; now it's a gnarled skull-ish shape unique to each instance.
      { name: 'head', parent: 'rig', kind: 'sphere', pos: [0, 0.75, 0], scale: [1, 1.18, 1], radius: 0.24, mat: 'body', jitter: 0.030 },

      // EYE SPHERES + HALO SPRITES — same dual-layer pattern as before
      // (mesh for close-up, sprite for distance). Slightly bigger halos
      // since the rest of the model grew.
      { parent: 'rig', kind: 'sphere', pos: [-0.10, 0.78, -0.30], radius: 0.06, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.10, 0.78, -0.30], radius: 0.06, segments: [12, 10], mat: 'eyes' },
      { name: 'eyeHaloL', parent: 'rig', kind: 'sprite', pos: [-0.10, 0.78, -0.34], size: [0.26, 0.26], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { name: 'eyeHaloR', parent: 'rig', kind: 'sprite', pos: [ 0.10, 0.78, -0.34], size: [0.26, 0.26], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
    ],
  };
}

// Stoneguard — slow tanky armoured brute. Box-heavy silhouette to read
// as "this one wears plates, not flesh." Tiny recessed eye slits (no
// flaring red — this is mineral, not feral). One arm carries a maul:
// thick handle + spherical stone head, the visible threat.
function stoneguardModel(bodyColor: number, eyeColor: number): ModelSpec {
  return {
    id: 'stoneguard',
    materials: {
      // Stone — warm gray, very rough, faint dust emissive so it reads
      // even in dark corners without becoming a silhouette.
      body: {
        color: bodyColor,
        roughness: 0.95,
        emissive: 0x0a0908,
        emissiveIntensity: 0.35,
        flatShading: 'auto',
        dissolvable: true,
      },
      // Eye slits — dim red, almost embers behind the helmet rather
      // than the bright glares the flesh mobs have.
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: 1.2, roughness: 1.0 },
      // Maul head — slightly more metallic so it picks up torchlight
      // distinctly from the stone body. Reads as the swung weapon.
      maul: { color: 0x2a2622, roughness: 0.55, metalness: 0.6, flatShading: 'auto' },
    },
    slots: {
      rig: { pos: [0, 1.20, 0] },     // taller than ghoul (1.05)
      // Shoulder pivots under the pauldrons. The maul rides the RIGHT
      // pivot, so the pose layer heaves it overhead on windup and slams
      // it down on strike — the stoneguard's signature crusher.
      shoulderL: { pos: [-0.45, 0.18, 0], parent: 'rig' },
      shoulderR: { pos: [ 0.45, 0.18, 0], parent: 'rig' },
    },
    parts: [
      // FEET — wide stone slabs.
      { parent: 'rig', kind: 'box', pos: [-0.22, -1.12, 0], size: [0.30, 0.12, 0.36], mat: 'body', jitter: 0.012 },
      { parent: 'rig', kind: 'box', pos: [ 0.22, -1.12, 0], size: [0.30, 0.12, 0.36], mat: 'body', jitter: 0.012 },
      // LEGS — thick boxy greaves.
      { parent: 'rig', kind: 'box', pos: [-0.22, -0.70, 0], size: [0.26, 0.70, 0.26], mat: 'body', jitter: 0.018 },
      { parent: 'rig', kind: 'box', pos: [ 0.22, -0.70, 0], size: [0.26, 0.70, 0.26], mat: 'body', jitter: 0.018 },
      // TORSO — the defining plate. Boxy, wide. Slight overhang at
      // the shoulders sells "armoured."
      { name: 'body', parent: 'rig', kind: 'box', pos: [0, -0.05, 0], size: [0.70, 0.65, 0.42], mat: 'body', jitter: 0.024 },
      // SHOULDER PAULDRONS — flanking the torso top, blocky.
      { parent: 'rig', kind: 'box', pos: [-0.45, 0.20, 0], size: [0.22, 0.22, 0.30], mat: 'body', jitter: 0.020 },
      { parent: 'rig', kind: 'box', pos: [ 0.45, 0.20, 0], size: [0.22, 0.22, 0.30], mat: 'body', jitter: 0.020 },
      // ARMS — thick capsules hung from the shoulder pivots so they
      // heave with the swing.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, -0.28, 0], radius: 0.11, height: 0.40, mat: 'body', jitter: 0.018 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, -0.28, 0], radius: 0.11, height: 0.40, mat: 'body', jitter: 0.018 },
      // OFF-SIDE FIST — bare, on the left pivot.
      { parent: 'shoulderL', kind: 'sphere', pos: [0, -0.60, 0], radius: 0.13, segments: [10, 8], mat: 'body', jitter: 0.018 },
      // MAUL — handle (thin capsule) + head (chunky box), on the RIGHT
      // pivot so it swings overhead → down with the strike. The head
      // sits below the fist for a "resting at the ready" rest pose.
      { parent: 'shoulderR', kind: 'cylinder', pos: [0, -0.50, 0.05], radius: 0.025, height: 0.42, mat: 'maul' },
      { parent: 'shoulderR', kind: 'box',      pos: [0, -0.76, 0.05], size: [0.22, 0.22, 0.22], mat: 'maul', jitter: 0.010 },
      // HELMET — boxy faceplate sitting on a short neck. Slightly
      // narrower than the torso so the eye reads "head set in heavy
      // plate."
      { parent: 'rig', kind: 'box', pos: [0, 0.50, 0], size: [0.42, 0.36, 0.36], mat: 'body', jitter: 0.018 },
      // EYE SLITS — two tiny dim rectangles set deep into the helmet.
      // Small + recessed so the embers read as "behind a visor."
      { parent: 'rig', kind: 'box', pos: [-0.09, 0.52, -0.19], size: [0.06, 0.025, 0.02], mat: 'eyes' },
      { parent: 'rig', kind: 'box', pos: [ 0.09, 0.52, -0.19], size: [0.06, 0.025, 0.02], mat: 'eyes' },
    ],
  };
}

// Ooze — squat blobby creature, no humanoid silhouette. Built from a
// few squashed spheres with a brightly emissive interior orb so the
// "alive" reads even when the outer body is dim against a dark floor.
// `scale` lets the same model serve the big parent and the smaller
// split offspring without authoring two factories.
function oozeModel(bodyColor: number, innerColor: number, scale: number = 1): ModelSpec {
  // s — geometry multiplier. Applied through size/radius rather than
  // a parent group transform so collision radius (set on the spec, not
  // the model) and visible size stay in sync at the spec level.
  const s = scale;
  return {
    id: `ooze-${scale.toFixed(2)}`,
    materials: {
      body: {
        color: bodyColor,
        roughness: 0.55,
        emissive: 0x080a04,
        emissiveIntensity: 0.6,
        flatShading: 'auto',
        dissolvable: true,
        // Soft sickly rim so the silhouette glows faintly even when
        // the body is in shadow — the ooze should always read as
        // "wet", not "lump of stone."
        rim: { color: 0x88cc33, power: 2.2, intensity: 0.5 },
      },
      core: {
        color: 0x000000,
        emissive: innerColor,
        emissiveIntensity: 2.4,
        roughness: 1.0,
      },
    },
    slots: {
      rig: { pos: [0, 0.18 * s, 0] },
    },
    parts: [
      // OUTER BODY — squashed sphere (wide, low). Mild jitter for
      // organic surface variation; the rim glow + scale animation in
      // 'twitch' presence sells the "blob" feel.
      { name: 'body', parent: 'rig', kind: 'sphere', pos: [0, 0, 0], scale: [1.15 * s, 0.85 * s, 1.15 * s], radius: 0.22, segments: [16, 12], mat: 'body', jitter: 0.018 },
      // Slight TRAILING BUMP at the back — gives the blob a direction
      // hint (faces forward via the head position).
      { parent: 'rig', kind: 'sphere', pos: [0, -0.02 * s, 0.12 * s], radius: 0.12 * s, segments: [10, 8], mat: 'body', jitter: 0.015 },
      // CORE — bright emissive orb inside. Reads as the nucleus you
      // need to break.
      { parent: 'rig', kind: 'sphere', pos: [0, 0, 0], radius: 0.07 * s, segments: [10, 8], mat: 'core' },
    ],
  };
}

// --- Enemy registry -----------------------------------------------------

export const ENEMIES: Record<string, EnemySpec> = {
  ghoul: {
    id: 'ghoul',
    name: 'ghoul',
    tileChar: 'G',
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
    tileChar: 'R',
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
    tileChar: 'K',
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
        damage: 1, telegraph: 'charge', creep: false,
        effects: [{ kind: 'dash', speed: 7.5, toward: 'player', contactReach: 1.35, damageType: 'physical' }],
      },
      // SLASH — point-blank fallback when the player is already in melee
      // (or after a charge lands and they're still close).
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.4, strike: 0.14, recover: 0.5,
        damage: 1, telegraph: 'swing', creep: true,
        effects: [{ kind: 'melee', reach: 1.5, damageType: 'physical' }],
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
    tileChar: 'Y',
    hp: 2,                  // squishy — closing on it pays off fast
    moveSpeed: 1.7,         // mobile enough to actually kite a retreating gap
    attackDamage: 1,
    attackRange: 9,         // commits to casting from far out
    strikeRange: 9,         // projectile spawns at strike regardless of range
    preferredRange: 5.5,    // backs away when the player gets nearer than this
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
    tileChar: 'W',
    hp: 5,
    moveSpeed: 1.5,         // slow — heavily telegraphed bossier feel
    attackDamage: 2,        // hits twice as hard as the trash mobs
    attackRange: 1.7,
    strikeRange: 1.55,
    windupTime: 0.95,       // long, readable telegraph
    strikeTime: 0.22,
    recoverTime: 0.75,
    damageType: 'magic',    // bypasses physical armor entirely
    model: wraithModel(0x1a2a32, 0x66ffaa, 3.0),
    baseEyeEmissive: 3.0,
    collisionRadius: 0.40,
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
    tileChar: 'Z',
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
    tileChar: 'Q',               // NOT 'X' — 'X' is procgen's generic slot
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
    tileChar: 'M',
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
    tileChar: 'H',
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
        damage: 2, telegraph: 'cast',
        effects: [{ kind: 'aoe', radius: 1.9, targetMode: 'player', damageType: 'magic' }],
      },
      // SLASH — point-blank deterrent so hugging it isn't a free safe spot.
      {
        id: 'slash',
        minRange: 0, maxRange: 1.7,
        windup: 0.55, strike: 0.16, recover: 0.6,
        damage: 1, telegraph: 'swing', creep: true,
        effects: [{ kind: 'melee', reach: 1.5, damageType: 'magic' }],
      },
    ],
    // Recoloured ghoul silhouette (violet) — distinct model pending.
    model: humanoidGhoulModel(0x281830, 0xbb55ff, 2.6),
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
};

// ── Tile-char registry — single source of truth ─────────────────────
//
// Derived from each EnemySpec's `tileChar`. Everything that maps an
// enemy to a map character reads from HERE, never a hand-kept list:
//   - tilemap.ts   parsing (char → spawn) + FLOOR_CHARS
//   - procgen.ts   roll result (enemyId → char)
//
// So adding a placeable enemy = set its `tileChar`, done. No second
// edit, nothing to forget. Collisions throw at module load (below), so
// a clash with a structural tile, a placeholder, or another enemy is
// caught the instant the module is imported (dev / build / CI / snap).

// Chars the tile parser reserves for non-enemy use. Enemy tileChars
// must avoid all of these. Mirror of the structural cases in
// tilemap.ts's switch + the 'X'/'B' procgen slot placeholders + '#'
// (wall) and ' ' (wall). Keep in sync if a new STRUCTURAL tile is
// added — but enemies are now safe by construction.
const RESERVED_TILE_CHARS = new Set(
  ['#', ' ', 'X', 'B', '.', ',', 'S', 'o', 'O', 'D', '/', '^',
   'F', 'C', 'P', 'A', 'c', 'v', 'V', 'T', 't', '<', '>'],
);

/** char → enemyId. */
export const ENEMY_BY_CHAR = new Map<string, string>();
/** enemyId → char. */
export const ENEMY_CHAR_BY_ID: Record<string, string> = {};

for (const [id, spec] of Object.entries(ENEMIES)) {
  const ch = spec.tileChar;
  if (!ch) continue;
  if (ch.length !== 1) {
    throw new Error(`Enemy '${id}': tileChar must be a single character, got '${ch}'`);
  }
  if (RESERVED_TILE_CHARS.has(ch)) {
    throw new Error(`Enemy '${id}': tileChar '${ch}' collides with a reserved structural/placeholder tile char`);
  }
  const existing = ENEMY_BY_CHAR.get(ch);
  if (existing) {
    throw new Error(`Tile char '${ch}' claimed by both '${existing}' and '${id}'`);
  }
  ENEMY_BY_CHAR.set(ch, id);
  ENEMY_CHAR_BY_ID[id] = ch;
}
