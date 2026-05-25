import type { ModelSpec } from '../ecs/model-types';

// First-person held sword as a ModelSpec. Used by createSword to build the
// visible weapon attached to the camera. Animation (windup/strike/recover)
// is still procedural on the model group; the spec just defines what the
// sword looks like.
//
// All materials use fog:false so the sword doesn't fade out in dungeon fog
// (it's a held first-person item, always within "torch-lit" range).

export const SWORD_RUSTED: ModelSpec = {
  id: 'sword-rusted',
  materials: {
    blade: {
      color: 0x9a978f,
      roughness: 0.4,
      metalness: 0.85,
      fog: false,
      flatShading: 'auto',
    },
    guard: {
      color: 0x3a2f22,
      roughness: 0.7,
      metalness: 0.6,
      fog: false,
      flatShading: 'auto',
    },
    grip: {
      color: 0x1a1410,
      roughness: 0.9,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
    pommel: {
      color: 0x4a3a26,
      roughness: 0.6,
      metalness: 0.7,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Long flat blade
    { name: 'blade',  kind: 'box',      pos: [0,  0.35, 0], size: [0.04, 0.6, 0.01], mat: 'blade' },
    // Short horizontal cross-guard
    { name: 'guard',  kind: 'box',      pos: [0,  0.04, 0], size: [0.18, 0.025, 0.04], mat: 'guard' },
    // Cylindrical grip
    { name: 'grip',   kind: 'cylinder', pos: [0, -0.04, 0], radius: 0.022, height: 0.13, segments: 8, mat: 'grip' },
    // Spherical pommel at the bottom
    { name: 'pommel', kind: 'sphere',   pos: [0, -0.12, 0], radius: 0.03, segments: [10, 8], mat: 'pommel' },
  ],
  slots: {
    // Tip of the blade — for future trail effects on swing.
    blade_tip: { pos: [0, 0.65, 0] },
    // Where the wielder's hand goes — for future "enemy holds sword" composition.
    grip_anchor: { pos: [0, -0.04, 0] },
  },
};
