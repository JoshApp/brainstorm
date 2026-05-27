import type { ModelSpec, Vec3 } from '../ecs/model-types';
import type { DamageType } from '../combat/damage';

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
      // ARMS — different lengths (left longer). Hang from shoulders.
      { parent: 'rig', kind: 'capsule', pos: [-0.34, -0.05, 0.06], radius: 0.085, height: 0.50, mat: 'body', jitter: 0.020 },
      { parent: 'rig', kind: 'capsule', pos: [ 0.34, 0.05, 0.06], radius: 0.080, height: 0.35, mat: 'body', jitter: 0.020 },
      // FISTS — asymmetric (left larger, hanging lower).
      { parent: 'rig', kind: 'sphere', pos: [-0.34, -0.34, 0.06], radius: 0.105, segments: [10, 8], mat: 'body', jitter: 0.018 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.34, -0.14, 0.06], radius: 0.088, segments: [10, 8], mat: 'body', jitter: 0.018 },
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
      // Arms — long thin capsules.
      { parent: 'rig', kind: 'capsule', pos: [-0.24, -0.12, 0.04], radius: 0.050, height: 0.55, mat: 'body', jitter: 0.011 },
      { parent: 'rig', kind: 'capsule', pos: [ 0.24, -0.12, 0.04], radius: 0.050, height: 0.55, mat: 'body', jitter: 0.011 },
      // Small fists.
      { parent: 'rig', kind: 'sphere', pos: [-0.24, -0.42, 0.04], radius: 0.060, segments: [10, 8], mat: 'body', jitter: 0.010 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.24, -0.42, 0.04], radius: 0.060, segments: [10, 8], mat: 'body', jitter: 0.010 },
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

      // ARMS — long thin capsules hanging from the shoulders. "Spindly,"
      // not muscular. The bone material reads paler so they pop against
      // the dark body. Heavy jitter twists them into gnarled limbs.
      { parent: 'rig', kind: 'capsule', pos: [-0.32, -0.05, 0.06], radius: 0.045, height: 0.55, mat: 'bone', jitter: 0.020 },
      { parent: 'rig', kind: 'capsule', pos: [ 0.32, -0.05, 0.06], radius: 0.045, height: 0.55, mat: 'bone', jitter: 0.020 },

      // CLAW TIPS — small jittered spheres at the bottom of each arm so
      // the silhouette ends in something pointy rather than rounded.
      { parent: 'rig', kind: 'sphere', pos: [-0.34, -0.42, 0.06], radius: 0.055, segments: [10, 8], mat: 'bone', jitter: 0.025 },
      { parent: 'rig', kind: 'sphere', pos: [ 0.34, -0.42, 0.06], radius: 0.055, segments: [10, 8], mat: 'bone', jitter: 0.025 },

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
    gold: [3, 7],
    drops: {
      // ~30% of kills drop one item from the pool. Scimitar is the
      // standout weight; rare rolls give a potion or piece of armor.
      // Ring-of-bloodthirst stays rare so finding one is genuinely
      // exciting.
      rate: 0.30,
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
    gold: [0, 2],
    drops: {
      // Trash mob — empty hands almost always. ~10% chance of a potion.
      rate: 0.10,
      pool: [
        { itemId: 'healing-potion', weight: 1 },
      ],
    },
  },

  skirmisher: {
    id: 'skirmisher',
    name: 'skirmisher',
    hp: 2,
    moveSpeed: 2.0,        // player retreat (2.5) outruns now
    attackDamage: 1,
    attackRange: 1.5,
    strikeRange: 1.35,     // smaller than attackRange — escapable
    windupTime: 0.65,      // snappier than ghoul, slower than rat
    strikeTime: 0.14,
    recoverTime: 0.55,
    model: skirmisherModel(0x18130d, 0xffb060, 2.0),
    baseEyeEmissive: 2.0,
    collisionRadius: 0.35,
    tiltPartName: 'rig',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
    presence: 'coiled',      // taut shoulder bob + subtle weight shift
    // Skirmisher is a scout — best vision of the trash mobs. Tighter
    // cone (predator focus) and longer range. Bad hearing for sneak-up.
    sightRange: 9,
    sightConeHalfAngle: 0.9,
    hearingRange: 2.0,
    loseSightTime: 5,
    xp: 3,
    gold: [1, 4],
    drops: {
      rate: 0.22,
      pool: [
        { itemId: 'healing-potion', weight: 4 },
        { itemId: 'worn-boots', weight: 2 },
        { itemId: 'ring-of-predation', weight: 1 },
      ],
    },
  },

  // Acolyte — ranged caster. Keeps distance, hurls a slow magic projectile
  // from the staff orb. Long telegraph (you can see the windup), but if it
  // lands you're hit through physical armor. Pairs as a back-line behind
  // melee mobs; on its own it's escapable by sidestep or charge-in.
  acolyte: {
    id: 'acolyte',
    name: 'acolyte',
    hp: 2,                  // squishier than a ghoul — break the line
    moveSpeed: 1.3,         // slow — keeps its distance, doesn't chase well
    attackDamage: 1,
    // For a shooter, attackRange = "how far away I'll cast from"; we want
    // this generous so it doesn't have to close to melee distance.
    attackRange: 8,
    strikeRange: 8,         // same — projectile spawns at strike phase regardless
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
    gold: [2, 6],
    drops: {
      rate: 0.28,
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
};
