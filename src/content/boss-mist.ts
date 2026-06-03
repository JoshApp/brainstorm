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

// Doorway curtain silhouette, built to fill a given opening (halfWidth ×
// height) with a slightly irregular top edge so it doesn't read as a
// perfect quad. MUST span its doorway: a curtain narrower/shorter than the
// carved gap (a) looks wrong and (b) lets a tap-raycast slip PAST it to
// whatever boss is dormant behind it — which the tap resolver then reads as
// "attack the enemy" instead of "open the gate".
function panelShape(halfW: number, h: number): Vec2[] {
  return [
    [-halfW,        0.00],
    [ halfW,        0.00],
    [ halfW * 1.01, h * 0.95],
    [ halfW * 0.62, h * 1.00],
    [ halfW * 0.15, h * 0.97],
    [-halfW * 0.31, h * 1.00],
    [-halfW * 0.77, h * 0.97],
    [-halfW * 1.01, h * 0.94],
  ];
}

export function bossMistModel(tint: number, halfWidth = 1.7, height = 4.6): ModelSpec {
  const shape = panelShape(halfWidth, height);
  return {
    id: `boss-mist-${tint.toString(16)}-${Math.round(halfWidth * 10)}x${Math.round(height * 10)}`,
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
      { name: 'front', parent: 'rig', kind: 'extrude', pos: [0, 0, 0], shape, depth: 0.04, mat: 'mist' },
      // Back ghost — same shape, slightly bigger + offset behind,
      // dimmer. Gives the depth halo.
      { name: 'back', parent: 'rig', kind: 'extrude', pos: [0, 0, -0.10], rot: [0, 0, 0], scale: [1.05, 1.02, 1], shape, depth: 0.02, mat: 'mistBack' },
    ],
  };
}
