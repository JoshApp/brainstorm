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
    // SHINE = WORTH (docs/VISUAL-LANGUAGE.md): a mundane blade EATS
    // light. The original material (roughness 0.4 / metalness 0.85 —
    // the first model ever authored for the game) bounced torchlight
    // like a polished mirror and out-shone actual signals. The flat
    // is now pitted rust-grey that swallows the room; only the EDGE
    // material below keeps a live gleam — the one part a survivor
    // would keep honed.
    blade: {
      color: 0x5e564c,
      roughness: 0.85,
      metalness: 0.45,
      fog: false,
      flatShading: 'auto',
    },
    edge: {
      color: 0x8a857c,
      roughness: 0.45,
      metalness: 0.8,
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
    // Long flat blade — dull rusted flat with thin honed-edge strips
    // on both cutting sides (the only part that catches light).
    { name: 'blade',  kind: 'box',      pos: [0,  0.35, 0], size: [0.04, 0.6, 0.01], mat: 'blade' },
    { name: 'edge_l', kind: 'box',      pos: [-0.020, 0.35, 0], size: [0.004, 0.58, 0.008], mat: 'edge' },
    { name: 'edge_r', kind: 'box',      pos: [ 0.020, 0.35, 0], size: [0.004, 0.58, 0.008], mat: 'edge' },
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
