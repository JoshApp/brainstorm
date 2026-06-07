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
    // Cranium — a single CSG solid: an elongated skull dome with the two
    // eye sockets and the nasal aperture CARVED OUT with boolean subtracts
    // (concave wells, not faked dark spheres). Kept to three nested subtracts
    // (the documented safe CSG depth) and the mental model stays trivial: the
    // dome is the only solid, every `b` operand is a void scooped from it.
    //
    // Local skull space (the CSG node sits at world [0,0.104,0], face → +Z
    // so the skull greets the default bench/inspect camera):
    //   dome center = local origin; sockets carved on the front-upper face;
    //   nasal carved below + between them.
    {
      name: 'cranium', kind: 'csg', op: 'subtract', pos: [0, 0.104, 0], mat: 'goldPale',
      // 3rd subtract: carve the nasal aperture out of (dome - both sockets).
      a: {
        kind: 'csg', op: 'subtract', mat: 'goldPale',
        // 2nd subtract: carve the RIGHT socket out of (dome - left socket).
        a: {
          kind: 'csg', op: 'subtract', mat: 'goldPale',
          // 1st subtract: carve the LEFT socket out of the bare dome.
          a: { kind: 'sphere', radius: 0.052, scale: [0.96, 1.14, 1.08], segments: [24, 20], mat: 'goldPale' },
          b: { kind: 'sphere', pos: [-0.026, 0.006, 0.044], radius: 0.020, segments: [18, 14], mat: 'goldPale' },
        },
        b: { kind: 'sphere', pos: [0.026, 0.006, 0.044], radius: 0.020, segments: [18, 14], mat: 'goldPale' },
      },
      // Nasal aperture — a tilted box scooped below/between the sockets.
      b: { kind: 'box', pos: [0, -0.020, 0.046], rot: [-0.28, 0, 0], size: [0.013, 0.028, 0.030], mat: 'goldPale' },
    },
    // Brow ridge — a thin bar over the carved sockets, casts a shadow line.
    { name: 'brow', kind: 'box', pos: [0, 0.120, 0.046], size: [0.066, 0.011, 0.013], bevel: 0.004, mat: 'goldPale' },
    // Embers — glowing spheres burning DEEP inside each carved socket. The
    // concave well rim now shades them naturally for real socket depth.
    { name: 'ember_l', kind: 'sphere', pos: [-0.026, 0.110, 0.050], radius: 0.0105, segments: [12, 10], mat: 'ember' },
    { name: 'ember_r', kind: 'sphere', pos: [ 0.026, 0.110, 0.050], radius: 0.0105, segments: [12, 10], mat: 'ember' },
    // Zygomatic cheekbones — two angled struts sweeping out below the eyes.
    { name: 'cheek_l', kind: 'box', pos: [-0.034, 0.082, 0.030], rot: [0, -0.3, 0.28], size: [0.013, 0.013, 0.034], bevel: 0.004, mat: 'goldPale' },
    { name: 'cheek_r', kind: 'box', pos: [ 0.034, 0.082, 0.030], rot: [0, 0.3, -0.28], size: [0.013, 0.013, 0.034], bevel: 0.004, mat: 'goldPale' },
    // Maxilla — the upper-jaw bar the front teeth hang from.
    { name: 'maxilla', kind: 'box', pos: [0, 0.050, 0.024], size: [0.046, 0.014, 0.030], bevel: 0.004, mat: 'goldPale' },
    // Upper teeth — the grin. A row of six small bright-gold blocks so the
    // teeth pop against the paler cranium (contrast, not one gold blob).
    { name: 'tooth_u0', kind: 'box', pos: [-0.0205, 0.039, 0.034], size: [0.006, 0.014, 0.008], mat: 'gold' },
    { name: 'tooth_u1', kind: 'box', pos: [-0.0123, 0.039, 0.035], size: [0.006, 0.014, 0.008], mat: 'gold' },
    { name: 'tooth_u2', kind: 'box', pos: [-0.0041, 0.039, 0.0355], size: [0.006, 0.014, 0.008], mat: 'gold' },
    { name: 'tooth_u3', kind: 'box', pos: [ 0.0041, 0.039, 0.0355], size: [0.006, 0.014, 0.008], mat: 'gold' },
    { name: 'tooth_u4', kind: 'box', pos: [ 0.0123, 0.039, 0.035], size: [0.006, 0.014, 0.008], mat: 'gold' },
    { name: 'tooth_u5', kind: 'box', pos: [ 0.0205, 0.039, 0.034], size: [0.006, 0.014, 0.008], mat: 'gold' },
    // Mandible — the lower jaw, hung slightly open under the grin.
    { name: 'mandible', kind: 'box', pos: [0, 0.026, 0.018], size: [0.048, 0.011, 0.034], bevel: 0.005, mat: 'goldPale' },
    // Jaw rami — vertical struts joining the mandible back to the cranium.
    { name: 'ramus_l', kind: 'box', pos: [-0.026, 0.040, 0.008], size: [0.009, 0.030, 0.018], mat: 'goldPale' },
    { name: 'ramus_r', kind: 'box', pos: [ 0.026, 0.040, 0.008], size: [0.009, 0.030, 0.018], mat: 'goldPale' },

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
    grip_anchor: { pos: [0, 0.104, 0] },
    // bit_tip — the business end, for lock-insertion / "turn" effects.
    bit_tip: { pos: [0.038, -0.197, 0] },
    // eye_glow — the lit focal point, for attaching a light or glow effect
    // if the key is ever placed as a world interactable.
    eye_glow: { pos: [0, 0.110, 0.050] },
  },
};
