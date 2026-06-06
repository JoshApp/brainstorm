import type { ModelSpec } from '../ecs/model-types';

// First-person right hand — a STYLIZED SKELETAL bone hand. Replaces
// the gauntlet/glove v1+v2 with something that fits the grimdark
// register directly: the delver is reaching with the bones in their
// hand, not with anonymous brown leather.
//
// Two jobs (same as before):
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
// (rotX ≈ -1.05 rad ≈ 60° forward-down), so the bones already wrap
// around where a weapon grip sits without any runtime animation. To
// uncurl for a punch / open hand / splayed gesture, set rotX → 0 (or
// any positive value to overshoot into an extension).
//
// Coordinate convention (Y-up, −Z forward — per CLAUDE.md):
//   - origin = centre of the closed fist (= where a weapon's
//     grip_anchor lines up)
//   - +Y    = up, out of the top of the fist (blades emerge here)
//   - −Y    = down the forearm, vanishing off the bottom of view
//   - +Z    = back of the hand (faces the camera)
//   - −Z    = palm side (faces the scene the player swings at)
//   - +X    = thumb side
//   - −X    = pinky side
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
    // ── FOREARM ─ radius + ulna, the two parallel bones a real
    // skeletal forearm has. Tapered so they fan slightly at the wrist
    // end; offset so the gap between them is visible (anatomical
    // signature: "this is a skeleton, not a tube").
    {
      name: 'radius',          // thumb-side bone
      kind: 'cylinder',
      pos: [0.013, -0.27, 0.005],
      radius: 0.018,
      radiusTop: 0.014,
      height: 0.36,
      segments: 12,
      mat: 'bone',
    },
    {
      name: 'ulna',            // pinky-side bone, slightly thinner
      kind: 'cylinder',
      pos: [-0.013, -0.27, 0.005],
      radius: 0.017,
      radiusTop: 0.013,
      height: 0.36,
      segments: 12,
      mat: 'bone',
    },
    // Sinew / shadow gap between the bones — a small dark cylinder
    // that reads as the empty space between radius and ulna.
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
    // the knuckle row. The thumb's is offset and tilted outward (real
    // anatomy); the other four sit roughly parallel.
    {
      name: 'mc_thumb',
      kind: 'cylinder',
      pos: [0.030, -0.018, 0.012],
      radius: 0.013,
      radiusTop: 0.011,
      height: 0.060,
      segments: 10,
      rot: [0, 0, -0.65],       // tilt outward toward +X (thumb side)
      mat: 'bone',
    },
    {
      name: 'mc_index',
      kind: 'cylinder',
      pos: [-0.025, 0.012, 0.005],
      radius: 0.011,
      radiusTop: 0.009,
      height: 0.072,
      segments: 10,
      rot: [0, 0, 0.18],        // slight inward fan
      mat: 'bone',
    },
    {
      name: 'mc_middle',
      kind: 'cylinder',
      pos: [-0.008, 0.014, 0.005],
      radius: 0.012,
      radiusTop: 0.010,
      height: 0.078,
      segments: 10,
      rot: [0, 0, 0.06],
      mat: 'bone',
    },
    {
      name: 'mc_ring',
      kind: 'cylinder',
      pos: [0.008, 0.013, 0.005],
      radius: 0.011,
      radiusTop: 0.009,
      height: 0.074,
      segments: 10,
      rot: [0, 0, -0.06],
      mat: 'bone',
    },
    {
      name: 'mc_pinky',
      kind: 'cylinder',
      pos: [0.023, 0.009, 0.005],
      radius: 0.010,
      radiusTop: 0.008,
      height: 0.064,
      segments: 10,
      rot: [0, 0, -0.18],
      mat: 'bone',
    },

    // ── KNUCKLES ─ small bone bumps at every metacarpal-phalanx
    // joint. Read as the visible joint nub on a skeletal hand AND
    // they hide the seam where the phalanx capsule meets the
    // metacarpal cylinder (otherwise the seam shows when the finger
    // is curled).
    { kind: 'sphere', pos: [-0.025, 0.048, 0.012], radius: 0.012, segments: [10, 8], mat: 'bone' },
    { kind: 'sphere', pos: [-0.008, 0.054, 0.012], radius: 0.013, segments: [10, 8], mat: 'bone' },
    { kind: 'sphere', pos: [ 0.008, 0.050, 0.012], radius: 0.012, segments: [10, 8], mat: 'bone' },
    { kind: 'sphere', pos: [ 0.023, 0.041, 0.012], radius: 0.011, segments: [10, 8], mat: 'bone' },
    // Thumb knuckle — at the ACTUAL end of the thumb metacarpal
    // cylinder (its Z-tilt of -0.65 rad lands the top at this XY,
    // not at the originally-authored back-of-hand position). Putting
    // the knuckle + the finger_thumb slot here eliminates the visible
    // gap between the thumb metacarpal and its phalanx.
    { kind: 'sphere', pos: [ 0.048, 0.006, 0.012], radius: 0.012, segments: [10, 8], mat: 'bone' },

    // ── PHALANGES ─ each finger's bone parented to its joint slot.
    // Authored in slot-local space as a capsule extending +Y. The
    // slot's pre-rotated curl (rot[0] negative) wraps the capsule
    // forward + slightly down, around where a grip would sit.
    //
    // For animation: setting `slot.rotation.x = 0` straightens the
    // finger; lower (more negative) values curl it tighter into a
    // fist. The viewmodel.ts holding-pose code can read these slots
    // off `built.slots` and lerp the curl per weapon.
    { parent: 'finger_index',  kind: 'capsule', pos: [0, 0.020, 0], radius: 0.0095, height: 0.025, mat: 'bone' },
    { parent: 'finger_middle', kind: 'capsule', pos: [0, 0.023, 0], radius: 0.0102, height: 0.028, mat: 'bone' },
    { parent: 'finger_ring',   kind: 'capsule', pos: [0, 0.020, 0], radius: 0.0095, height: 0.025, mat: 'bone' },
    { parent: 'finger_pinky',  kind: 'capsule', pos: [0, 0.016, 0], radius: 0.0085, height: 0.021, mat: 'bone' },
    { parent: 'finger_thumb',  kind: 'capsule', pos: [0, 0.022, 0], radius: 0.0110, height: 0.030, mat: 'bone' },

    // ── FINGERTIPS ─ a small sphere capping each phalanx, also
    // parented to the joint so it follows the curl. Small enough to
    // read as bone tip, not a separate phalanx.
    { parent: 'finger_index',  kind: 'sphere', pos: [0, 0.034, 0], radius: 0.0095, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_middle', kind: 'sphere', pos: [0, 0.039, 0], radius: 0.0102, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_ring',   kind: 'sphere', pos: [0, 0.034, 0], radius: 0.0095, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_pinky',  kind: 'sphere', pos: [0, 0.028, 0], radius: 0.0085, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_thumb',  kind: 'sphere', pos: [0, 0.038, 0], radius: 0.0110, segments: [8, 6], mat: 'bone' },
  ],
  slots: {
    // The grip anchor a held weapon aligns to. Sits in the middle of
    // the closed fist where the phalanges curl past each other.
    palm_anchor: { pos: [0, 0.025, 0.005] },

    // ── FINGER JOINTS ─ one per finger at the metacarpal-phalanx
    // pivot. Pre-rotated to a CURLED rest pose; runtime can lerp
    // rotation.x toward 0 to open the hand for a splayed pose or a
    // punch's pre-strike. The slight rotation.z spread gives each
    // finger an individual lean so they don't read as a stamped row.
    finger_index:  { pos: [-0.025, 0.048, 0.012], rot: [-1.05, 0, 0.10] },
    finger_middle: { pos: [-0.008, 0.054, 0.012], rot: [-1.15, 0, 0.04] },
    finger_ring:   { pos: [ 0.008, 0.050, 0.012], rot: [-1.10, 0, -0.04] },
    finger_pinky:  { pos: [ 0.023, 0.041, 0.012], rot: [-0.95, 0, -0.12] },
    // Thumb wraps from the SIDE, not the top. Joint sits at the
    // actual end of the thumb metacarpal (same point as its knuckle
    // sphere above). Pre-rotation curls the phalanx forward-down +
    // inward across the closed fingers — the natural "thumb wrapped
    // over a grip" pose.
    finger_thumb:  { pos: [ 0.048, 0.006, 0.012], rot: [-0.70, 0, 1.00] },
  },
};
