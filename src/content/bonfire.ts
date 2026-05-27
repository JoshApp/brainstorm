import type { ModelSpec } from '../ecs/model-types';

// Bonfire — simple firepit: a low ring of stones, ash + ember
// mound in the middle, a single warm flame above. No swords, no
// bone fragments, no central spike. Placed in the start vault of
// every floor as a pure-cosmetic anchor for the spawn area.

export const BONFIRE: ModelSpec = {
  id: 'bonfire',
  materials: {
    stone: { color: 0x2a221a, roughness: 1.0, flatShading: true },
    ash:   { color: 0x100c08, roughness: 1.0, flatShading: true },
    ember: { color: 0xffb060, emissive: 0xff7020, emissiveIntensity: 3.2, roughness: 0.8 },
    flame: { color: 0xffd58a, emissive: 0xffa040, emissiveIntensity: 3.4, roughness: 0.4 },
  },
  parts: [
    // Stone ring — six jagged stones around the firepit. Heights
    // and rotations jittered so no two read the same.
    { kind: 'box', pos: [ 0.55, 0.10,  0.00], size: [0.22, 0.20, 0.28], rot: [0,  0.30, 0.1], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [ 0.28, 0.09,  0.50], size: [0.24, 0.18, 0.20], rot: [0, -0.60, 0.0], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.30, 0.10,  0.48], size: [0.22, 0.20, 0.22], rot: [0,  0.90, 0.0], mat: 'stone', jitter: 0.06 },
    { kind: 'box', pos: [-0.55, 0.08,  0.00], size: [0.20, 0.16, 0.26], rot: [0, -0.20, 0.1], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.28, 0.09, -0.50], size: [0.24, 0.18, 0.22], rot: [0,  0.40, 0.0], mat: 'stone', jitter: 0.06 },
    { kind: 'box', pos: [ 0.32, 0.10, -0.48], size: [0.22, 0.20, 0.22], rot: [0, -0.80, 0.1], mat: 'stone', jitter: 0.05 },

    // Soot decal on the floor inside the ring.
    {
      kind: 'decal',
      pos: [0, 0.02, 0],
      rot: [-Math.PI / 2, 0, 0],
      size: [1.15, 1.15],
      texture: 'fire-wisp',
      color: 0x080604,
    },
    // Ash mound at the centre.
    { kind: 'cone', pos: [0, 0.08, 0], radius: 0.35, height: 0.16, segments: 12, mat: 'ash' },
    // Glowing ember layer on top.
    { kind: 'cone', pos: [0, 0.18, 0], radius: 0.28, height: 0.08, segments: 12, mat: 'ember', castShadow: false },

    // Flame sphere, hovers just above the embers.
    { name: 'flame', kind: 'sphere', pos: [0, 0.42, 0], radius: 0.18, scale: [1, 1.6, 1], mat: 'flame', castShadow: false },
    // Wisp halo around the flame.
    {
      kind: 'sprite',
      pos: [0, 0.55, 0],
      size: [0.95, 1.20],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffaa55,
    },
    // Outer warmth haze.
    {
      kind: 'sprite',
      pos: [0, 0.40, 0],
      size: [1.60, 1.20],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xc8642a,
    },
  ],
  light: {
    color: 0xffb066,
    intensity: 60,
    distance: 9.5,
    decay: 1.5,
    pos: [0, 0.45, 0],
    castShadow: false,
  },
};
