import type { ModelSpec } from '../ecs/model-types';
import { CONFIG } from '../config';

// Wall torch: a CANDLE IN A SCONCE. Designed to feel like the floor candles
// the player already likes — a small wax pillar with a clean flame on top,
// held by a small iron sconce against the wall. Simpler and more legible
// than the previous "flame ball on bracket" design.
//
// Local origin = flame center = where the PointLight sits. Wax candle hangs
// below the flame; sconce bowl + arm hang below the candle and extend back
// toward the wall (-Z in local space).
//
// The flicker animation in scene/torchlight.ts looks up the 'flame' part +
// material and the 'wisp' sprite by name and mutates them per frame.

export const WALL_TORCH: ModelSpec = {
  id: 'wall-torch',
  materials: {
    iron: {
      color: 0x14110d,
      roughness: 0.85,
      metalness: 0.55,
      flatShading: 'auto',
    },
    wax: {
      color: 0x4a3a2e,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: 'auto',
    },
    wick: {
      color: 0x1a0f08,
      roughness: 1.0,
      metalness: 0.0,
    },
    flame: {
      color: 0xffd58a,
      emissive: 0xff8844,
      emissiveIntensity: 2.8,
      roughness: 0.4,
    },
  },
  parts: [
    // Sconce arm — short box reaching from the wall to the sconce bowl.
    // -Z is the wall direction in local space.
    { kind: 'box',  pos: [0, -0.24, -0.09], size: [0.045, 0.035, 0.14], mat: 'iron' },
    // Sconce bowl — short flared cylinder holding the wax. Wider at top.
    { kind: 'cylinder', pos: [0, -0.21, 0], radius: 0.05, radiusTop: 0.065, height: 0.05, segments: 10, mat: 'iron' },
    // Wax candle — short fat pillar
    { kind: 'cylinder', pos: [0, -0.10, 0], radius: 0.04, height: 0.16, segments: 10, mat: 'wax' },
    // Wick — narrow dark cylinder just below the flame
    { kind: 'cylinder', pos: [0, -0.02, 0], radius: 0.005, height: 0.024, segments: 4, mat: 'wick' },
    // Flame: emissive sphere at the local origin (= light source). Scale +
    // position animated by updateTorchlight(); values here are the rest pose.
    {
      name: 'flame',
      kind: 'sphere',
      pos: [0, 0.02, 0],
      scale: [1.0, 1.4, 1.0],
      radius: 0.04,
      segments: [10, 10],
      mat: 'flame',
      castShadow: false,
    },
    // Wisp: additive-blended halo sprite above the flame. Smaller than before
    // (was 0.55 × 0.75) so it doesn't blow out the room.
    {
      name: 'wisp',
      kind: 'sprite',
      pos: [0, 0.10, 0],
      size: [0.30, 0.45],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffaa55,
    },
  ],
  slots: {
    flame_top: { pos: [0, 0.08, 0] },
  },
  light: {
    color: CONFIG.TORCH_COLOR,
    intensity: CONFIG.TORCH_INTENSITY,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    castShadow: true,
    shadowMapSize: 512,
    shadowBias: -0.005,
  },
};
