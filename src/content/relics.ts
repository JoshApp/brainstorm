import type { ModelSpec } from '../ecs/model-types';

// Static decoration models — relics, debris, sigils. Placed in level specs via
// { kind: 'model', model: ..., ... } prop entries. No collision, no behavior.
//
// SCIMITAR_RELIC demonstrates extrude + lathe: the blade is a 2D curved shape
// pushed into 3D thickness (extrude), the pommel is a 2D profile revolved
// around an axis (lathe). Together they make a weapon that primitives alone
// can't express — the curve in the blade and the rounded pommel finial.

// Blade shape — 2D outline traced counterclockwise. Local axes: X is
// perpendicular to the blade (cutting-edge side = +X), Y runs from grip (0)
// to tip (~0.7). Curve bulges out then sweeps back to a point.
const SCIMITAR_BLADE_SHAPE: [number, number][] = [
  // Cutting edge side, hilt -> tip
  [ 0.022, 0.00 ],
  [ 0.055, 0.20 ],
  [ 0.080, 0.40 ],
  [ 0.092, 0.55 ],
  [ 0.060, 0.66 ],
  [ 0.020, 0.70 ],   // tip
  // Spine side, tip -> hilt
  [-0.005, 0.66 ],
  [-0.010, 0.55 ],
  [ 0.005, 0.40 ],
  [ 0.005, 0.20 ],
  [-0.010, 0.00 ],
];

// Pommel lathe profile — half-cross-section revolved around Y. [r, y] points
// from bottom-center upward. Onion-shaped finial with a small base.
const SCIMITAR_POMMEL_PROFILE: [number, number][] = [
  [ 0.000, 0.000 ],
  [ 0.020, 0.005 ],
  [ 0.030, 0.020 ],
  [ 0.032, 0.035 ],
  [ 0.025, 0.050 ],
  [ 0.012, 0.060 ],
  [ 0.000, 0.062 ],
];

export const SCIMITAR_RELIC: ModelSpec = {
  id: 'scimitar-relic',
  materials: {
    blade: {
      color: 0x8a847a,
      roughness: 0.55,
      metalness: 0.7,
      flatShading: 'auto',
    },
    fittings: {
      color: 0x44321e,
      roughness: 0.6,
      metalness: 0.65,
      flatShading: 'auto',
    },
    grip: {
      color: 0x1c1410,
      roughness: 0.95,
      metalness: 0.1,
      flatShading: 'auto',
    },
  },
  parts: [
    // EXTRUDE: curved blade — silhouette pushed 8mm into depth
    {
      name: 'blade',
      kind: 'extrude',
      shape: SCIMITAR_BLADE_SHAPE,
      depth: 0.008,
      mat: 'blade',
    },
    // Cross-guard
    { name: 'guard', kind: 'box', pos: [0.02, -0.012, 0], size: [0.18, 0.022, 0.035], mat: 'fittings' },
    // Grip (cylinder)
    { name: 'grip', kind: 'cylinder', pos: [0.005, -0.085, 0], radius: 0.022, height: 0.13, segments: 10, mat: 'grip' },
    // LATHE: pommel — onion-shaped finial revolved around Y
    {
      name: 'pommel',
      kind: 'lathe',
      pos: [0.005, -0.16, 0],
      profile: SCIMITAR_POMMEL_PROFILE,
      segments: 14,
      mat: 'fittings',
    },
  ],
};

// ALTAR SKULL — a small primitive skull for the ritual chamber altar.
// Bone sphere (cranium) with sunken eye sockets (small dark spheres
// inset), a square nasal cavity, and a slab jaw under it. Lives at
// the same scale as the old scimitar relic so it sits neatly on the
// altar without geometry tweaks.
export const ALTAR_SKULL: ModelSpec = {
  id: 'altar-skull',
  materials: {
    bone: {
      color: 0xa89880,
      roughness: 0.95,
      emissive: 0x1a1410,
      emissiveIntensity: 0.35,
      flatShading: 'auto',
    },
    socket: {
      // Pitch dark — the sockets read as deep holes regardless of
      // ambient lighting.
      color: 0x000000,
      roughness: 1.0,
      emissive: 0x000000,
    },
  },
  parts: [
    // Cranium — slightly flattened sphere with small jitter so it
    // doesn't read as a perfect ping-pong ball.
    { name: 'cranium', kind: 'sphere', pos: [0, 0.08, 0], radius: 0.13, scale: [1.05, 0.95, 1.15], mat: 'bone', jitter: 0.010 },
    // Eye sockets — small dark spheres recessed into the cranium front.
    { kind: 'sphere', pos: [-0.055, 0.085, -0.105], radius: 0.034, mat: 'socket' },
    { kind: 'sphere', pos: [ 0.055, 0.085, -0.105], radius: 0.034, mat: 'socket' },
    // Nasal cavity — small dark box.
    { kind: 'box', pos: [0, 0.025, -0.118], size: [0.025, 0.04, 0.02], mat: 'socket' },
    // Jaw — wider flat slab under the cranium.
    { name: 'jaw', kind: 'box', pos: [0, -0.05, -0.04], size: [0.18, 0.04, 0.12], mat: 'bone' },
    // Cheek bones — thin extrusions giving a square jawline.
    { kind: 'box', pos: [-0.09, -0.01, -0.045], size: [0.025, 0.05, 0.10], mat: 'bone' },
    { kind: 'box', pos: [ 0.09, -0.01, -0.045], size: [0.025, 0.05, 0.10], mat: 'bone' },
  ],
};
