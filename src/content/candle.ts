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
    // Flame tongue stack — same family as the bonfire's flicker
    // sprites but much smaller. Three subtle layers + a faint
    // warmth haze. Each carries an independent flicker (scale
    // wobble + Y bob) with random phase so layers don't sync.
    {
      kind: 'sprite',
      pos: [0, 0.30, 0],
      size: [0.18, 0.26],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffe0a8,
      flicker: { scale: 0.20, bob: 0.020, speed: 3.0 },
    },
    {
      kind: 'sprite',
      pos: [0, 0.34, 0],
      size: [0.12, 0.22],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff9040,
      flicker: { scale: 0.26, bob: 0.030, speed: 2.4 },
    },
    {
      kind: 'sprite',
      pos: [0, 0.27, 0],
      size: [0.30, 0.30],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xc8632a,
      flicker: { scale: 0.10, bob: 0.012, speed: 1.4 },
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
