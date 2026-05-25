import type { ModelSpec } from '../ecs/model-types';

// Floor-level candle. Smaller than a wall torch — provides ankle-level glow
// that creates upward-cast shadows on walls and adds dramatic chiaroscuro
// without competing with the torches for the upper-light register.
//
// Cylindrical wax body, small flame sphere on top, small additive wisp
// sprite, attached PointLight. Used as a 'model' prop in level specs.

export const FLOOR_CANDLE: ModelSpec = {
  id: 'floor-candle',
  materials: {
    wax: {
      color: 0x4a3a2e,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: 'auto',
    },
    flame: {
      color: 0xffd58a,
      emissive: 0xffaa44,
      emissiveIntensity: 2.5,
      roughness: 0.4,
    },
  },
  parts: [
    // Wax pillar — short cylinder
    { name: 'wax', kind: 'cylinder', pos: [0, 0.10, 0], radius: 0.045, height: 0.20, segments: 10, mat: 'wax' },
    // Wick visible as a tiny dark cylinder
    { kind: 'cylinder', pos: [0, 0.21, 0], radius: 0.004, height: 0.025, segments: 4, mat: 'wax' },
    // Flame
    { name: 'flame', kind: 'sphere', pos: [0, 0.245, 0], radius: 0.025, scale: [1, 1.4, 1], mat: 'flame', castShadow: false },
    // Wisp halo (small, tight — floor candle has less reach than a torch)
    {
      kind: 'sprite',
      pos: [0, 0.30, 0],
      size: [0.18, 0.26],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffaa55,
    },
  ],
  light: {
    color: 0xffaa55,
    intensity: 18,    // much smaller than a torch (95); just enough for floor-level glow
    distance: 3.5,
    decay: 1.6,
    pos: [0, 0.25, 0],
    castShadow: false,  // shadow expensive + cluttered at floor level
  },
};
