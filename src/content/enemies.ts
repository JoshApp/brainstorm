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
  return {
    id: 'ghoul-humanoid',
    materials: {
      body: { color: bodyColor, roughness: 0.95, flatShading: 'auto' },
      eyes: { color: 0x000000, emissive: eyeColor, emissiveIntensity: eyeEmissive, roughness: 1.0 },
    },
    parts: [
      { name: 'body', kind: 'capsule', pos: [0, 0.8, 0], radius: 0.35, height: 0.9, mat: 'body' },
      { name: 'head', kind: 'sphere',  pos: [0, 1.5, 0], radius: 0.28, mat: 'body' },
      { kind: 'sphere', pos: [-0.08, 1.52, -0.24], radius: 0.035, mat: 'eyes' },
      { kind: 'sphere', pos: [ 0.08, 1.52, -0.24], radius: 0.035, mat: 'eyes' },
    ],
    slots: {
      weapon:   { pos: [0.35, 0.9, 0] satisfies Vec3 },
      head_top: { pos: [0,    1.8, 0] satisfies Vec3 },
    },
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
      { name: 'head', kind: 'sphere',  pos: [0, 1.2, 0],  radius: 0.22, mat: 'body' },
      { kind: 'sphere', pos: [-0.07, 1.22, -0.19], radius: 0.032, mat: 'eyes' },
      { kind: 'sphere', pos: [ 0.07, 1.22, -0.19], radius: 0.032, mat: 'eyes' },
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
    attackRange: 1.6,
    strikeRange: 1.9,
    windupTime: 0.55,
    strikeTime: 0.18,
    recoverTime: 0.55,
    model: humanoidGhoulModel(0x14100c, 0xff5530, 1.6),
    baseEyeEmissive: 1.6,
    collisionRadius: 0.45,
    tiltPartName: 'body',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
  },

  skirmisher: {
    id: 'skirmisher',
    name: 'skirmisher',
    hp: 2,
    moveSpeed: 2.4,        // faster than player retreat speed
    attackDamage: 1,
    attackRange: 1.35,
    strikeRange: 1.7,
    windupTime: 0.28,      // ~half the ghoul — much harder to react
    strikeTime: 0.14,
    recoverTime: 0.35,
    model: skirmisherModel(0x18130d, 0xffb060, 1.8),
    baseEyeEmissive: 1.8,
    collisionRadius: 0.35,
    tiltPartName: 'body',
    flashMaterialName: 'body',
    eyeMaterialName: 'eyes',
  },
};
