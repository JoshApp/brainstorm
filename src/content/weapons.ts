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

// Bone needle — fast precise dagger. Narrow bone-white blade, tight
// cross-guard, dark wrapped grip. Visibly small in the player's view
// to read as the "weak fast" starter at a glance.
const NEEDLE_BLADE_SHAPE: [number, number][] = [
  // Cutting edge (hilt → tip) — long thin taper, no curve.
  [ 0.014, 0.00 ],
  [ 0.020, 0.12 ],
  [ 0.018, 0.26 ],
  [ 0.014, 0.40 ],
  [ 0.006, 0.50 ],   // tip
  // Spine (tip → hilt) — mirrors the edge, also straight.
  [-0.004, 0.48 ],
  [-0.010, 0.36 ],
  [-0.012, 0.24 ],
  [-0.010, 0.12 ],
  [-0.006, 0.00 ],
];

export const BONE_NEEDLE: ModelSpec = {
  id: 'bone-needle',
  materials: {
    bone: {
      // Off-white with a warm marrow tint and faint emissive so the
      // blade stays visible at distance against dark floors.
      color: 0xe0d6c0,
      roughness: 0.7,
      metalness: 0.05,
      emissive: 0x281a10,
      emissiveIntensity: 0.25,
      fog: false,
      flatShading: 'auto',
    },
    guard: {
      color: 0x1a1410,
      roughness: 0.55,
      metalness: 0.65,
      fog: false,
      flatShading: 'auto',
    },
    wrap: {
      color: 0x2a1a0e,
      roughness: 0.95,
      metalness: 0.0,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Blade — small thin extruded silhouette.
    { name: 'blade', kind: 'extrude', shape: NEEDLE_BLADE_SHAPE, depth: 0.005, mat: 'bone' },
    // Tight cross-guard — barely wider than the grip.
    { name: 'guard', kind: 'box', pos: [0.004, -0.008, 0], size: [0.08, 0.014, 0.025], mat: 'guard' },
    // Wrapped grip — narrow + short.
    { name: 'grip', kind: 'cylinder', pos: [0.004, -0.060, 0], radius: 0.014, height: 0.085, segments: 8, mat: 'wrap' },
    // Pommel — a small bone bead.
    { name: 'pommel', kind: 'sphere', pos: [0.004, -0.108, 0], radius: 0.018, segments: [10, 8], mat: 'bone' },
  ],
  slots: {
    blade_tip: { pos: [0.006, 0.50, 0] },
    grip_anchor: { pos: [0.004, -0.060, 0] },
  },
};

// Iron maul — slow heavy hitter. Long iron-banded haft + a chunky
// box-shaped head with two side bands. Player's maul reads as
// "warhammer" — distinct from the stoneguard's stone-bludgeon
// silhouette so the held weapon and the enemy don't read alike.
export const IRON_MAUL: ModelSpec = {
  id: 'iron-maul',
  materials: {
    head: {
      // Dark iron — slightly more metallic than the haft for contrast.
      color: 0x3c3a36,
      roughness: 0.45,
      metalness: 0.85,
      fog: false,
      flatShading: 'auto',
    },
    haft: {
      // Stained wood + iron bands.
      color: 0x2a1a10,
      roughness: 0.92,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
    band: {
      color: 0x52504a,
      roughness: 0.55,
      metalness: 0.8,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // Hammer head — square iron block. Bigger than the stoneguard's
    // stone bludgeon so the silhouette is distinctly "tool, not rock."
    { name: 'head', kind: 'box', pos: [0, 0.46, 0], size: [0.085, 0.16, 0.155], mat: 'head' },
    // Side bands wrapping the head — sells "forged iron, banded shut."
    { kind: 'box', pos: [0, 0.46, 0.062], size: [0.092, 0.17, 0.018], mat: 'band' },
    { kind: 'box', pos: [0, 0.46, -0.062], size: [0.092, 0.17, 0.018], mat: 'band' },
    // Haft — long thick wooden shaft.
    { name: 'haft', kind: 'cylinder', pos: [0, 0.18, 0], radius: 0.016, height: 0.40, segments: 10, mat: 'haft' },
    // Iron bands at the top + bottom of the grip section.
    { kind: 'cylinder', pos: [0, 0.34, 0], radius: 0.020, height: 0.024, segments: 10, mat: 'band' },
    { kind: 'cylinder', pos: [0, 0.02, 0], radius: 0.020, height: 0.024, segments: 10, mat: 'band' },
    // Pommel cap — flat iron disc at the base.
    { kind: 'cylinder', pos: [0, -0.018, 0], radius: 0.024, height: 0.014, segments: 10, mat: 'head' },
  ],
  slots: {
    head_top: { pos: [0, 0.54, 0] },
    grip_anchor: { pos: [0, 0.18, 0] },
  },
};

// Crossbow viewmodel — a stock running forward (−Z), two splayed bow
// arms at the front, a loaded bolt down the groove. Hand-scale, points
// where the player faces so the fire reads forward.
export const CROSSBOW: ModelSpec = {
  id: 'weapon-crossbow',
  materials: {
    wood:  { color: 0x3a2a1a, roughness: 0.85, metalness: 0.1, fog: false, flatShading: 'auto' },
    metal: { color: 0x6a6258, roughness: 0.5, metalness: 0.7, fog: false, flatShading: 'auto' },
    bolt:  { color: 0x9a8a70, roughness: 0.7, metalness: 0.3, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Stock — runs forward along −Z.
    { kind: 'box', pos: [0, 0, -0.06], size: [0.035, 0.05, 0.26], mat: 'wood', jitter: 0.004 },
    // Grip — drops below the stock.
    { kind: 'box', pos: [0, -0.07, 0.02], size: [0.03, 0.10, 0.05], mat: 'wood' },
    // Bow arms — a wide thin bar across X at the front, slightly swept.
    { kind: 'box', pos: [0, 0.01, -0.18], size: [0.30, 0.018, 0.02], mat: 'metal', jitter: 0.003 },
    // String hint — a thin bar behind the arms.
    { kind: 'box', pos: [0, 0.012, -0.10], size: [0.26, 0.006, 0.006], mat: 'metal' },
    // Loaded bolt — thin shaft down the groove, tip forward.
    { kind: 'cylinder', pos: [0, 0.03, -0.14], radius: 0.008, height: 0.22, rot: [Math.PI / 2, 0, 0], mat: 'bolt' },
  ],
  slots: {
    muzzle: { pos: [0, 0.03, -0.28] },
  },
};

// Wand viewmodel — a gnarled rod with a bright arcane orb at the tip.
// The orb's emissive sells "this casts" even at rest.
export const WAND: ModelSpec = {
  id: 'weapon-wand',
  materials: {
    wood: { color: 0x241a12, roughness: 0.95, metalness: 0.0, fog: false, flatShading: 'auto' },
    orb:  { color: 0x000000, emissive: 0xb060ff, emissiveIntensity: 2.6, roughness: 1.0, fog: false },
  },
  parts: [
    // Shaft — thin rod pointing forward (−Z).
    { kind: 'cylinder', pos: [0, 0, -0.04], radius: 0.012, height: 0.26, rot: [Math.PI / 2, 0, 0], mat: 'wood', jitter: 0.006 },
    // Grip wrap.
    { kind: 'cylinder', pos: [0, -0.005, 0.06], radius: 0.018, height: 0.08, rot: [Math.PI / 2, 0, 0], mat: 'wood' },
    // Arcane orb at the tip.
    { kind: 'sphere', pos: [0, 0.005, -0.18], radius: 0.035, segments: [12, 10], mat: 'orb' },
    // Halo so the cast colour reads at a glance.
    { kind: 'sprite', pos: [0, 0.005, -0.18], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: 0xb060ff },
  ],
  slots: {
    muzzle: { pos: [0, 0.005, -0.22] },
  },
};

// Spear viewmodel — a long ash shaft along −Z with a leaf head at the
// forward tip. The length IS the read: it pokes from outside enemy
// reach. Kept thin so it doesn't fill the screen at the thrust pose.
export const SPEAR: ModelSpec = {
  id: 'weapon-spear',
  materials: {
    haft: { color: 0x4a3322, roughness: 0.9, metalness: 0.05, fog: false, flatShading: 'auto' },
    head: { color: 0x9a948a, roughness: 0.5, metalness: 0.7, fog: false, flatShading: 'auto' },
    bind: { color: 0x2a1d12, roughness: 0.8, metalness: 0.1, fog: false, flatShading: 'auto' },
  },
  parts: [
    // Shaft — long thin rod running forward along −Z.
    { kind: 'cylinder', pos: [0, 0, -0.16], radius: 0.012, height: 0.74, rot: [Math.PI / 2, 0, 0], mat: 'haft', jitter: 0.005 },
    // Grip binding near the rear third.
    { kind: 'cylinder', pos: [0, 0, 0.10], radius: 0.018, height: 0.10, rot: [Math.PI / 2, 0, 0], mat: 'bind' },
    // Socket binding just behind the head.
    { kind: 'cylinder', pos: [0, 0, -0.46], radius: 0.016, height: 0.04, rot: [Math.PI / 2, 0, 0], mat: 'bind' },
    // Leaf head — a cone pointing forward (−Z) at the tip.
    { kind: 'cone', pos: [0, 0, -0.55], radius: 0.028, height: 0.14, rot: [-Math.PI / 2, 0, 0], mat: 'head', jitter: 0.004 },
  ],
  slots: {
    muzzle: { pos: [0, 0, -0.62] },
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
