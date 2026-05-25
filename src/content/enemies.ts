// Enemy library. Each entry is data; enemy.ts consumes a spec instead of
// reading constants. Adding a new enemy = add an entry here + reference its
// ID from a LevelSpec spawn.
//
// Stats here intentionally trade off so combat has rhythm variety:
// - GHOUL: slow heavy hitter. Long telegraph, easy to read; punishing if missed.
// - SKIRMISHER: fast light hitter. Short telegraph, attacks more often; small
//   reaction window. Forces you out of the slow ghoul rhythm.

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
  bodyColor: number;
  eyeColor: number;
  eyeEmissive: number;        // base emissive intensity for eyes
  bodyHeightCenter: number;   // capsule center Y
  capsuleRadius: number;
  capsuleHeight: number;
  headRadius: number;
  headY: number;
  eyeY: number;
  eyeZ: number;
  eyeSeparation: number;      // X offset of each eye from center
  eyeRadius: number;
  collisionRadius: number;    // for walkable-region collision
}

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
    bodyColor: 0x14100c,
    eyeColor: 0xff5530,
    eyeEmissive: 1.6,
    bodyHeightCenter: 0.8,
    capsuleRadius: 0.35,
    capsuleHeight: 0.9,
    headRadius: 0.28,
    headY: 1.5,
    eyeY: 1.52,
    eyeZ: -0.24,
    eyeSeparation: 0.08,
    eyeRadius: 0.035,
    collisionRadius: 0.45,
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
    bodyColor: 0x18130d,
    eyeColor: 0xffb060,    // amber instead of red — visually distinct at a glance
    eyeEmissive: 1.8,
    bodyHeightCenter: 0.65,
    capsuleRadius: 0.28,
    capsuleHeight: 0.7,    // smaller silhouette
    headRadius: 0.22,
    headY: 1.2,
    eyeY: 1.22,
    eyeZ: -0.19,
    eyeSeparation: 0.07,
    eyeRadius: 0.032,
    collisionRadius: 0.35,
  },
};
