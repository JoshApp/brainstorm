import type { ModelSpec } from '../ecs/model-types';

// Dark-Souls-style bonfire — a tighter, more detailed firepit.
//
// What it reads as: a low ring of dark stones around a dirt
// mound, with a tangle of broken sticks crisscrossing in the
// centre. An old iron sword has been driven point-first into
// the mound, blade upward — the medium through which the fire
// burns. Flames lick up around the cross-guard, the tongue
// stack tilting and flickering with several sprite layers.
//
// Smaller overall footprint than the previous version (~1m
// across instead of 1.6m), and the floor light is much dimmer
// + faster falloff so it stops painting a bright spotlight
// circle on the floor. The fire stack still does the
// "alive" work via per-sprite flicker.

export const BONFIRE: ModelSpec = {
  id: 'bonfire',
  materials: {
    stone:  { color: 0x231d16, roughness: 1.0, flatShading: true },
    dirt:   { color: 0x2a1d10, roughness: 1.0, flatShading: true },
    twig:   { color: 0x1a1108, roughness: 0.95, flatShading: true },
    iron:   { color: 0x141210, roughness: 0.55, metalness: 0.6, flatShading: true },
    ember:  { color: 0xffb060, emissive: 0xff7020, emissiveIntensity: 3.0, roughness: 0.8 },
    flame:  { color: 0xffd58a, emissive: 0xffa040, emissiveIntensity: 3.4, roughness: 0.4 },
  },
  parts: [
    // ── Stone ring (tighter than before) ────────────────────────
    // Six jagged stones around a ~0.45m-radius pit. Heights +
    // rotations jittered so no two read identical.
    { kind: 'box', pos: [ 0.45, 0.09,  0.00], size: [0.18, 0.18, 0.22], rot: [0,  0.30, 0.1], mat: 'stone', jitter: 0.04 },
    { kind: 'box', pos: [ 0.22, 0.08,  0.40], size: [0.20, 0.16, 0.18], rot: [0, -0.60, 0.0], mat: 'stone', jitter: 0.04 },
    { kind: 'box', pos: [-0.25, 0.09,  0.38], size: [0.18, 0.18, 0.18], rot: [0,  0.90, 0.0], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.45, 0.07,  0.00], size: [0.18, 0.14, 0.22], rot: [0, -0.20, 0.1], mat: 'stone', jitter: 0.04 },
    { kind: 'box', pos: [-0.22, 0.08, -0.40], size: [0.20, 0.16, 0.18], rot: [0,  0.40, 0.0], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [ 0.26, 0.09, -0.38], size: [0.18, 0.18, 0.18], rot: [0, -0.80, 0.1], mat: 'stone', jitter: 0.04 },

    // ── Dirt mound (where the sword + sticks sit) ───────────────
    {
      kind: 'decal',
      pos: [0, 0.018, 0],
      rot: [-Math.PI / 2, 0, 0],
      size: [0.85, 0.85],
      texture: 'fire-wisp',
      color: 0x0c0805,
    },
    { kind: 'cone', pos: [0, 0.07, 0], radius: 0.28, height: 0.14, segments: 12, mat: 'dirt' },

    // ── Twig tangle — crisscrossed broken branches in the mound ─
    { kind: 'cylinder', pos: [ 0.04, 0.16, -0.02], radius: 0.018, height: 0.35, segments: 6, rot: [0.7,  0.3, -0.4], mat: 'twig' },
    { kind: 'cylinder', pos: [-0.04, 0.15,  0.03], radius: 0.016, height: 0.32, segments: 6, rot: [0.6, -0.4,  0.5], mat: 'twig' },
    { kind: 'cylinder', pos: [ 0.06, 0.14,  0.04], radius: 0.014, height: 0.28, segments: 6, rot: [0.5,  0.8, -0.2], mat: 'twig' },
    { kind: 'cylinder', pos: [-0.08, 0.14, -0.04], radius: 0.014, height: 0.26, segments: 6, rot: [0.8, -0.7,  0.3], mat: 'twig' },
    // A few short stubs sticking up between the longer twigs.
    { kind: 'cylinder', pos: [ 0.10, 0.18,  0.10], radius: 0.012, height: 0.18, segments: 6, rot: [0.2,  0,    0.1], mat: 'twig' },
    { kind: 'cylinder', pos: [-0.11, 0.18, -0.09], radius: 0.012, height: 0.18, segments: 6, rot: [-0.2, 0,   -0.1], mat: 'twig' },

    // ── Smouldering ember ring on top of the dirt ───────────────
    { kind: 'cylinder', pos: [0, 0.16, 0], radius: 0.22, height: 0.04, segments: 12, mat: 'ember', castShadow: false },

    // ── Iron sword stuck point-first into the mound ─────────────
    // Bladed half rises up THROUGH the flames; cross-guard sits
    // just above the dirt; pommel is the small ball at the top.
    // Two sub-blades for a tapered look (lower wider, upper
    // narrower) so it reads as forged.
    { kind: 'box',      pos: [0, 0.42, 0], size: [0.045, 0.40, 0.018], mat: 'iron' },
    { kind: 'box',      pos: [0, 0.78, 0], size: [0.030, 0.32, 0.014], mat: 'iron' },
    // Cross-guard.
    { kind: 'box',      pos: [0, 0.225, 0], size: [0.32, 0.030, 0.040], mat: 'iron' },
    // Hilt grip (just under the cross-guard).
    { kind: 'cylinder', pos: [0, 0.17,  0], radius: 0.020, height: 0.08, segments: 6, mat: 'iron' },
    // Pommel — round ball at the very top of the sword.
    { kind: 'sphere',   pos: [0, 0.95, 0], radius: 0.040, mat: 'iron' },

    // ── Flame stack — sprites rising around the cross-guard ─────
    // Same flicker pattern as before but origins shifted slightly
    // so the flames bias UPWARD around the sword's grip rather
    // than concentrating at the dirt line. White-hot core →
    // yellow body → orange tongue → red tip → two side fingers
    // → outer warmth haze.
    {
      kind: 'sprite', pos: [0, 0.30, 0],
      size: [0.40, 0.40],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffe8b0,
      flicker: { scale: 0.18, bob: 0.020, speed: 3.2 },
    },
    {
      kind: 'sprite', pos: [0, 0.42, 0],
      size: [0.42, 0.65],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffd070,
      flicker: { scale: 0.20, bob: 0.035, speed: 2.4 },
    },
    {
      kind: 'sprite', pos: [0, 0.55, 0],
      size: [0.55, 0.85],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff9040,
      flicker: { scale: 0.22, bob: 0.05, speed: 1.7 },
    },
    {
      kind: 'sprite', pos: [0, 0.72, 0],
      size: [0.30, 0.90],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff5020,
      flicker: { scale: 0.28, bob: 0.08, speed: 2.9 },
    },
    {
      kind: 'sprite', pos: [-0.14, 0.50, 0],
      size: [0.22, 0.60],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff7028,
      flicker: { scale: 0.30, bob: 0.07, speed: 3.6 },
    },
    {
      kind: 'sprite', pos: [0.15, 0.45, 0],
      size: [0.20, 0.55],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xff7028,
      flicker: { scale: 0.30, bob: 0.07, speed: 3.1 },
    },
    // Outer warmth haze — wider, dim, slow. Sized down from the
    // previous version so the warmth glow doesn't spill across
    // the whole room.
    {
      kind: 'sprite', pos: [0, 0.42, 0],
      size: [1.30, 1.05],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xc8642a,
      flicker: { scale: 0.10, bob: 0.02, speed: 0.9 },
    },
  ],
  light: {
    color: 0xffb066,
    // Smaller + faster-falloff than before so the bright floor
    // circle is tighter (was intensity 60, distance 9.5, decay
    // 1.5 — too much spotlight). The flame stack carries the
    // visible warmth; the light just tints the surrounding stone.
    intensity: 38,
    distance: 6.5,
    decay: 2.0,
    pos: [0, 0.55, 0],
    castShadow: false,
  },
};
