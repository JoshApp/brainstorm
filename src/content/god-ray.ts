import type { ModelSpec } from '../ecs/model-types';

// God ray — a single slanted shaft of light reaching from
// somewhere high (a crack, a grate, a hole in the ceiling) down
// to the floor. Pure atmosphere; no gameplay function.
//
// Authored as a tilted additive plane plus a faint emissive disc
// where the ray "lands" on the floor + a tight bright dust mote
// along the shaft. Tinted variants let a room use a god ray
// matching its torch palette (the stair beam stays cool blue;
// a treasure chamber gets warm gold).
//
// Usage rules:
//   - Sparingly. A god ray loses meaning if every room has one;
//     they should read as "this chamber is special." The
//     composer/library should drop them in maybe one in every
//     few vaults, not as a default decoration.
//   - Place where the player can WALK INTO the beam — that's
//     the strongest mood payoff (you cross a shaft of light,
//     dust glints around you).

export function godRay(tint: number = 0xb8c8ff): ModelSpec {
  const id = `god-ray-${tint.toString(16)}`;
  return {
    id,
    materials: {},
    parts: [
      // The shaft — wide tall additive plane tilted off vertical.
      // Plane geometry, faced both ways so it shows from any
      // approach angle. The slant is small (~12°) so it reads as
      // light pouring in from a side crack rather than a perfect
      // pillar.
      {
        kind: 'decal',
        pos: [0, 1.55, 0],
        rot: [0, 0, 0.20],
        size: [0.75, 3.20],
        texture: 'fire-wisp',
        color: tint,
      },
      // Outer wider/softer shaft for haze depth.
      {
        kind: 'decal',
        pos: [0, 1.55, 0.02],
        rot: [0, 0, 0.20],
        size: [1.35, 3.20],
        texture: 'fire-wisp',
        color: tint,
      },
      // Floor disc where the ray lands — pool of light at the
      // foot of the shaft.
      {
        kind: 'decal',
        pos: [-0.30, 0.008, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [1.40, 1.40],
        texture: 'fire-wisp',
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.6,
      },
      // A handful of bright dust motes along the shaft — speaks
      // to the volumetric "particles in the beam" feel without
      // running an actual particle system.
      {
        kind: 'sprite', pos: [-0.05, 0.85, 0], size: [0.10, 0.10],
        texture: 'fire-wisp', color: tint, blending: 'additive',
      },
      {
        kind: 'sprite', pos: [-0.18, 1.45, 0.04], size: [0.08, 0.08],
        texture: 'fire-wisp', color: tint, blending: 'additive',
      },
      {
        kind: 'sprite', pos: [-0.10, 2.10, -0.02], size: [0.07, 0.07],
        texture: 'fire-wisp', color: tint, blending: 'additive',
      },
      {
        kind: 'sprite', pos: [-0.22, 2.65, 0.03], size: [0.06, 0.06],
        texture: 'fire-wisp', color: tint, blending: 'additive',
      },
    ],
    light: {
      color: tint,
      intensity: 9,
      distance: 7,
      decay: 1.8,
      // Pool light at the base of the shaft where it lands on
      // the floor, not up in the shaft itself.
      pos: [-0.30, 0.4, 0],
      castShadow: false,
    },
  };
}
