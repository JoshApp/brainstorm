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
export const RING_OF_FRENZY = ringModel('ring-frenzy', 0xc05bd6, 2.4);    // violet: cursed rage

// --- Helmet — iron coif (skullcap with a small forehead band) ---
export const IRON_COIF: ModelSpec = {
  id: 'iron-coif',
  materials: {
    iron: { color: 0x44423e, roughness: 0.55, metalness: 0.7, fog: false, flatShading: 'auto' },
    band: { color: 0x2a2622, roughness: 0.7, metalness: 0.5, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Dome — upper hemisphere of a sphere (scaled flat). PartSpec doesn't
    // directly express hemispheres; we use a sphere positioned so its
    // bottom is at the band level, then place a flat plate below to hide.
    { kind: 'sphere', pos: [0, 0.05, 0], radius: 0.085, segments: [12, 8], mat: 'iron' },
    // Forehead band (slightly wider torus around the base).
    { kind: 'torus', pos: [0, 0.005, 0], rot: [Math.PI / 2, 0, 0], radius: 0.087, tube: 0.012, segments: [16, 8], mat: 'band' },
  ],
};

// --- Amulet — single skull-shaped pendant hanging from a thin chain loop ---
export const BONE_AMULET: ModelSpec = {
  id: 'bone-amulet',
  materials: {
    chain: { color: 0x2a2622, roughness: 0.6, metalness: 0.7, fog: false, flatShading: 'auto' },
    bone:  { color: 0xc8b896, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    eye:   { color: 0x000000, emissive: 0xff4400, emissiveIntensity: 1.6, roughness: 1.0, fog: false },
  },
  parts: [
    // Chain — wide thin torus at top.
    { kind: 'torus', pos: [0, 0.16, 0], rot: [Math.PI / 2, 0, 0], radius: 0.06, tube: 0.005, segments: [16, 6], mat: 'chain' },
    // Pendant body — slightly oblate sphere for a skull-ish shape.
    { kind: 'sphere', pos: [0, 0.06, 0], scale: [1.0, 1.1, 0.8], radius: 0.04, segments: [10, 8], mat: 'bone' },
    // Two tiny glowing eye sockets so the amulet visually reads as a skull.
    { kind: 'sphere', pos: [-0.018, 0.07, -0.032], radius: 0.008, segments: [6, 6], mat: 'eye' },
    { kind: 'sphere', pos: [ 0.018, 0.07, -0.032], radius: 0.008, segments: [6, 6], mat: 'eye' },
  ],
};

// --- Gloves — single grouped representation (one glove shape) ---
export const LEATHER_GLOVES: ModelSpec = {
  id: 'leather-gloves',
  materials: {
    leather: { color: 0x3a2a1c, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    binding: { color: 0x161208, roughness: 1.0, metalness: 0.0, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Hand box — slightly tall, narrow.
    { kind: 'box', pos: [0, 0.08, 0], size: [0.08, 0.12, 0.04], mat: 'leather' },
    // Cuff — thin band at the wrist.
    { kind: 'box', pos: [0, 0.02, 0], size: [0.09, 0.025, 0.05], mat: 'binding' },
    // Thumb — small box on the side.
    { kind: 'box', pos: [0.045, 0.07, 0], size: [0.03, 0.05, 0.035], mat: 'leather' },
  ],
};

// --- Boots — simple L-shape (foot + ankle cylinder) ---
export const WORN_BOOTS: ModelSpec = {
  id: 'worn-boots',
  materials: {
    leather: { color: 0x2a1f14, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    sole:    { color: 0x12100a, roughness: 1.0, metalness: 0.0, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Ankle column.
    { kind: 'cylinder', pos: [0, 0.10, 0], radius: 0.038, height: 0.12, segments: 10, mat: 'leather' },
    // Foot — flat box sticking forward.
    { kind: 'box', pos: [0, 0.025, -0.045], size: [0.075, 0.04, 0.12], mat: 'leather' },
    // Sole — thin darker box under the foot.
    { kind: 'box', pos: [0, 0.005, -0.045], size: [0.078, 0.013, 0.125], mat: 'sole' },
  ],
};

// --- Shield — round wooden shield with metal rim ---
export const WOODEN_SHIELD: ModelSpec = {
  id: 'wooden-shield',
  materials: {
    wood: { color: 0x3a2418, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    iron: { color: 0x32302c, roughness: 0.55, metalness: 0.7, fog: false, flatShading: 'auto' },
    boss: { color: 0x44423e, roughness: 0.5, metalness: 0.75, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Shield face — short flat cylinder (a disc).
    { kind: 'cylinder', pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], radius: 0.14, height: 0.015, segments: 18, mat: 'wood' },
    // Iron rim — torus around the edge.
    { kind: 'torus', pos: [0, 0, 0], radius: 0.140, tube: 0.008, segments: [22, 6], mat: 'iron' },
    // Central boss — small dome.
    { kind: 'sphere', pos: [0, 0, 0.015], radius: 0.030, segments: [10, 6], mat: 'boss' },
  ],
};

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
