import type { ModelSpec } from '../ecs/model-types';

// First-person right hand — a gauntleted closed fist designed to read
// as ORGANIC at a glance, not as a mechanical assembly. Two jobs:
//
//   1. HOLD WEAPONS. Every weapon's grip_anchor slot aligns to the
//      hand's palm_anchor at mount time (see viewmodel.ts), so the
//      blade or haft emerges from the top of the closed fist and
//      tilts with the hand. Same hand for every weapon.
//
//   2. BE THE FIST when the player is unarmed. No weapon → the hand
//      mounts alone. The fist silhouette + a punch pose reads as a
//      thrown jab.
//
// V2 design notes (why this looks like a hand and the v1 didn't):
//   - ONE unified fist mass — a capsule oriented vertically, with a
//     single thumb wrap and a single knuckle ridge. v1 had four
//     separate finger boxes + four sphere knuckles + a two-segment
//     thumb cylinder; the repetition + hard edges read as robotic.
//   - LARGER overall — bracer + fist together fill ≈ 25% of the
//     bottom-right of view at the rest pose, so the player can
//     actually READ it as their hand rather than a small blob.
//   - VISIBLE BRACER. Most of what the player sees is the armoured
//     forearm + a brass trim ring; the fist is the small organic
//     cap on top of it. Reads as Souls-style — "this delver wears
//     real gear" — without per-armour swapping.
//
// Coordinate convention (camera-local, applied by the viewmodel group):
//   - origin = centre of the closed fist (a held weapon's grip_anchor
//     lines up here)
//   - +Y    = up out of the top of the fist (where blades emerge)
//   - -Y    = down into the wrist + forearm (vanishes off-screen)
//   - +Z    = back toward the camera (knuckles face -Z toward the
//     scene the player is swinging at)
//   - +X    = the thumb side of the hand (right hand)
//
// All materials use fog:false — the hand is right in front of the
// camera, never inside fog distance, and shouldn't fade.

export const HAND_RIGHT: ModelSpec = {
  id: 'hand-right',
  materials: {
    bracer: {
      color: 0x2a1d12,        // dark oiled leather bracer
      roughness: 0.80,
      metalness: 0.20,
      fog: false,
      flatShading: 'auto',
    },
    bracerTrim: {
      color: 0x7a5a30,        // tarnished brass band
      roughness: 0.55,
      metalness: 0.75,
      fog: false,
      flatShading: 'auto',
    },
    glove: {
      color: 0x4a3220,        // slightly lighter glove leather so the
                              // wrist → fist transition reads
      roughness: 0.88,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // ── Forearm — wide cylinder vanishing off the bottom of view.
    // Slight taper toward the wrist gives the silhouette a forearm
    // shape (not a tube). Wide radius so it carries weight in the
    // composition rather than looking like a thin handle.
    {
      name: 'forearm',
      kind: 'cylinder',
      pos: [0, -0.30, 0.005],
      radius: 0.075,        // base (lower / off-screen end)
      radiusTop: 0.060,     // wrist
      height: 0.42,
      segments: 16,
      mat: 'bracer',
    },

    // ── Bracer trim — a wide brass band at the wrist + a narrower one
    // halfway down the forearm. Two rings give the bracer "structure"
    // instead of being a featureless tube.
    {
      kind: 'torus',
      pos: [0, -0.105, 0.005],
      radius: 0.062, tube: 0.014,
      segments: [6, 18],
      rot: [Math.PI / 2, 0, 0],
      mat: 'bracerTrim',
    },
    {
      kind: 'torus',
      pos: [0, -0.32, 0.005],
      radius: 0.072, tube: 0.012,
      segments: [6, 18],
      rot: [Math.PI / 2, 0, 0],
      mat: 'bracerTrim',
    },

    // ── Closed-fist body — ONE capsule. The whole job of looking like
    // a fist comes from this single shape (no per-finger detail). At
    // the rest tilt the upper end becomes the knuckle row, the lower
    // end blends into the wrist.
    {
      name: 'fist',
      kind: 'capsule',
      pos: [0, 0.005, 0.005],
      radius: 0.058,
      height: 0.040,        // cylindrical core; total length ≈ 2r + h
      mat: 'glove',
    },

    // ── Knuckle ridge — a single low torus across the top of the fist
    // gives a "bumpy" silhouette without spelling out four discrete
    // knuckles (which is what made v1 look like a claw). Oriented so
    // the ring sits across the +Y face of the fist.
    {
      kind: 'torus',
      pos: [0, 0.058, 0.018],
      radius: 0.038, tube: 0.010,
      segments: [4, 18],
      rot: [Math.PI / 2, 0, 0],
      mat: 'glove',
    },

    // ── Thumb — a single curved cylinder wrapped from the right side
    // of the fist over the top, where it would meet a held grip. Tilt
    // is the "thumb pad pressed against the side of the grip" pose.
    {
      kind: 'cylinder',
      pos: [0.052, 0.012, 0.012],
      radius: 0.018,
      height: 0.095,
      segments: 12,
      rot: [0.05, 0, -1.05],   // angled across the top of the fist
      mat: 'glove',
    },
    // Thumb tip — a small sphere capping the curl, so the silhouette
    // doesn't end on a flat cylinder lid.
    {
      kind: 'sphere',
      pos: [0.005, 0.060, 0.012],
      radius: 0.018,
      segments: [10, 8],
      mat: 'glove',
    },
  ],
  slots: {
    // The grip anchor a held weapon aligns to. Sits at the top of the
    // fist where the thumb meets the knuckle ridge — that's where the
    // weapon's own grip_anchor offset lines up, so a sword's blade
    // emerges from the top edge of the closed fist (the hilt invisible
    // inside).
    palm_anchor: { pos: [0, 0.040, 0.008] },
  },
};
