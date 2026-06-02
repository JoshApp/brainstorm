// Boss fog wall — soulslike threshold mist at the entrance of a
// boss arena. Walking through it triggers the seal (the wall
// solidifies behind you + the boss bar engages); it dissolves when
// the boss dies. Visual: a vertical glowing curtain, additive-
// blended, tinted per boss so the player reads which boss is on
// the other side before committing.
//
// Implemented as a pair of extruded panels with slight Y-jitter on
// the silhouette so it doesn't read as a perfect rectangle. No
// fragment shader yet — colour + emissive + additive blending +
// double-sided does the heavy lifting. A custom shader with noise
// scroll is a future polish pass.

import type { ModelSpec, Vec2 } from '../ecs/model-types';

// Doorway-sized panel: 2.6m wide × 2.8m tall. Slight irregular top
// edge so it doesn't read as a perfect quad.
const PANEL_SHAPE: Vec2[] = [
  [-1.30, 0.00],
  [ 1.30, 0.00],
  [ 1.32, 2.65],
  [ 0.80, 2.78],
  [ 0.20, 2.72],
  [-0.40, 2.78],
  [-1.00, 2.70],
  [-1.32, 2.62],
];

export function bossMistModel(tint: number): ModelSpec {
  return {
    id: `boss-mist-${tint.toString(16)}`,
    materials: {
      // Additive emissive — the panel GLOWS as a vertical curtain
      // of light rather than just being a tinted translucent slab.
      // color = base hue, emissive = tint pumped to ~1.4 for the
      // halo. transparent + fog:false keeps it readable across the
      // arena at fog-deep distances.
      mist: {
        color: tint,
        emissive: tint,
        emissiveIntensity: 1.4,
        roughness: 1.0,
        transparent: true,
        opacity: 0.55,
        fog: false,
      },
      // A secondary darker panel BEHIND the main one adds a slight
      // depth shadow so the curtain doesn't read as a flat decal.
      mistBack: {
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.7,
        roughness: 1.0,
        transparent: true,
        opacity: 0.30,
        fog: false,
      },
    },
    slots: {
      rig: { pos: [0, 0, 0] },
    },
    parts: [
      // Main glowing curtain — single extruded panel, thin in Z so
      // it reads as a wall not a slab. depth 0.04m.
      { name: 'front', parent: 'rig', kind: 'extrude', pos: [0, 0, 0], shape: PANEL_SHAPE, depth: 0.04, mat: 'mist' },
      // Back ghost — same shape, slightly bigger + offset behind,
      // dimmer. Gives the depth halo.
      { name: 'back', parent: 'rig', kind: 'extrude', pos: [0, 0, -0.10], rot: [0, 0, 0], scale: [1.05, 1.02, 1], shape: PANEL_SHAPE, depth: 0.02, mat: 'mistBack' },
    ],
  };
}
