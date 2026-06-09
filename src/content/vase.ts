import type { ModelSpec } from '../ecs/model-types';

// Vase — small ceramic destructible. The first new "destructible
// prop" type: takes a hit from the player's swing, shatters into
// shards, and may drop a small reward (coins / a potion / nothing).
//
// Geometry:
//   - Base disc on the floor
//   - Curved body (a lathe profile if it reads well, else
//     stacked cylinders for a "fluted" look)
//   - Narrow neck + lip at the top
//
// Two visual variants are exported — a tall slender vase and a
// short squat one. The builder picks at random per spawn so
// vases don't all look identical in the same room.

// Tall, slender vase. Reads as "amphora" silhouette.
export const VASE_TALL: ModelSpec = {
  id: 'vase-tall',
  class: 'decor',       // breakable with material character — receives, own draw, doesn't cast
  materials: {
    clay: {
      color: 0x6a4a30,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: true,
    },
    rim: {
      color: 0x3a2818,
      roughness: 0.9,
      flatShading: true,
    },
  },
  parts: [
    // Base disc — slightly wider than the body.
    { kind: 'cylinder', pos: [0, 0.025, 0], radius: 0.13, height: 0.05, segments: 12, mat: 'clay' },
    // Lower body — fat at the bottom, narrowing.
    { kind: 'cylinder', pos: [0, 0.15,  0], radius: 0.10, radiusTop: 0.13, height: 0.20, segments: 14, mat: 'clay' },
    // Upper body — widest in the middle, then narrows.
    { kind: 'cylinder', pos: [0, 0.35,  0], radius: 0.13, radiusTop: 0.07, height: 0.20, segments: 14, mat: 'clay' },
    // Neck.
    { kind: 'cylinder', pos: [0, 0.51,  0], radius: 0.07, height: 0.10, segments: 12, mat: 'clay' },
    // Rim — flared darker lip at the top.
    { kind: 'cylinder', pos: [0, 0.58,  0], radius: 0.07, radiusTop: 0.095, height: 0.04, segments: 12, mat: 'rim' },
  ],
};

// Slender flask — long thin neck, narrow base. Reads as
// "alchemical bottle" rather than urn.
export const VASE_FLASK: ModelSpec = {
  id: 'vase-flask',
  class: 'decor',
  materials: {
    clay: { color: 0x4a3a26, roughness: 0.85, flatShading: true },
    rim:  { color: 0x251810, roughness: 0.9, flatShading: true },
  },
  parts: [
    // Narrow base disc.
    { kind: 'cylinder', pos: [0, 0.02, 0], radius: 0.085, height: 0.04, segments: 12, mat: 'clay' },
    // Bulbous belly — most volume at the bottom third.
    { kind: 'cylinder', pos: [0, 0.13, 0], radius: 0.085, radiusTop: 0.115, height: 0.18, segments: 14, mat: 'clay' },
    // Narrowing shoulder.
    { kind: 'cylinder', pos: [0, 0.28, 0], radius: 0.115, radiusTop: 0.045, height: 0.10, segments: 12, mat: 'clay' },
    // Long thin neck.
    { kind: 'cylinder', pos: [0, 0.46, 0], radius: 0.045, height: 0.26, segments: 10, mat: 'clay' },
    // Rim flare at the top of the neck.
    { kind: 'cylinder', pos: [0, 0.60, 0], radius: 0.045, radiusTop: 0.07, height: 0.04, segments: 10, mat: 'rim' },
  ],
};

// Cracked broken vase — half-collapsed pot with a chunk missing,
// jagged top rim. Visually reads as "already-broken" so a player
// can tell at a glance this one won't drop loot (we still mark
// it as a destructible — just rolls a no-drop most of the time).
export const VASE_BROKEN: ModelSpec = {
  id: 'vase-broken',
  class: 'decor',
  materials: {
    clay: { color: 0x5a3a26, roughness: 0.95, flatShading: true },
    rim:  { color: 0x251810, roughness: 0.9, flatShading: true },
  },
  parts: [
    // Base disc.
    { kind: 'cylinder', pos: [0, 0.025, 0], radius: 0.14, height: 0.05, segments: 12, mat: 'clay' },
    // Lower body (intact half).
    { kind: 'cylinder', pos: [0, 0.13, 0], radius: 0.13, radiusTop: 0.10, height: 0.16, segments: 14, mat: 'clay', jitter: 0.02 },
    // Jagged rim chunks remaining — a few box pieces, gaps between.
    { kind: 'box', pos: [ 0.09, 0.24,  0.00], size: [0.05, 0.08, 0.05], rot: [0,  0.2, 0.1], mat: 'rim', jitter: 0.015 },
    { kind: 'box', pos: [-0.08, 0.23,  0.05], size: [0.05, 0.06, 0.05], rot: [0, -0.4, -0.1], mat: 'rim', jitter: 0.015 },
    { kind: 'box', pos: [ 0.02, 0.22, -0.09], size: [0.05, 0.05, 0.05], rot: [0,  0.7, 0.05], mat: 'rim', jitter: 0.015 },
    // A shard fallen on the ground next to it.
    { kind: 'box', pos: [0.16, 0.018, 0.04], size: [0.07, 0.025, 0.04], rot: [0, 0.6, 0], mat: 'clay' },
  ],
};

// Short, squat vase / urn.
export const VASE_SQUAT: ModelSpec = {
  id: 'vase-squat',
  class: 'decor',
  materials: {
    clay: {
      color: 0x5a3a26,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    },
    rim: {
      color: 0x2e1e14,
      roughness: 0.9,
      flatShading: true,
    },
  },
  parts: [
    // Base disc.
    { kind: 'cylinder', pos: [0, 0.025, 0], radius: 0.16, height: 0.05, segments: 12, mat: 'clay' },
    // Bulbous belly — wide cylinder rising to a narrow neck.
    { kind: 'cylinder', pos: [0, 0.18,  0], radius: 0.16, radiusTop: 0.10, height: 0.26, segments: 14, mat: 'clay' },
    // Rim.
    { kind: 'cylinder', pos: [0, 0.33,  0], radius: 0.10, radiusTop: 0.13, height: 0.04, segments: 12, mat: 'rim' },
  ],
};
