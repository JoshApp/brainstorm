import type { ModelSpec, Vec3 } from '../ecs/model-types';

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
}

// --- Model factories ----------------------------------------------------

// Two simple, distinct humanoid silhouettes built from primitives. Defined as
// functions of (bodyColor, eyeColor) so a future "elite ghoul" with a different
// palette doesn't need a duplicate model — it's the same shape with new
// material colors.

function humanoidGhoulModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  // Body at pos [0, 0.8, 0]. Head is parented to body so when the body tilts
  // during windup, the head + eyes tilt with it (otherwise the head floats
  // in place while the body leans, looking broken). Eyes pop OUT of the
  // head surface (head radius 0.28, eye at distance 0.28+ from head center).
  return {
    id: 'ghoul-humanoid',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    parts: [
      { name: 'body', kind: 'capsule', pos: [0, 0.8, 0], radius: 0.35, height: 0.9, mat: 'body' },
      // Local positions below are relative to body (which is at world y=0.8).
      { name: 'head', parent: 'body', kind: 'sphere', pos: [0, 0.7, 0], radius: 0.28, mat: 'body' },
      // Eyes protrude from the front of the head. Surface of head sphere at
      // forward angle ~25° below horizontal: (sin25°*0.28, ..., -cos25°*0.28) =
      // (0.118, ..., -0.254). We place eyes just OUTSIDE that surface so they
      // visibly stick out + their emissive isn't occluded by the head sphere.
      { parent: 'body', kind: 'sphere', pos: [-0.10, 0.74, -0.28], radius: 0.045, mat: 'eyes' },
      { parent: 'body', kind: 'sphere', pos: [ 0.10, 0.74, -0.28], radius: 0.045, mat: 'eyes' },
    ],
    slots: {
      weapon:   { pos: [0.35, 0.9, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.8, 0] satisfies Vec3 },
    },
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

function skirmisherModel(bodyColor: number, eyeColor: number, eyeEmissive: number): ModelSpec {
  return {
    id: 'skirmisher-humanoid',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    parts: [
      { name: 'body', kind: 'capsule', pos: [0, 0.65, 0], radius: 0.28, height: 0.7, mat: 'body' },
      { name: 'head', parent: 'body', kind: 'sphere', pos: [0, 0.55, 0], radius: 0.22, mat: 'body' },
      // Eyes popped out of head surface (head r=0.22, head center y=1.2,
      // eyes at world y=1.22 z=-0.22). Larger size for visibility.
      { parent: 'body', kind: 'sphere', pos: [-0.09, 0.57, -0.23], radius: 0.038, mat: 'eyes' },
      { parent: 'body', kind: 'sphere', pos: [ 0.09, 0.57, -0.23], radius: 0.038, mat: 'eyes' },
    ],
    slots: {
      weapon:   { pos: [0.28, 0.65, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.45, 0] satisfies Vec3 },
    },
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
    model: humanoidGhoulModel(0x14100c, 0xff5530, 1.6),
    baseEyeEmissive: 1.6,
    collisionRadius: 0.45,
    tiltPartName: 'body',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
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
    model: skirmisherModel(0x18130d, 0xffb060, 1.8),
    baseEyeEmissive: 1.8,
    collisionRadius: 0.35,
    tiltPartName: 'body',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
  },
};
