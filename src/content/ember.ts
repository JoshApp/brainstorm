import type { ModelSpec } from '../ecs/model-types';

// THE GUTTERING EMBER — borrowed life, lying on the floor.
//
// The soul heart, in DELVE's register. Isaac's is a blue valentine; ours cannot
// be, because nothing here is cute and nothing here is given. So the object is a
// COAL: a knot of charred bone, split open, with something still alive burning
// in the fissure. It is somebody's last warmth. It will burn for you a while.
//
// The read, in order of what the player actually sees:
//   1. A small dark lump on a dark floor — invisible except for
//   2. the LINE OF FIRE down its middle, which is the whole silhouette, and
//   3. a wisp coming off the top, so it reads as alive rather than as debris.
//
// Lighting is the model here (docs/VISUAL-LANGUAGE.md): the shell is nearly
// black and almost entirely swallowed, the crack is the only bright thing, and
// the attached light is small and short-range so an ember on the floor is a
// point of warmth you walk toward, not a lamp that lights the room.

const CHAR = 0x1a1512;      // burnt-through — barely separable from the floor
const CINDER = 0x2f2620;    // the second material: cooler ash, so the lump has form
const HOT = 0xff5a14;       // the living core
const WISP = 0xffab5a;      // what comes off it

export const GUTTERING_EMBER: ModelSpec = {
  id: 'guttering-ember',
  materials: {
    char:   { color: CHAR, roughness: 1.0, flatShading: 'auto' },
    cinder: { color: CINDER, roughness: 0.95, flatShading: 'auto' },
    // The core is emissive-only: its own base colour is black, so it reads as
    // light coming OUT of the shell rather than as a painted orange ball.
    core:   { color: 0x000000, emissive: HOT, emissiveIntensity: 3.4, roughness: 1.0, fog: false },
    ash:    { color: 0x141110, roughness: 1.0, flatShading: 'auto' },
  },
  parts: [
    // ── THE SHELL — one CSG level, no deeper (the literature's limit) ──────
    // A lumpy sphere with a wedge taken out of its face. The wedge is what the
    // fire shows through, so it is cut on −Z: the model's front, the side the
    // player meets it from.
    {
      name: 'shell', kind: 'csg', op: 'subtract', pos: [0, 0.058, 0], mat: 'char',
      a: {
        kind: 'sphere', radius: 0.058, scale: [1.15, 0.86, 1.0],
        segments: [14, 10], jitter: 0.006, mat: 'char',
      },
      // The split: a thin slab standing on edge, tilted, driven through the
      // front of the lump. Thin enough that the shell stays a lump with a crack
      // in it, not two halves lying beside each other.
      b: {
        kind: 'box', pos: [0, 0.012, -0.026], rot: [0, 0, 0.42],
        size: [0.026, 0.150, 0.078], mat: 'char',
      },
    },
    // A second, smaller mass fused to the back — breaks the sphere silhouette so
    // it reads as a broken piece of something rather than as a ball.
    {
      name: 'knuckle', kind: 'sphere', pos: [0.030, 0.036, 0.030],
      radius: 0.032, scale: [1.0, 0.8, 1.0], segments: [12, 8], jitter: 0.005, mat: 'cinder',
    },

    // ── THE FIRE IN THE CRACK ─────────────────────────────────────────────
    // Sits INSIDE the wedge the shell subtracted, so the shell's own lips
    // occlude it from the sides: the glow is a slot of light, widest head-on.
    {
      name: 'core', kind: 'box', pos: [0, 0.056, -0.012], rot: [0, 0, 0.42],
      size: [0.012, 0.086, 0.016], mat: 'core',
    },
    // A hotter bead at the bottom of the crack — the fire has a SOURCE, and the
    // gradient from it upward is what makes the slot look deep.
    {
      name: 'coal', kind: 'sphere', pos: [-0.005, 0.034, -0.010],
      radius: 0.014, segments: [10, 8], mat: 'core',
    },

    // ── WHAT COMES OFF IT ─────────────────────────────────────────────────
    // Two small wisps, offset and out of phase, so the ember breathes. Additive
    // sprites: no shadow cost, and they bloom.
    {
      name: 'wisp', kind: 'sprite', pos: [0, 0.106, -0.014], size: [0.070, 0.100],
      texture: 'fire-wisp', blending: 'additive', color: WISP,
      flicker: { scale: 0.30, bob: 0.022, speed: 2.2 },
    },
    {
      kind: 'sprite', pos: [0.013, 0.088, -0.006], size: [0.046, 0.062],
      texture: 'fire-wisp', blending: 'additive', color: HOT,
      flicker: { scale: 0.38, bob: 0.016, speed: 3.1 },
    },

    // ── ASH ───────────────────────────────────────────────────────────────
    // Three flecks at the base. They ground the lump — without them it floats,
    // because a perfectly clean contact edge reads as hovering.
    { name: 'ash_a', kind: 'box', pos: [-0.060, 0.006, 0.018], size: [0.030, 0.010, 0.024], rot: [0, 0.5, 0], mat: 'ash' },
    { name: 'ash_b', kind: 'box', pos: [0.055, 0.005, -0.030], size: [0.024, 0.008, 0.020], rot: [0, -0.7, 0], mat: 'ash' },
    { name: 'ash_c', kind: 'box', pos: [0.008, 0.004, 0.056], size: [0.020, 0.007, 0.018], rot: [0, 0.2, 0], mat: 'ash' },
  ],
  slots: {
    /** Where the fire comes OUT — the crack's mouth. Its local +Y is the
     *  direction the wisp rises, so an effect layer can spawn motes along it
     *  without measuring the geometry. */
    ember_emerge: { pos: [0, 0.098, -0.014] },
  },
  // Small and short — a coal, not a torch. Bright enough to find in the dark,
  // dim enough that it never competes with the player's own lamp.
  light: {
    color: HOT,
    intensity: 5.0,
    distance: 2.6,
    decay: 2.0,
  },
};
