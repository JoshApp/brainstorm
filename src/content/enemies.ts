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
   * Drop table. On death, each entry rolls INDEPENDENTLY against its
   * `chance` (default 1.0); successful rolls spawn a pickup of that item.
   * Multiple drops from the same kill spread in a small arc on the floor.
   */
  drops?: DropEntry[];

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
   * the per-state animation. 'spectral' = slow vertical bob + micro yaw
   * sway (sells "floating ghost" — used by wraiths). Phase is randomized
   * per-instance so a pair of wraiths drift out of sync.
   */
  presence?: 'spectral';
}

export interface DropEntry {
  itemId: string;
  /** Probability in [0,1] this item drops. Default 1.0. */
  chance?: number;
}

// --- Model factories ----------------------------------------------------

// Two simple, distinct humanoid silhouettes built from primitives. Defined as
// functions of (bodyColor, eyeColor) so a future "elite ghoul" with a different
// palette doesn't need a duplicate model — it's the same shape with new
// material colors.

function humanoidGhoulModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Humanoid ghoul. All visible parts are parented to a 'rig' slot (an
  // invisible Object3D anchor), NOT directly to the body mesh. This matches
  // the rat's working pattern — for reasons that remain a mystery, parenting
  // children directly to a Mesh prevented them from rendering on the phone-
  // facing snap path; parenting to an Object3D slot works correctly.
  //
  // tiltPart is 'rig' so the whole rig leans forward during windup as a unit.
  return {
    id: 'ghoul-humanoid',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 0.8, 0] },           // rig pivot at body-center height
      weapon:   { pos: [0.35, 0.9, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.8, 0] satisfies Vec3 },
    },
    parts: [
      // All visible parts parented to rig. Positions are RIG-LOCAL (i.e.
      // offset from rig pivot at world y=0.8, not from world origin).
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0, 0], radius: 0.35, height: 0.9, mat: 'body' },
      { name: 'head', parent: 'rig', kind: 'sphere',  pos: [0, 0.7, 0], radius: 0.28, mat: 'body' },
      // Eyes past head front (head front at rig-local z=-0.28). Modest
      // radius — the 180° rotation fix solved the visibility problem, no
      // need for the oversized eyes we tried during that debugging.
      { parent: 'rig', kind: 'sphere', pos: [-0.10, 0.74, -0.32], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.10, 0.74, -0.32], radius: 0.045, segments: [12, 10], mat: 'eyes' },
    ],
  };
}

// Quadruped — body horizontal, four small leg capsules, long tail. Demonstrates
// the model system handling a fundamentally different silhouette from primitives.
function quadrupedRatModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // The rat has a body capsule that's pre-rotated 90° around X so it lies
  // horizontal. tiltPart tilts on top of that rotation (combined). The head,
  // legs, and eyes used to be top-level parts which meant the windup tilt
  // didn't bring them along — head floated in place while body rotated.
  // Now: a separate 'rig' anchor part holds everything that should tilt with
  // the body. tiltPart is set to 'rig' in the EnemySpec.
  return {
    id: 'rat-quadruped',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    // 'rig' is an invisible anchor at the rat's center; everything visible
    // is parented to it. Tilting 'rig' rotates the whole rat as one body.
    slots: {
      rig: { pos: [0, 0.14, 0] },
      back: { pos: [0, 0.22, 0] },  // future saddle attachment
    },
    parts: [
      // Body — horizontal capsule, parented to rig. Local pos at rig origin.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], radius: 0.10, height: 0.28, mat: 'body' },
      // Head — slightly forward
      { name: 'head', parent: 'rig', kind: 'sphere', pos: [0, -0.01, -0.22], radius: 0.085, mat: 'body' },
      // Snout
      { parent: 'rig', kind: 'cone', pos: [0, -0.025, -0.30], rot: [-Math.PI / 2, 0, 0], radius: 0.04, height: 0.07, segments: 8, mat: 'body' },
      // Eyes — popped out of the head surface (head r=0.085 at z=-0.22).
      // Eye centers ~0.10 forward of head center => sticks out by ~0.015.
      { parent: 'rig', kind: 'sphere', pos: [-0.05, 0.025, -0.305], radius: 0.022, mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.05, 0.025, -0.305], radius: 0.022, mat: 'eyes' },
      // Four legs (parented to rig so they lift with the windup)
      { parent: 'rig', kind: 'capsule', pos: [-0.07, -0.10, -0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.07, -0.10, -0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [-0.07, -0.10,  0.10], radius: 0.022, height: 0.05, mat: 'body' },
      { parent: 'rig', kind: 'capsule', pos: [ 0.07, -0.10,  0.10], radius: 0.022, height: 0.05, mat: 'body' },
      // Tail
      { parent: 'rig', kind: 'cylinder', pos: [0, 0, 0.28], rot: [Math.PI / 2, 0, 0], radius: 0.015, radiusTop: 0.005, height: 0.30, segments: 6, mat: 'body' },
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
  return {
    id: 'acolyte-caster',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      robe: { color: 0x080a0e, roughness: 1.0, flatShading: 'auto' },
      staff: { color: 0x1a140e, roughness: 0.9, flatShading: 'auto' },
      orb: { color: 0x000000, emissive: staffGlow, emissiveIntensity: 2.6, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 0.85, 0] },
      // Muzzle slot lives at the orb tip so projectiles can be spawned
      // from there if we ever want to read it from a slot. We use the
      // ranged.muzzleOffset for now since enemy.ts owns spawn timing.
      muzzle: { pos: [0.30, 1.20, -0.15] satisfies Vec3 },
    },
    parts: [
      // Robed trailing tail — same trick as the wraith. Hides the absence
      // of legs and gives a vertical silhouette.
      {
        kind: 'extrude', parent: 'rig',
        pos: [0, -0.55, 0],
        shape: [
          [-0.26, 0.55], [-0.34, 0.10], [-0.22, -0.35], [-0.08, -0.50],
          [ 0.08, -0.50], [ 0.22, -0.35], [ 0.34, 0.10], [ 0.26, 0.55],
        ],
        depth: 0.05,
        mat: 'robe',
      },
      // Body — thin tall capsule, robe-colored (the acolyte's robe covers
      // the body), parented to rig.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0.05, 0], radius: 0.26, height: 0.85, mat: 'robe' },
      // Head — sphere just above the body. Dark, mostly hidden under hood.
      { name: 'head', parent: 'rig', kind: 'sphere', pos: [0, 0.75, 0], radius: 0.22, mat: 'body' },
      // Hood — a cone tipped backward over the head. Adds the cultist read.
      { parent: 'rig', kind: 'cone', pos: [0, 0.86, 0.02], radius: 0.30, height: 0.40, segments: 10, mat: 'robe' },
      // Eyes — small mesh spheres deep under the hood, plus halo sprites
      // for distance read (same dual-layer trick as wraith).
      { parent: 'rig', kind: 'sphere', pos: [-0.08, 0.74, -0.20], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.08, 0.74, -0.20], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { name: 'eyeHaloL', parent: 'rig', kind: 'sprite', pos: [-0.08, 0.74, -0.24], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      { name: 'eyeHaloR', parent: 'rig', kind: 'sprite', pos: [ 0.08, 0.74, -0.24], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: eyeColor },
      // Staff — held in the off hand. Long thin cylinder pre-rotated so it
      // stands upright. Orb at the tip glows in the projectile color so the
      // player can read "that staff is about to spit at me."
      { parent: 'rig', kind: 'cylinder', pos: [0.30, 0.10, -0.05], radius: 0.025, height: 1.4, segments: 6, mat: 'staff' },
      { parent: 'rig', kind: 'sphere', pos: [0.30, 0.80, -0.05], radius: 0.085, segments: [12, 10], mat: 'orb' },
      // Halo around the orb so the projectile color reads at distance even
      // when the lighting is dim.
      { parent: 'rig', kind: 'sprite', pos: [0.30, 0.80, -0.05], size: [0.40, 0.40], texture: 'fire-wisp', blending: 'additive', color: staffGlow },
    ],
  };
}

function skirmisherModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  return {
    id: 'skirmisher-humanoid',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    slots: {
      rig: { pos: [0, 0.65, 0] },
      weapon:   { pos: [0.28, 0.65, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.45, 0] satisfies Vec3 },
    },
    parts: [
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, 0, 0], radius: 0.28, height: 0.7, mat: 'body' },
      { name: 'head', parent: 'rig', kind: 'sphere',  pos: [0, 0.55, 0], radius: 0.22, mat: 'body' },
      { parent: 'rig', kind: 'sphere', pos: [-0.08, 0.58, -0.25], radius: 0.035, segments: [12, 10], mat: 'eyes' },
      { parent: 'rig', kind: 'sphere', pos: [ 0.08, 0.58, -0.25], radius: 0.035, segments: [12, 10], mat: 'eyes' },
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
      },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
      robe: {
        color: 0x070b10,
        roughness: 1.0,
        flatShading: 'auto',
      },
      // 'bone' — used for the gnarled arms + claw tips. Paler than the
      // body to read as exposed bone reaching out of the robe sleeves.
      bone: {
        color: 0x4a4338,
        roughness: 1.0,
        emissive: 0x1a1810,
        emissiveIntensity: 0.4,
        flatShading: 'auto',
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
    // Ghoul has decent eyes, moderate hearing. Wide cone — has to face you
    // generally to spot you, but the cone is forgiving.
    sightRange: 7,
    sightConeHalfAngle: 1.05,   // ~60° half / 120° total
    hearingRange: 2.5,
    loseSightTime: 4,
    drops: [
      { itemId: 'scimitar', chance: 1.0 },              // always — headline reward
      { itemId: 'healing-potion', chance: 0.35 },
      { itemId: 'ring-of-bloodthirst', chance: 0.10 },
      { itemId: 'iron-coif', chance: 0.20 },
    ],
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
    // Rats hear / smell better than they see. Bad eyes, wide nose. Easy
    // to sneak past visually if you stay quiet, but step into the cone of
    // their hearing radius and they'll come.
    sightRange: 4,
    sightConeHalfAngle: 0.8,    // ~46° half — narrow, head-bobbing predator
    hearingRange: 3.5,
    loseSightTime: 3,
    drops: [
      // Trash mob: rarely drops anything. Empty hands most of the time.
      { itemId: 'healing-potion', chance: 0.12 },
    ],
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
    // Skirmisher is a scout — best vision of the trash mobs. Tighter
    // cone (predator focus) and longer range. Bad hearing for sneak-up.
    sightRange: 9,
    sightConeHalfAngle: 0.9,
    hearingRange: 2.0,
    loseSightTime: 5,
    drops: [
      { itemId: 'healing-potion', chance: 0.4 },
      { itemId: 'ring-of-predation', chance: 0.15 },
      { itemId: 'worn-boots', chance: 0.20 },
    ],
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
    drops: [
      { itemId: 'healing-potion', chance: 0.5 },
      { itemId: 'bone-amulet', chance: 0.15 },
    ],
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
    // Wraith sees ECHO of you — basically supernatural perception. Long
    // range, wide cone, but small hearing radius (no body to feel
    // footsteps). Long lose-sight: it follows even if you break LOS.
    sightRange: 12,
    sightConeHalfAngle: 1.3,    // ~75° half / 150° total
    hearingRange: 1.5,
    loseSightTime: 7,
    drops: [
      { itemId: 'heartburn', chance: 0.5 },          // fabled — the headline drop
      { itemId: 'bone-amulet', chance: 0.5 },
      { itemId: 'healing-potion', chance: 0.8 },
    ],
  },
};
