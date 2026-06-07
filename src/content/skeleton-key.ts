import type { ModelSpec } from '../ecs/model-types';

// Skeleton key — a gilded key whose BOW (the grip end you hold) is a
// skull with glowing eye sockets. Borderlands "gold key" energy, dragged
// into DELVE's grimdark register: the gold is antique and tarnished, and
// the only thing that's bright is the pair of embers burning in the eye
// sockets — so per the "Lighting as signal" rule, the glow reads as "this
// key MEANS something" rather than decoration.
//
// Authored along the codebase convention: shaft runs along +Y/-Y, a small
// STYLIZED skull bow at the TOP (+Y), bit/teeth at the BOTTOM (-Y), the
// skull's face toward +Z so it greets the default inspect camera. All
// materials fog:false — this is an inspected/held item, always lit.
//
// Delivered as a STANDALONE model (bench subject `model-skeleton-key`),
// NOT wired into a key mechanic — whether DELVE gains Doom/Isaac-style
// locked doors + keys is a design-layer decision (see chat). The art is
// ready the moment that call is made.

export const SKELETON_KEY: ModelSpec = {
  id: 'skeleton-key',
  materials: {
    // Richer gold for the shaft + bit — the working metal of the key.
    gold: {
      color: 0xb8902f,
      roughness: 0.3,
      metalness: 0.95,
      fog: false,
      flatShading: 'auto',
    },
    // Paler, bonier gilt for the skull bow — distinct from the shaft so the
    // silhouette doesn't collapse into one gold blob (failure mode #5).
    goldPale: {
      color: 0xcdb46a,
      roughness: 0.42,
      metalness: 0.85,
      fog: false,
      flatShading: 'auto',
    },
    // Dark tarnished gold for the collar ring between skull and shaft —
    // a shadow line that separates the two masses.
    goldDark: {
      color: 0x6e5320,
      roughness: 0.5,
      metalness: 0.9,
      fog: false,
      flatShading: 'auto',
    },
    // Dark accent for the stylized nose + mouth recess — reads as a hole.
    socket: {
      color: 0x05030a,
      roughness: 1.0,
      metalness: 0.0,
      fog: false,
    },
    // The signal: hot amber embers burning inside the sockets. Bright
    // emissive, harmonised with the gold + torchlight palette.
    ember: {
      color: 0x000000,
      emissive: 0xff7a1e,
      emissiveIntensity: 2.6,
      roughness: 1.0,
      fog: false,
    },
  },
  parts: [
    // --- SKULL BOW (the grip) -------------------------------------------
    // A SMALL STYLIZED skull — not anatomical. The icon read: a rounded
    // cranium, two BIG round eye sockets that glow, a triangle nose, and a
    // simple grin. Bold simple shapes at key scale beat fussy realism.
    //
    // Just ONE CSG: the cranium with its two big eye sockets subtracted
    // (two nested subtracts — well within the safe depth). The nose +
    // mouth are dark-accent shapes, not carves, to keep it clean. Skull
    // sits at world y≈0.10, face → +Z so it greets the default camera.
    {
      name: 'cranium', kind: 'csg', op: 'subtract', pos: [0, 0.100, 0], mat: 'goldPale',
      // 2nd subtract: carve the RIGHT eye out of (dome - left eye).
      a: {
        kind: 'csg', op: 'subtract', mat: 'goldPale',
        // Rounded cranium — a touch wider than tall, flattened front-to-back.
        a: { kind: 'sphere', radius: 0.040, scale: [1.08, 1.02, 0.92], segments: [24, 18], mat: 'goldPale' },
        // Big left eye socket.
        b: { kind: 'sphere', pos: [-0.019, 0.004, 0.030], radius: 0.0165, segments: [18, 14], mat: 'goldPale' },
      },
      // Big right eye socket.
      b: { kind: 'sphere', pos: [0.019, 0.004, 0.030], radius: 0.0165, segments: [18, 14], mat: 'goldPale' },
    },
    // Embers — fat glowing eyes filling the big sockets.
    { name: 'ember_l', kind: 'sphere', pos: [-0.019, 0.104, 0.034], radius: 0.0115, segments: [14, 12], mat: 'ember' },
    { name: 'ember_r', kind: 'sphere', pos: [ 0.019, 0.104, 0.034], radius: 0.0115, segments: [14, 12], mat: 'ember' },
    // Nose — a tiny dark inverted triangle between + below the eyes.
    { name: 'nose', kind: 'cone', pos: [0, 0.089, 0.036], rot: [Math.PI, 0, 0], radius: 0.006, height: 0.012, segments: 3, mat: 'socket' },
    // Jaw — a smaller rounded block under the cranium (the chin mass).
    { name: 'jaw', kind: 'box', pos: [0, 0.068, 0.008], size: [0.044, 0.024, 0.040], bevel: 0.010, mat: 'goldPale' },
    // Mouth — a dark recess slot across the jaw front; the grin's shadow.
    { name: 'mouth', kind: 'box', pos: [0, 0.072, 0.030], size: [0.030, 0.011, 0.008], mat: 'socket' },
    // Grin teeth — three little bright-gold blocks sitting in the dark mouth,
    // the gaps between them reading as the iconic skull grin.
    { name: 'tooth_l', kind: 'box', pos: [-0.010, 0.072, 0.033], size: [0.006, 0.012, 0.006], mat: 'gold' },
    { name: 'tooth_c', kind: 'box', pos: [ 0.000, 0.072, 0.033], size: [0.006, 0.012, 0.006], mat: 'gold' },
    { name: 'tooth_r', kind: 'box', pos: [ 0.010, 0.072, 0.033], size: [0.006, 0.012, 0.006], mat: 'gold' },

    // --- COLLAR ----------------------------------------------------------
    // Ring between the skull and the shaft — a shadow line + a place for
    // the metal to read as "joined." Hole axis rotated to lie flat (XZ).
    { name: 'collar', kind: 'torus', pos: [0, 0.030, 0], rot: [Math.PI / 2, 0, 0], radius: 0.020, tube: 0.008, segments: [16, 12], mat: 'goldDark' },

    // --- SHAFT -----------------------------------------------------------
    // The shank — long thin cylinder running down from the collar.
    { name: 'shaft', kind: 'cylinder', pos: [0, -0.070, 0], radius: 0.011, height: 0.18, segments: 12, mat: 'gold' },

    // --- BIT / TEETH -----------------------------------------------------
    // Classic skeleton-key bit: a flat flag projecting from ONE side (+X)
    // of the shank's lower end, with two teeth hanging off its bottom edge
    // and a gap between them — the "cut" that turns the ward.
    { name: 'bit_flag', kind: 'box', pos: [0.030, -0.150, 0], size: [0.052, 0.046, 0.010], bevel: 0.004, mat: 'gold' },
    { name: 'tooth_a', kind: 'box', pos: [0.026, -0.184, 0], size: [0.012, 0.026, 0.010], mat: 'gold' },
    { name: 'tooth_b', kind: 'box', pos: [0.050, -0.184, 0], size: [0.012, 0.026, 0.010], mat: 'gold' },
  ],
  slots: {
    // grip_anchor — where a hand grasps the key (on the skull bow, per the
    // brief: "the key's grip" IS the skeleton head).
    grip_anchor: { pos: [0, 0.100, 0] },
    // bit_tip — the business end, for lock-insertion / "turn" effects.
    bit_tip: { pos: [0.038, -0.197, 0] },
    // eye_glow — the lit focal point, for attaching a light or glow effect
    // if the key is ever placed as a world interactable.
    eye_glow: { pos: [0, 0.104, 0.034] },
  },
};
