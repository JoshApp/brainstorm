import type { ModelSpec } from '../ecs/model-types';

// Altar surface items — small ritual props placed on top of an
// altar at build time. The builder picks 1-3 randomly per altar
// instance so no two altars look identical: this one has a
// chalice + skull, the next has a bowl + bones + dagger, etc.
//
// All authored at "altar surface level" — local origin sits at
// y=0, so the builder places these at the altar's top-surface Y
// without further offset. Small footprints (≤0.3m radius) so
// multiple items fit on a 0.9m-wide altar.

// Stone offering bowl — wide shallow cylinder with a darker
// interior decal so it reads as hollow.
export const ALTAR_BOWL: ModelSpec = {
  id: 'altar-bowl',
  materials: {
    stone: { color: 0x3a3128, roughness: 1.0, flatShading: true },
    inside: { color: 0x0a0805, roughness: 1.0 },
  },
  parts: [
    { kind: 'cylinder', pos: [0, 0.04, 0], radius: 0.15, height: 0.08, segments: 12, mat: 'stone', jitter: 0.008 },
    // Interior darkening — flat cylinder slightly inside the rim.
    { kind: 'cylinder', pos: [0, 0.08, 0], radius: 0.115, height: 0.01, segments: 12, mat: 'inside' },
  ],
};

// Brass chalice — tall thin stemmed cup. Slight emissive on the
// metal so it catches torchlight nicely.
export const ALTAR_CHALICE: ModelSpec = {
  id: 'altar-chalice',
  materials: {
    brass: {
      color: 0x4a3820,
      roughness: 0.55,
      metalness: 0.65,
      emissive: 0x100a05,
      emissiveIntensity: 0.4,
      flatShading: true,
    },
  },
  parts: [
    // Base disc.
    { kind: 'cylinder', pos: [0, 0.015, 0], radius: 0.075, height: 0.03, segments: 10, mat: 'brass' },
    // Stem.
    { kind: 'cylinder', pos: [0, 0.10,  0], radius: 0.022, height: 0.14, segments: 8,  mat: 'brass' },
    // Cup — flared cylinder (wider at top via radiusTop).
    { kind: 'cylinder', pos: [0, 0.22,  0], radius: 0.06, radiusTop: 0.085, height: 0.10, segments: 10, mat: 'brass' },
  ],
};

// Ritual dagger — laid flat on the altar surface. Cross-guard +
// pommel + thin blade.
export const ALTAR_DAGGER: ModelSpec = {
  id: 'altar-dagger',
  materials: {
    iron: { color: 0x1a1612, roughness: 0.6, metalness: 0.4, flatShading: true },
    hilt: { color: 0x2a1a10, roughness: 0.9, flatShading: true },
  },
  parts: [
    // Blade — thin elongated box.
    { kind: 'box', pos: [ 0.12, 0.015, 0], size: [0.24, 0.025, 0.04], mat: 'iron' },
    // Cross-guard.
    { kind: 'box', pos: [-0.02, 0.015, 0], size: [0.05, 0.025, 0.12], mat: 'iron' },
    // Hilt grip.
    { kind: 'box', pos: [-0.10, 0.015, 0], size: [0.10, 0.025, 0.035], mat: 'hilt' },
    // Pommel.
    { kind: 'box', pos: [-0.17, 0.015, 0], size: [0.04, 0.04, 0.04], mat: 'iron' },
  ],
};

// Bone fragments — a couple of femur-shaped capsules + a small
// vertebra-like sphere.
export const ALTAR_BONES: ModelSpec = {
  id: 'altar-bones',
  materials: {
    bone: { color: 0x9a8870, roughness: 0.95, flatShading: true },
  },
  parts: [
    { kind: 'capsule', pos: [0,     0.025, 0],    radius: 0.022, height: 0.18, rot: [0,  0.2, Math.PI / 2], mat: 'bone' },
    { kind: 'capsule', pos: [0.04,  0.025, 0.06], radius: 0.020, height: 0.16, rot: [0, -0.4, Math.PI / 2], mat: 'bone' },
    { kind: 'sphere',  pos: [-0.06, 0.025, -0.04], radius: 0.030, mat: 'bone' },
  ],
};

// Wax candle stub — short fat candle with a small flame sprite.
// Smaller / dimmer than the floor candle so multiple can sit on
// an altar without blowing the room out.
export const ALTAR_CANDLE_STUB: ModelSpec = {
  id: 'altar-candle-stub',
  materials: {
    wax:   { color: 0x4a3a2e, roughness: 0.9, flatShading: true },
    flame: { color: 0xffd58a, emissive: 0xff8a40, emissiveIntensity: 2.4, roughness: 0.4 },
  },
  parts: [
    { kind: 'cylinder', pos: [0, 0.06, 0], radius: 0.035, height: 0.12, segments: 8, mat: 'wax' },
    // Wick + flame sphere (small, no animation — candle on a flat
    // surface looks fine static at this scale).
    { kind: 'cylinder', pos: [0, 0.13, 0], radius: 0.0035, height: 0.018, segments: 4, mat: 'wax' },
    { kind: 'sphere',   pos: [0, 0.155, 0], radius: 0.022, scale: [1, 1.4, 1], mat: 'flame', castShadow: false },
    // Wisp halo around the flame.
    {
      kind: 'sprite',
      pos: [0, 0.19, 0],
      size: [0.12, 0.18],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffa755,
      flicker: { scale: 0.18, bob: 0.015, speed: 2.6 },
    },
  ],
  light: {
    color: 0xffa755,
    intensity: 8,
    distance: 2.2,
    decay: 1.6,
    pos: [0, 0.16, 0],
    castShadow: false,
  },
};

/** The pool of items the altar builder picks from. Weighted so
 *  bowls + bones + skulls dominate (most "found ritual" altars
 *  read that way), with chalices + daggers + candles rarer. */
export interface AltarItemEntry {
  model: ModelSpec;
  /** Pick weight in the random selection. */
  weight: number;
  /** Footprint half-extent used for spacing items on the altar. */
  halfExtent: number;
}
