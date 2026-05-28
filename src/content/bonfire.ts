import type { ModelSpec } from '../ecs/model-types';

// Bonfire — simple firepit: a low ring of stones, ash + ember
// mound in the middle, a single warm flame above. No swords, no
// bone fragments, no central spike. Placed in the start vault of
// every floor as a pure-cosmetic anchor for the spawn area.

export const BONFIRE: ModelSpec = {
  id: 'bonfire',
  materials: {
    stone: { color: 0x2a221a, roughness: 1.0, flatShading: true },
    ash:   { color: 0x100c08, roughness: 1.0, flatShading: true },
    ember: { color: 0xffb060, emissive: 0xff7020, emissiveIntensity: 3.2, roughness: 0.8 },
    flame: { color: 0xffd58a, emissive: 0xffa040, emissiveIntensity: 3.4, roughness: 0.4 },
  },
  parts: [
    // Stone ring — six jagged stones around the firepit. Heights
    // and rotations jittered so no two read the same.
    { kind: 'box', pos: [ 0.55, 0.10,  0.00], size: [0.22, 0.20, 0.28], rot: [0,  0.30, 0.1], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [ 0.28, 0.09,  0.50], size: [0.24, 0.18, 0.20], rot: [0, -0.60, 0.0], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.30, 0.10,  0.48], size: [0.22, 0.20, 0.22], rot: [0,  0.90, 0.0], mat: 'stone', jitter: 0.06 },
    { kind: 'box', pos: [-0.55, 0.08,  0.00], size: [0.20, 0.16, 0.26], rot: [0, -0.20, 0.1], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.28, 0.09, -0.50], size: [0.24, 0.18, 0.22], rot: [0,  0.40, 0.0], mat: 'stone', jitter: 0.06 },
    { kind: 'box', pos: [ 0.32, 0.10, -0.48], size: [0.22, 0.20, 0.22], rot: [0, -0.80, 0.1], mat: 'stone', jitter: 0.05 },

    // Soot decal on the floor inside the ring.
    {
      kind: 'decal',
      pos: [0, 0.02, 0],
      rot: [-Math.PI / 2, 0, 0],
      size: [1.15, 1.15],
      texture: 'fire-wisp',
      color: 0x080604,
    },
    // Ash mound at the centre.
    { kind: 'cone', pos: [0, 0.08, 0], radius: 0.35, height: 0.16, segments: 12, mat: 'ash' },
    // Glowing ember layer on top.
    { kind: 'cone', pos: [0, 0.18, 0], radius: 0.28, height: 0.08, segments: 12, mat: 'ember', castShadow: false },

    // ── Fire core ─────────────────────────────────────────────────
    // Stack of additive flame sprites at varied heights + tints.
    // Each sprite has its own flicker (scale wobble + small Y bob)
    // with random phase so they don't sync. From any angle the
    // billboards layer into a flame-shaped silhouette that
    // actually moves.
    //
    // Reads bottom→top:
    //   1. Bright white-hot core, low + wide
    //   2. Hot yellow inner flame
    //   3. Orange middle tongue (the bulk of the visible fire)
    //   4. Red-orange tall tongue (the tallest tip)
    //   5. Outer warmth haze — large, dim, fast wobble
    //   6. Two skinny "side tongues" with different rhythm
    //
    // No central sphere — that's the "ellipsis" the user
    // complained about; sprite stack reads as a real flame.

    // Core hotspot — sits right on the embers.
    {
      kind: 'sprite', pos: [0, 0.25, 0],
      size: [0.55, 0.55],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffe8b0,
      flicker: { scale: 0.18, bob: 0.025, speed: 3.2 },
    },
    // Yellow inner flame, slightly taller than the core.
    {
      kind: 'sprite', pos: [0, 0.42, 0],
      size: [0.55, 0.85],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffd070,
      flicker: { scale: 0.20, bob: 0.04, speed: 2.4 },
    },
    // Orange middle tongue — the visible bulk.
    {
      kind: 'sprite', pos: [0, 0.58, 0],
      size: [0.70, 1.05],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff9040,
      flicker: { scale: 0.22, bob: 0.06, speed: 1.7 },
    },
    // Tall red-orange tongue — the highest tip, flickers most.
    {
      kind: 'sprite', pos: [0, 0.78, 0],
      size: [0.40, 1.10],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff5020,
      flicker: { scale: 0.28, bob: 0.10, speed: 2.9 },
    },
    // Two skinny side tongues — off-centre, faster rhythm, sells
    // the "fire has multiple flame fingers" feel.
    {
      kind: 'sprite', pos: [-0.18, 0.55, 0],
      size: [0.28, 0.75],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff7028,
      flicker: { scale: 0.30, bob: 0.08, speed: 3.6 },
    },
    {
      kind: 'sprite', pos: [0.20, 0.50, 0],
      size: [0.26, 0.70],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff7028,
      flicker: { scale: 0.30, bob: 0.08, speed: 3.1 },
    },
    // Outer warmth haze — wide, dim, slow. The "heat glow"
    // wrapping the visible flame.
    {
      kind: 'sprite', pos: [0, 0.40, 0],
      size: [1.80, 1.30],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xc8642a,
      flicker: { scale: 0.10, bob: 0.02, speed: 0.9 },
    },
  ],
  light: {
    color: 0xffb066,
    intensity: 60,
    distance: 9.5,
    decay: 1.5,
    pos: [0, 0.45, 0],
    castShadow: false,
  },
};
