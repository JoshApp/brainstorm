import type { ModelSpec } from '../ecs/model-types';

// Dark-Souls-style bonfire — placed in the start vault of every
// floor as a pure-cosmetic anchor for the spawn area. Visually:
// jagged stone ring → ash pile → tilted swords/bones jammed into
// the ground → tall central iron spike → big warm flame at the
// top. Throws a bright orange light onto the surrounding floor
// and walls.
//
// Authoring notes:
//   - Center is at local (0, 0, 0). The model places its base
//     stones around that point so dropping it via { kind: 'model',
//     x: spawn.x, z: spawn.z } centres the bonfire on the spawn.
//   - The flame sprite name 'flame' is recognised by the existing
//     torch flicker system in scene/torchlight.ts if we ever wire
//     a per-frame flicker. For now the flame is static and the
//     warmth comes from the light + sprite.
//   - All emissive parts are castShadow:false so the cage of
//     swords doesn't throw a noisy shadow web onto the floor.

export const BONFIRE: ModelSpec = {
  id: 'bonfire',
  materials: {
    stone: { color: 0x2a221a, roughness: 1.0, flatShading: true },
    iron:  { color: 0x1a1612, roughness: 0.8, metalness: 0.3, flatShading: true },
    ash:   { color: 0x100c08, roughness: 1.0, flatShading: true },
    ember: { color: 0xffb060, emissive: 0xff7020, emissiveIntensity: 3.2, roughness: 0.8 },
    flame: { color: 0xffd58a, emissive: 0xffa040, emissiveIntensity: 3.4, roughness: 0.4 },
  },
  parts: [
    // ── Stone ring around the base ────────────────────────────────
    // Six jagged stones at slightly varied radii + heights, jittered
    // so no two read the same.
    { kind: 'box', pos: [ 0.55, 0.10,  0.00], size: [0.22, 0.20, 0.28], rot: [0,  0.30, 0.1], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [ 0.28, 0.09,  0.50], size: [0.24, 0.18, 0.20], rot: [0, -0.60, 0.0], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.30, 0.10,  0.48], size: [0.22, 0.20, 0.22], rot: [0,  0.90, 0.0], mat: 'stone', jitter: 0.06 },
    { kind: 'box', pos: [-0.55, 0.08,  0.00], size: [0.20, 0.16, 0.26], rot: [0, -0.20, 0.1], mat: 'stone', jitter: 0.05 },
    { kind: 'box', pos: [-0.28, 0.09, -0.50], size: [0.24, 0.18, 0.22], rot: [0,  0.40, 0.0], mat: 'stone', jitter: 0.06 },
    { kind: 'box', pos: [ 0.32, 0.10, -0.48], size: [0.22, 0.20, 0.22], rot: [0, -0.80, 0.1], mat: 'stone', jitter: 0.05 },

    // ── Ash mound (dark base in the centre) ───────────────────────
    {
      kind: 'decal',
      pos: [0, 0.02, 0],
      rot: [-Math.PI / 2, 0, 0],
      size: [1.15, 1.15],
      texture: 'fire-wisp',
      color: 0x080604,
    },
    { kind: 'cone', pos: [0, 0.08, 0], radius: 0.35, height: 0.16, segments: 12, mat: 'ash' },

    // ── Smouldering ember layer just on top of the ash ────────────
    { kind: 'cone', pos: [0, 0.18, 0], radius: 0.28, height: 0.08, segments: 12, mat: 'ember', castShadow: false },

    // ── Central iron spike — a half-melted sword/rod ──────────────
    { kind: 'cylinder', pos: [0, 0.55, 0], radius: 0.035, height: 0.95, segments: 8, mat: 'iron' },
    // Cross-guard (forms a sword silhouette).
    { kind: 'box',      pos: [0, 0.55, 0], size: [0.30, 0.04, 0.04], mat: 'iron' },
    // Pommel cap.
    { kind: 'sphere',   pos: [0, 1.05, 0], radius: 0.05, mat: 'iron' },

    // ── A couple of tilted bone / sword fragments stuck in the ash ──
    { kind: 'cylinder', pos: [ 0.18, 0.32,  0.18], radius: 0.025, height: 0.55, segments: 6, rot: [-0.4, 0,  0.6], mat: 'iron' },
    { kind: 'cylinder', pos: [-0.20, 0.28, -0.16], radius: 0.022, height: 0.48, segments: 6, rot: [ 0.5, 0, -0.5], mat: 'iron' },
    { kind: 'cylinder', pos: [-0.16, 0.30,  0.20], radius: 0.020, height: 0.42, segments: 6, rot: [-0.3, 0, -0.4], mat: 'iron' },

    // ── Flame layers ──────────────────────────────────────────────
    // Inner bright flame sphere — the "core".
    { name: 'flame', kind: 'sphere', pos: [0, 0.95, 0], radius: 0.13, scale: [1, 1.6, 1], mat: 'flame', castShadow: false },
    // Wisp halo (large — bonfires throw a lot of light + heat).
    {
      kind: 'sprite',
      pos: [0, 1.10, 0],
      size: [0.95, 1.40],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffaa55,
    },
    // Outer warmth haze.
    {
      kind: 'sprite',
      pos: [0, 0.85, 0],
      size: [1.80, 1.40],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xc8642a,
    },
  ],
  light: {
    color: 0xffb066,
    intensity: 60,      // big warm pool — sets the start-room mood
    distance: 9.5,
    decay: 1.5,
    pos: [0, 0.95, 0],
    castShadow: false,  // sword fragments would cast a noisy cage shadow
  },
};
