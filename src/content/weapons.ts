import type { ModelSpec } from '../ecs/model-types';

// Held-weapon model for the curved scimitar. Same blade shape as the altar
// relic but with fog:false on materials (held weapons sit right in front of
// the camera and shouldn't fade in fog) and a slightly smaller scale than
// the relic so it fits comfortably in the player's hand.

const SCIMITAR_BLADE_SHAPE: [number, number][] = [
  // Cutting edge, hilt -> tip
  [ 0.020, 0.00 ],
  [ 0.048, 0.18 ],
  [ 0.072, 0.34 ],
  [ 0.082, 0.48 ],
  [ 0.054, 0.58 ],
  [ 0.018, 0.62 ],
  // Spine, tip -> hilt
  [-0.004, 0.58 ],
  [-0.009, 0.48 ],
  [ 0.004, 0.34 ],
  [ 0.004, 0.18 ],
  [-0.009, 0.00 ],
];

const SCIMITAR_POMMEL_PROFILE: [number, number][] = [
  [ 0.000, 0.000 ],
  [ 0.018, 0.005 ],
  [ 0.028, 0.018 ],
  [ 0.030, 0.032 ],
  [ 0.022, 0.045 ],
  [ 0.010, 0.054 ],
  [ 0.000, 0.056 ],
];

export const WEAPON_SCIMITAR: ModelSpec = {
  id: 'weapon-scimitar',
  materials: {
    blade: {
      color: 0x8a847a,
      roughness: 0.55,
      metalness: 0.7,
      fog: false,
      flatShading: 'auto',
    },
    fittings: {
      color: 0x44321e,
      roughness: 0.6,
      metalness: 0.65,
      fog: false,
      flatShading: 'auto',
    },
    grip: {
      color: 0x1c1410,
      roughness: 0.95,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Curved blade (extrude)
    { name: 'blade', kind: 'extrude', shape: SCIMITAR_BLADE_SHAPE, depth: 0.008, mat: 'blade' },
    // Cross-guard
    { name: 'guard', kind: 'box', pos: [0.02, -0.012, 0], size: [0.16, 0.020, 0.03], mat: 'fittings' },
    // Grip
    { name: 'grip', kind: 'cylinder', pos: [0.005, -0.075, 0], radius: 0.020, height: 0.12, segments: 10, mat: 'grip' },
    // Pommel (lathe — onion finial)
    { name: 'pommel', kind: 'lathe', pos: [0.005, -0.14, 0], profile: SCIMITAR_POMMEL_PROFILE, segments: 14, mat: 'fittings' },
  ],
  slots: {
    blade_tip: { pos: [0.02, 0.62, 0] },
    grip_anchor: { pos: [0.005, -0.075, 0] },
  },
};
