import type { ModelSpec } from '../ecs/model-types';
import { CONFIG } from '../config';

// Wall torch as a ModelSpec. The flicker animation in scene/torchlight.ts
// looks up the 'flame' part and the 'flame' material by name and mutates them
// per frame; the model spec just defines what's there.

export const WALL_TORCH: ModelSpec = {
  id: 'wall-torch',
  materials: {
    bracket: {
      color: 0x14110d,
      roughness: 0.85,
      metalness: 0.5,
      flatShading: 'auto',
    },
    flame: {
      color: 0xffcc88,
      emissive: 0xff8844,
      emissiveIntensity: 3.0,
      roughness: 0.4,
    },
  },
  parts: [
    // Iron bracket: short horizontal cylinder mounted to the wall behind the flame.
    {
      name: 'bracket',
      kind: 'cylinder',
      pos: [0, 0, -0.15],
      rot: [Math.PI / 2, 0, 0],
      radius: 0.025,
      height: 0.3,
      segments: 6,
      mat: 'bracket',
      castShadow: false,
    },
    // Flame: emissive sphere, scaled teardrop-vertical so it reads as fire
    // even at low render resolution. Scale + position are animated per-frame
    // by updateTorchlight() — initial values here are just the rest pose.
    {
      name: 'flame',
      kind: 'sphere',
      pos: [0, 0, 0],
      scale: [1.0, 1.4, 1.0],
      radius: 0.12,
      segments: [12, 12],
      mat: 'flame',
      castShadow: false,
    },
  ],
  slots: {
    // Above the flame — for future smoke-particle / fire-wisp sprite attachment.
    flame_top: { pos: [0, 0.2, 0] },
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
