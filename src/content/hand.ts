import type { ModelSpec } from '../ecs/model-types';

// First-person RIGHT hand — a stylized skeletal bone hand. The
// previous draft was inadvertently mirrored (thumb at +X = away from
// body) which read as a LEFT hand in viewport. All X coordinates are
// now flipped: the thumb sits at −X (toward body centre), the pinky
// at +X (outboard), which is the correct right-hand silhouette from
// a first-person POV.
//
// Two jobs:
//
//   1. HOLD WEAPONS. Every weapon's `grip_anchor` slot aligns to the
//      hand's `palm_anchor` at mount time (viewmodel.ts), so a blade
//      emerges from the closed fist's grip and tilts with the hand.
//      Same hand for every weapon.
//
//   2. BE THE FIST when the player is unarmed. No weapon → the hand
//      mounts alone. The skeletal silhouette reads as a closed fist;
//      a punch pose drives it forward.
//
// ── Rig (this is what makes it interesting) ─────────────────────────
//
// Five finger joint slots — `finger_thumb`, `finger_index`,
// `finger_middle`, `finger_ring`, `finger_pinky` — sit at each
// metacarpal-phalanx pivot. Each finger's phalanx capsule is
// PARENTED to its joint slot, so rotating the slot curls the finger
// at the knuckle (the cascade is handled by buildModel's transform
// hierarchy — see src/ecs/build-model.ts:82-101 and the pattern in
// src/content/enemy-models.ts).
//
// Rest pose (authored): each joint is pre-rotated to a CURLED state
// at ≈80° (rotX ≈ -1.40 rad) — tight enough that the fingertips
// visibly wrap toward the palm-side of where a grip would sit.
// Runtime adjustment in viewmodel.ts further tightens for thin grips
// and loosens for thick hafts based on each weapon's grip cylinder
// radius. To open the hand for a splayed pose, set rotX → 0.
//
// Coordinate convention (Y-up, −Z forward — per CLAUDE.md):
//   - origin = centre of the closed fist (= where a weapon's
//     grip_anchor lines up)
//   - +Y    = up, out of the top of the fist (blades emerge here)
//   - −Y    = down the forearm, vanishing off the bottom of view
//   - +Z    = back of the hand (faces the camera)
//   - −Z    = palm side (faces the scene the player swings at)
//   - +X    = OUTBOARD (pinky side, away from body centre)
//   - −X    = INBOARD (thumb side, toward body centre)
//
// All materials use fog:false — the hand is right in front of the
// camera, never inside fog distance, and shouldn't fade.

export const HAND_RIGHT: ModelSpec = {
  id: 'hand-right-bone',
  materials: {
    bone: {
      color: 0xc8b89a,          // pale yellowed ivory — old bones, not fresh
      roughness: 0.85,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
    boneDark: {
      color: 0x6e5d44,          // shadowed bone — the joints, sinew, recessed grooves
      roughness: 0.90,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // ── FOREARM ─ radius (thumb-side, −X) + ulna (pinky-side, +X).
    // Tapered so they fan slightly at the wrist end; offset so the
    // gap between them is visible (anatomical signature: "this is a
    // skeleton, not a tube").
    {
      name: 'radius',          // thumb-side bone (−X for right hand)
      kind: 'cylinder',
      pos: [-0.013, -0.27, 0.005],
      radius: 0.018,
      radiusTop: 0.014,
      height: 0.36,
      segments: 12,
      mat: 'bone',
    },
    {
      name: 'ulna',            // pinky-side bone (+X for right hand)
      kind: 'cylinder',
      pos: [0.013, -0.27, 0.005],
      radius: 0.017,
      radiusTop: 0.013,
      height: 0.36,
      segments: 12,
      mat: 'bone',
    },
    // Sinew / shadow gap between the bones.
    {
      kind: 'cylinder',
      pos: [0, -0.27, 0.005],
      radius: 0.012,
      height: 0.34,
      segments: 8,
      mat: 'boneDark',
    },

    // ── WRIST / carpal cluster ─ a flattened cap that the metacarpals
    // fan out from. Reads as "the knot of small bones at the wrist."
    {
      name: 'carpus',
      kind: 'sphere',
      pos: [0, -0.07, 0.005],
      radius: 0.034,
      segments: [12, 8],
      mat: 'bone',
    },

    // ── METACARPALS ─ five tapered bones fanning from the carpus to
    // the knuckle row. Thumb is on −X (inboard); index/middle/ring/
    // pinky sweep across +X (outboard). Thumb metacarpal angles
    // outward on −X to plant the joint where the bone naturally ends.
    {
      name: 'mc_thumb',
      kind: 'cylinder',
      pos: [-0.030, -0.018, 0.012],
      radius: 0.013,
      radiusTop: 0.011,
      height: 0.060,
      segments: 10,
      rot: [0, 0, 0.65],         // tilt outward toward −X (thumb side)
      mat: 'bone',
    },
    {
      name: 'mc_index',
      kind: 'cylinder',
      pos: [0.025, 0.012, 0.005],
      radius: 0.011,
      radiusTop: 0.009,
      height: 0.072,
      segments: 10,
      rot: [0, 0, -0.18],        // slight inward fan
      mat: 'bone',
    },
    {
      name: 'mc_middle',
      kind: 'cylinder',
      pos: [0.008, 0.014, 0.005],
      radius: 0.012,
      radiusTop: 0.010,
      height: 0.078,
      segments: 10,
      rot: [0, 0, -0.06],
      mat: 'bone',
    },
    {
      name: 'mc_ring',
      kind: 'cylinder',
      pos: [-0.008, 0.013, 0.005],
      radius: 0.011,
      radiusTop: 0.009,
      height: 0.074,
      segments: 10,
      rot: [0, 0, 0.06],
      mat: 'bone',
    },
    {
      name: 'mc_pinky',
      kind: 'cylinder',
      pos: [-0.023, 0.009, 0.005],
      radius: 0.010,
      radiusTop: 0.008,
      height: 0.064,
      segments: 10,
      rot: [0, 0, 0.18],
      mat: 'bone',
    },

    // ── KNUCKLES ─ small bone bumps at every metacarpal-phalanx
    // joint. Hide the seam where the phalanx capsule meets the
    // metacarpal cylinder.
    { kind: 'sphere', pos: [ 0.025, 0.048, 0.012], radius: 0.012, segments: [10, 8], mat: 'bone' },
    { kind: 'sphere', pos: [ 0.008, 0.054, 0.012], radius: 0.013, segments: [10, 8], mat: 'bone' },
    { kind: 'sphere', pos: [-0.008, 0.050, 0.012], radius: 0.012, segments: [10, 8], mat: 'bone' },
    { kind: 'sphere', pos: [-0.023, 0.041, 0.012], radius: 0.011, segments: [10, 8], mat: 'bone' },
    // Thumb knuckle — at the actual end of the thumb metacarpal (with
    // its Z-tilt = +0.65 rad on the mirrored model, top lands at this XY).
    { kind: 'sphere', pos: [-0.048, 0.006, 0.012], radius: 0.012, segments: [10, 8], mat: 'bone' },

    // ── PHALANGES ─ each finger's bone parented to its joint slot.
    // Authored in slot-local space as a capsule extending +Y. The
    // slot's pre-rotated curl wraps the capsule forward toward the
    // palm side. Fingers are slightly LONGER than v3 (height +25%)
    // so the wrap visibly closes past the grip cylinder.
    { parent: 'finger_index',  kind: 'capsule', pos: [0, 0.020, 0], radius: 0.0095, height: 0.034, mat: 'bone' },
    { parent: 'finger_middle', kind: 'capsule', pos: [0, 0.023, 0], radius: 0.0102, height: 0.038, mat: 'bone' },
    { parent: 'finger_ring',   kind: 'capsule', pos: [0, 0.020, 0], radius: 0.0095, height: 0.034, mat: 'bone' },
    { parent: 'finger_pinky',  kind: 'capsule', pos: [0, 0.016, 0], radius: 0.0085, height: 0.028, mat: 'bone' },
    { parent: 'finger_thumb',  kind: 'capsule', pos: [0, 0.022, 0], radius: 0.0110, height: 0.038, mat: 'bone' },

    // ── FINGERTIPS ─ sphere caps that follow the phalanx + curl.
    { parent: 'finger_index',  kind: 'sphere', pos: [0, 0.040, 0], radius: 0.0095, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_middle', kind: 'sphere', pos: [0, 0.045, 0], radius: 0.0102, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_ring',   kind: 'sphere', pos: [0, 0.040, 0], radius: 0.0095, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_pinky',  kind: 'sphere', pos: [0, 0.033, 0], radius: 0.0085, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_thumb',  kind: 'sphere', pos: [0, 0.044, 0], radius: 0.0110, segments: [8, 6], mat: 'bone' },
  ],
  slots: {
    // The grip anchor a held weapon aligns to. Sits IN the palm cup —
    // below the knuckle row + on the PALM side (−Z) of hand-origin,
    // so a held grip rests in the fingers' cradle rather than
    // floating above the back of the hand.
    palm_anchor: { pos: [0, 0.012, -0.006] },

    // ── FINGER JOINTS ─ one per finger at the metacarpal-phalanx
    // pivot. Pre-rotated to a CURLED rest pose at ≈80° (rotX ≈ -1.4).
    // Tighter than v3's -1.05 rad so the fingertips visibly wrap to
    // the palm-side of where a grip would sit.
    //
    // The Z-rotation gives each finger an individual lean (asymmetric
    // by design — a stamped row of identical fingers reads as a comb,
    // not a hand). Z-rotations are mirrored to match the +X = pinky
    // convention.
    finger_index:  { pos: [ 0.025, 0.048, 0.012], rot: [-1.95, 0, -0.12] },
    finger_middle: { pos: [ 0.008, 0.054, 0.012], rot: [-2.05, 0, -0.04] },
    finger_ring:   { pos: [-0.008, 0.050, 0.012], rot: [-2.00, 0,  0.04] },
    finger_pinky:  { pos: [-0.023, 0.041, 0.012], rot: [-1.85, 0,  0.14] },
    // Thumb wraps from the SIDE (across the front of the closed
    // fingers). Same XYZ Euler order; rotation puts the phalanx
    // perpendicular to the metacarpal, wrapping over the top of the
    // grip area.
    finger_thumb:  { pos: [-0.048, 0.006, 0.012], rot: [-1.10, 0, -1.20] },
  },
};
