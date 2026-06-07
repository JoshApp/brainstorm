import type { ModelSpec } from '../ecs/model-types';

// Skeleton key — a gilded key whose BOW (the grip end you hold) is a
// skull with glowing eye sockets. Borderlands "gold key" energy, dragged
// into DELVE's grimdark register: the gold is antique and tarnished, and
// the only thing that's bright is the pair of embers burning in the eye
// sockets — so per the "Lighting as signal" rule, the glow reads as "this
// key MEANS something" rather than decoration.
//
// Authored along the codebase convention: shaft runs along +Y/-Y, skull
// bow at the TOP (+Y), bit/teeth at the BOTTOM (-Y), the skull's face
// (eye sockets) toward -Z so it reads from the bench FRONT view. All
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
    // Pitch-dark eye socket wells — recessed so the embers read as DEEP.
    socket: {
      color: 0x000000,
      roughness: 1.0,
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
    // Cranium — a slightly squashed sphere. Front bulges toward -Z.
    { name: 'cranium', kind: 'sphere', pos: [0, 0.10, 0], radius: 0.052, scale: [1.0, 0.92, 1.08], segments: [16, 14], mat: 'goldPale', jitter: 0.004 },
    // Brow ridge — a thin box over the sockets to cast a shadow line.
    { name: 'brow', kind: 'box', pos: [0, 0.108, -0.040], size: [0.072, 0.012, 0.014], mat: 'goldPale' },
    // Eye sockets — dark recessed wells set into the -Z face.
    { name: 'socket_l', kind: 'sphere', pos: [-0.024, 0.096, -0.040], radius: 0.018, mat: 'socket' },
    { name: 'socket_r', kind: 'sphere', pos: [ 0.024, 0.096, -0.040], radius: 0.018, mat: 'socket' },
    // Embers — glowing spheres set DEEP inside each socket (further -Z).
    { name: 'ember_l', kind: 'sphere', pos: [-0.024, 0.096, -0.047], radius: 0.0105, segments: [10, 8], mat: 'ember' },
    { name: 'ember_r', kind: 'sphere', pos: [ 0.024, 0.096, -0.047], radius: 0.0105, segments: [10, 8], mat: 'ember' },
    // Nasal cavity — small dark wedge below and between the sockets.
    { name: 'nasal', kind: 'box', pos: [0, 0.074, -0.046], size: [0.012, 0.020, 0.014], mat: 'socket' },
    // Jaw / maxilla — a narrower block under the cranium so the skull
    // tapers to a chin instead of ending in a clean sphere.
    { name: 'jaw', kind: 'box', pos: [0, 0.058, -0.020], size: [0.060, 0.026, 0.058], bevel: 0.008, mat: 'goldPale' },
    // Cheek struts — two short bars framing the jaw.
    { name: 'cheek_l', kind: 'box', pos: [-0.034, 0.070, -0.026], size: [0.012, 0.030, 0.030], mat: 'goldPale' },
    { name: 'cheek_r', kind: 'box', pos: [ 0.034, 0.070, -0.026], size: [0.012, 0.030, 0.030], mat: 'goldPale' },

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
    grip_anchor: { pos: [0, 0.10, 0] },
    // bit_tip — the business end, for lock-insertion / "turn" effects.
    bit_tip: { pos: [0.038, -0.197, 0] },
    // eye_glow — the lit focal point, for attaching a light or glow effect
    // if the key is ever placed as a world interactable.
    eye_glow: { pos: [0, 0.096, -0.047] },
  },
};
