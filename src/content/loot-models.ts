import type { ModelSpec } from '../ecs/model-types';

// Visual models for non-weapon items (potions, rings, armor).
// All use fog:false on their materials since they're held / displayed
// at close-up distances (pickup bobbing in mid-air, or in the inventory
// panel) where fog would inappropriately fade them.

// Healing potion — glass flask with a glowing red elixir + a cork.
export const HEALING_POTION: ModelSpec = {
  id: 'healing-potion',
  materials: {
    glass: {
      color: 0x161814,
      roughness: 0.25,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
    elixir: {
      // Black base + bright red emissive so the potion glows from within
      // — visible at a glance amid clutter.
      color: 0x000000,
      emissive: 0xff2233,
      emissiveIntensity: 1.8,
      roughness: 0.4,
      fog: false,
    },
    cork: {
      color: 0x4a3a26,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Body — wider cylinder for the bulk of the flask
    { kind: 'cylinder', pos: [0, 0.06, 0], radius: 0.05, height: 0.10, segments: 10, mat: 'glass' },
    // Glowing red elixir filling most of the body
    { kind: 'cylinder', pos: [0, 0.055, 0], radius: 0.042, height: 0.08, segments: 10, mat: 'elixir' },
    // Neck — narrower cylinder going up
    { kind: 'cylinder', pos: [0, 0.135, 0], radius: 0.022, height: 0.05, segments: 8, mat: 'glass' },
    // Cork — small box on top
    { kind: 'cylinder', pos: [0, 0.175, 0], radius: 0.020, height: 0.025, segments: 8, mat: 'cork' },
  ],
};

// Ring of vigor — green-stoned torus ring.
function ringModel(id: string, jewelColor: number, jewelEmissive: number): ModelSpec {
  return {
    id,
    materials: {
      band: {
        color: 0xb09060,
        roughness: 0.45,
        metalness: 0.7,
        fog: false,
        flatShading: 'auto',
      },
      jewel: {
        color: 0x000000,
        emissive: jewelColor,
        emissiveIntensity: jewelEmissive,
        roughness: 0.35,
        fog: false,
      },
    },
    parts: [
      // The band — torus laid flat (so the hole's axis is vertical).
      // Three.js TorusGeometry default has axis along Z; we rotate so hole
      // is up (axis along Y) — visually reads as a ring sitting on a table.
      { kind: 'torus', pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0], radius: 0.045, tube: 0.011, segments: [14, 8], mat: 'band' },
      // The jewel — small glowing sphere set in the top of the band.
      { kind: 'sphere', pos: [0, 0.035, 0], radius: 0.018, segments: [10, 8], mat: 'jewel' },
    ],
  };
}

export const RING_OF_VIGOR = ringModel('ring-vigor', 0x66dd55, 2.0);       // green: life
export const RING_OF_PREDATION = ringModel('ring-predation', 0xff4422, 2.0); // red: aggression
export const RING_OF_BLOODTHIRST = ringModel('ring-bloodthirst', 0xaa1133, 3.0); // dark crimson: on-kill rage

// Berserk potion — same flask geometry as the healing potion but with a
// bright orange-red elixir (vs healing's red) so the player can tell them
// apart on the floor without reading the name.
export const BERSERK_POTION: ModelSpec = {
  id: 'berserk-potion',
  materials: {
    glass: {
      color: 0x161814,
      roughness: 0.25,
      metalness: 0.1,
      fog: false,
      flatShading: 'auto',
    },
    elixir: {
      color: 0x000000,
      emissive: 0xff7722,        // bright orange (distinct from healing's red)
      emissiveIntensity: 2.4,
      roughness: 0.4,
      fog: false,
    },
    cork: {
      color: 0x4a3a26,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    { kind: 'cylinder', pos: [0, 0.06, 0], radius: 0.05, height: 0.10, segments: 10, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.055, 0], radius: 0.042, height: 0.08, segments: 10, mat: 'elixir' },
    { kind: 'cylinder', pos: [0, 0.135, 0], radius: 0.022, height: 0.05, segments: 8, mat: 'glass' },
    { kind: 'cylinder', pos: [0, 0.175, 0], radius: 0.020, height: 0.025, segments: 8, mat: 'cork' },
  ],
};

// Tattered cloak — flat extruded silhouette of a cloak. Doesn't simulate
// actual cloth (PSX-era games used flat shapes for cloth too). Stands
// vertical as a pickup; reads as "garment" rather than a specific shape.
export const TATTERED_CLOAK: ModelSpec = {
  id: 'tattered-cloak',
  materials: {
    fabric: {
      color: 0x2a1f18,
      roughness: 1.0,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    {
      kind: 'extrude',
      pos: [0, 0, 0],
      // Cloak silhouette — trapezoid, narrow at top (shoulders) and wider
      // at the bottom (hem), with a small ragged notch at the bottom-center.
      shape: [
        // Counter-clockwise: top-left, down-left, hem-left, jagged hem...
        [-0.08, 0.30],
        [-0.10, 0.20],
        [-0.14, 0.10],
        [-0.16, 0.00],
        [-0.10, -0.02],
        [-0.04, -0.01],
        [ 0.00, -0.03],   // ragged notch
        [ 0.04, -0.01],
        [ 0.10, -0.02],
        [ 0.16, 0.00],
        [ 0.14, 0.10],
        [ 0.10, 0.20],
        [ 0.08, 0.30],
      ],
      depth: 0.015,
      mat: 'fabric',
    },
  ],
};
