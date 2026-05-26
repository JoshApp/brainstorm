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

// Heartburn — fabled-rarity flame-touched blade. Straight + slightly
// wavy blade with hot orange-red emissive cutting edge; gold cross-guard.
// Visually distinct from the rusted sword (taller, glowing) and the
// scimitar (curved). Dropped only by the antechamber wraith.
const HEARTBURN_BLADE_SHAPE: [number, number][] = [
  // Cutting edge — slight wave to suggest fire-forged, not perfectly straight
  [ 0.022, 0.00 ],
  [ 0.034, 0.12 ],
  [ 0.030, 0.24 ],
  [ 0.038, 0.36 ],
  [ 0.032, 0.48 ],
  [ 0.040, 0.60 ],
  [ 0.020, 0.70 ],   // tip
  // Spine
  [-0.005, 0.65 ],
  [ 0.000, 0.50 ],
  [-0.008, 0.36 ],
  [ 0.000, 0.24 ],
  [-0.008, 0.12 ],
  [-0.005, 0.00 ],
];

export const HEARTBURN: ModelSpec = {
  id: 'heartburn',
  materials: {
    blade: {
      // Black base with bright orange emissive — the blade itself glows.
      color: 0x2a1208,
      emissive: 0xff5522,
      emissiveIntensity: 1.0,
      roughness: 0.45,
      metalness: 0.5,
      fog: false,
      flatShading: 'auto',
    },
    fittings: {
      // Gold — fits the fabled (amber-gold) rarity color theme.
      color: 0xa37822,
      roughness: 0.4,
      metalness: 0.85,
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
    pommelStone: {
      // Bright red gem set into the pommel.
      color: 0x000000,
      emissive: 0xff2233,
      emissiveIntensity: 1.6,
      roughness: 0.4,
      fog: false,
    },
  },
  parts: [
    { name: 'blade', kind: 'extrude', shape: HEARTBURN_BLADE_SHAPE, depth: 0.009, mat: 'blade' },
    // Cross-guard — wider than the scimitar's so it reads as a larger weapon.
    { name: 'guard', kind: 'box', pos: [0.01, -0.012, 0], size: [0.20, 0.025, 0.04], mat: 'fittings' },
    // Grip
    { name: 'grip', kind: 'cylinder', pos: [0.005, -0.085, 0], radius: 0.022, height: 0.14, segments: 10, mat: 'grip' },
    // Pommel — gold sphere with a tiny inset gem.
    { name: 'pommel', kind: 'sphere', pos: [0.005, -0.17, 0], radius: 0.028, segments: [12, 10], mat: 'fittings' },
    // Pommel gem — tiny bright sphere set into the pommel front.
    { kind: 'sphere', pos: [0.005, -0.17, -0.028], radius: 0.011, segments: [8, 8], mat: 'pommelStone' },
  ],
  slots: {
    blade_tip: { pos: [0.02, 0.70, 0] },
    grip_anchor: { pos: [0.005, -0.085, 0] },
  },
};

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
