import type { ModelSpec } from '../ecs/model-types';

// Model specs for the three new weapon classes added alongside the
// existing sword/dagger/hammer/spear/crossbow/wand pool. Each is kept
// simple — primitive geometry stacked, recoloured for the rarity
// theme. Distinct bespoke meshes can replace these later without
// changing the item / class wiring.

// ── Scythe — long ash haft + curved iron blade hanging off the top.
// Reaper's silhouette. The blade is an extrude shape, kept thin
// so per-face shading shows the curve.
export const REAPERS_TOLL: ModelSpec = {
  id: 'reapers-toll',
  materials: {
    haft: { color: 0x2a1c10, roughness: 0.95, metalness: 0.05, flatShading: 'auto' },
    binding: { color: 0x0c0805, roughness: 1.0 },
    blade: {
      color: 0x141014,
      emissive: 0x441010,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.85,
      flatShading: 'auto',
    },
  },
  parts: [
    // Haft — long dark cylinder, slightly tapered at the top.
    { kind: 'cylinder', pos: [0, -0.10, 0], radius: 0.024, radiusTop: 0.020, height: 0.78, segments: 10, mat: 'haft' },
    // Leather wraps near the grip + at the head.
    { kind: 'cylinder', pos: [0, -0.32, 0], radius: 0.028, height: 0.10, segments: 8, mat: 'binding' },
    { kind: 'cylinder', pos: [0,  0.26, 0], radius: 0.026, height: 0.05, segments: 8, mat: 'binding' },
    // Blade — curved crescent extruded from a 2D shape. Authored in
    // the XY plane (blade-local +X is the tip direction), rotated so
    // it juts off the top of the haft.
    { kind: 'extrude',
      pos: [0.14, 0.32, 0],
      rot: [0, 0, -0.25],
      shape: [
        [0.00,  0.00],
        [0.42, -0.04],
        [0.48, -0.12],
        [0.46, -0.18],
        [0.30, -0.10],
        [0.12, -0.05],
        [0.02, -0.02],
      ],
      depth: 0.010,
      mat: 'blade' },
  ],
};

// ── Whip — short handle + a chain of small dark spheres tapering
// out. Trying to render a flexible cord is hard with primitives, so
// we fake it with a string of spheres at decreasing radius. Looks
// right in motion.
export const PENITENTS_CHAIN: ModelSpec = {
  id: 'penitents-chain',
  materials: {
    grip: { color: 0x1a1208, roughness: 0.9, metalness: 0.1, flatShading: 'auto' },
    binding: { color: 0x0c0805, roughness: 1.0 },
    cord:   { color: 0x2c1a10, roughness: 0.85, metalness: 0.2 },
  },
  parts: [
    // Handle — short cylinder, leather-wrapped at the grip end.
    { kind: 'cylinder', pos: [0, -0.10, 0], radius: 0.028, height: 0.16, segments: 10, mat: 'grip' },
    { kind: 'cylinder', pos: [0, -0.16, 0], radius: 0.032, height: 0.06, segments: 10, mat: 'binding' },
    // Metal collar where the cord starts.
    { kind: 'cylinder', pos: [0, -0.02, 0], radius: 0.030, height: 0.02, segments: 10, mat: 'cord' },
    // Cord segments — falling chain of beads, each a touch smaller.
    { kind: 'sphere', pos: [0.02, 0.02, 0], radius: 0.024, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', pos: [0.06, 0.06, 0], radius: 0.022, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', pos: [0.12, 0.10, 0], radius: 0.019, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', pos: [0.20, 0.13, 0], radius: 0.016, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', pos: [0.28, 0.15, 0], radius: 0.013, segments: [8, 6], mat: 'cord' },
    { kind: 'sphere', pos: [0.36, 0.16, 0], radius: 0.010, segments: [8, 6], mat: 'cord' },
  ],
};

// ── Throwing knives — a single drawn knife (the one being thrown
// this frame). Small triangular blade + tiny handle. The fan of 3
// projectiles spawns on strike — this model is just the hand-held
// one mid-throw.
export const CORD_OF_KNIVES: ModelSpec = {
  id: 'cord-of-knives',
  materials: {
    grip: { color: 0x161008, roughness: 0.95 },
    blade: { color: 0xc8c8c8, roughness: 0.35, metalness: 0.85, flatShading: 'auto' },
  },
  parts: [
    // Grip — short cylinder.
    { kind: 'cylinder', pos: [0, -0.05, 0], radius: 0.014, height: 0.08, segments: 8, mat: 'grip' },
    // Blade — triangular extrusion, tip pointing +Y.
    { kind: 'extrude',
      pos: [0, 0.02, 0],
      shape: [
        [-0.018, 0.00],
        [ 0.018, 0.00],
        [ 0.000, 0.18],
      ],
      depth: 0.005,
      mat: 'blade' },
  ],
};
