import type { ModelSpec } from '../ecs/model-types';

// First-person right hand — a stylized closed-fist glove designed to do
// two jobs:
//
//   1. HOLD WEAPONS. Every melee weapon's grip_anchor slot aligns to
//      the hand's palm_anchor at mount time (see viewmodel.ts), so the
//      blade emerges from the closed fist's top edge and tilts with the
//      hand. Same hand model for every weapon — the wrist + palm tilt
//      reads as "knuckles forward, fingers wrapped around the grip"
//      regardless of what's stuck in it.
//
//   2. BE THE FIST when the player is unarmed. No weapon → the hand
//      mounts alone. The closed-fist silhouette + a punch pose reads
//      as a swung jab.
//
// Visual register: PS1-era lo-fi geometry, leather glove brown, flat
// shaded. The fingers are stubs of boxes (the closed-fist read), the
// knuckles are spheres on the top, the thumb is two cylinders forming
// the wrap. No emissive — the hand is never the light source. Pure
// silhouette work.
//
// Coordinate convention (camera-local, applied by the viewmodel group):
//   - origin = centre of the closed fist (where a held weapon's grip
//     anchor lines up)
//   - +Y    = up out of the top of the fist (where blades emerge)
//   - -Y    = down into the wrist + forearm
//   - +Z    = back toward the camera (knuckles face -Z toward the
//     scene the player is swinging at)
//   - +X    = the thumb side of the hand (right hand: outward from
//     the body when the arm is forward)
//
// All materials use fog:false — the hand is right in front of the
// camera, never inside fog distance, and shouldn't fade.

export const HAND_RIGHT: ModelSpec = {
  id: 'hand-right',
  materials: {
    glove: {
      color: 0x3a2818,        // dark brown leather
      roughness: 0.85,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
    bracer: {
      color: 0x241810,        // darker bracer leather
      roughness: 0.80,
      metalness: 0.25,
      fog: false,
      flatShading: 'auto',
    },
    bracerTrim: {
      color: 0x6a4a28,        // tarnished brass trim ring
      roughness: 0.60,
      metalness: 0.70,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // ── Forearm + wrist — extends -Y, vanishes off the bottom of view.
    {
      name: 'forearm',
      kind: 'cylinder',
      pos: [0, -0.22, 0.005],
      radius: 0.048,
      radiusTop: 0.040,
      height: 0.30,
      segments: 12,
      mat: 'bracer',
    },
    // Bracer trim ring at the wrist — a small brass band so the cuff
    // catches a highlight even in dim light.
    {
      kind: 'torus',
      pos: [0, -0.09, 0.005],
      radius: 0.046,
      tube: 0.010,
      segments: [6, 14],
      rot: [Math.PI / 2, 0, 0],
      mat: 'bracerTrim',
    },

    // ── Closed-fist body — a slightly rounded box, oriented so the
    // knuckle row faces +Y/-Z. Slight tilt makes it read as a forearm
    // angled across the body rather than a vertical stack.
    {
      name: 'palm',
      kind: 'box',
      pos: [0, 0, 0],
      size: [0.075, 0.085, 0.055],
      mat: 'glove',
    },

    // ── Knuckle row — 4 spheres along the +Y edge of the fist. Reads
    // as "back of a closed hand" from the camera angle.
    { kind: 'sphere', pos: [-0.024, 0.046, 0.018], radius: 0.012, segments: [8, 6], mat: 'glove' },
    { kind: 'sphere', pos: [-0.008, 0.048, 0.018], radius: 0.013, segments: [8, 6], mat: 'glove' },
    { kind: 'sphere', pos: [ 0.008, 0.046, 0.018], radius: 0.012, segments: [8, 6], mat: 'glove' },
    { kind: 'sphere', pos: [ 0.024, 0.044, 0.018], radius: 0.011, segments: [8, 6], mat: 'glove' },

    // ── Curled finger segments — the parts that wrap around the grip,
    // seen from the back. Small boxes between the knuckles and the
    // palm centre. Authored as one fused row; individual finger curls
    // aren't worth the geometry budget at this scale.
    { kind: 'box', pos: [-0.024, 0.022, 0.028], size: [0.018, 0.030, 0.022], mat: 'glove' },
    { kind: 'box', pos: [-0.008, 0.024, 0.028], size: [0.018, 0.032, 0.022], mat: 'glove' },
    { kind: 'box', pos: [ 0.008, 0.022, 0.028], size: [0.018, 0.030, 0.022], mat: 'glove' },
    { kind: 'box', pos: [ 0.024, 0.020, 0.028], size: [0.017, 0.026, 0.022], mat: 'glove' },

    // ── Thumb — two cylinders forming the L-shape of a wrapped thumb.
    // Base sits on the +X side of the palm, tip curls inward over the
    // top of where a grip would be. Reads as "thumb gripping" without
    // articulated joints.
    {
      kind: 'cylinder',
      pos: [0.040, 0.005, 0.005],
      radius: 0.013,
      height: 0.040,
      segments: 8,
      rot: [0, 0, -0.35],
      mat: 'glove',
    },
    {
      kind: 'cylinder',
      pos: [0.046, 0.040, 0.005],
      radius: 0.012,
      height: 0.034,
      segments: 8,
      rot: [0.4, 0, -1.05],
      mat: 'glove',
    },
  ],
  slots: {
    // The grip anchor a held weapon aligns to. Sits just above the
    // knuckle row + slightly forward of the palm — that's where the
    // weapon's own grip_anchor offset lines up, so a sword's blade
    // emerges from the top edge of the closed fist (the hilt invisible
    // inside) and a hammer's haft slides cleanly through the fist.
    palm_anchor: { pos: [0, 0.020, 0.005] },
  },
};
