import type { ModelSpec } from '../ecs/model-types';
import { CONFIG } from '../config';

// Wall torch: a CANDLE IN A SCONCE. Designed to feel like the floor candles
// the player already likes — a small wax pillar with a clean flame on top,
// held by a small iron sconce against the wall. Simpler and more legible
// than the previous "flame ball on bracket" design.
//
// Local origin = flame center = where the PointLight sits. Wax candle hangs
// below the flame; sconce bowl + arm hang below the candle and extend back
// toward the wall (-Z in local space).
//
// The flicker animation in scene/torchlight.ts looks up the 'flame' part +
// material and the 'wisp' sprite by name and mutates them per frame.

export const WALL_TORCH: ModelSpec = {
  id: 'wall-torch',
  // ── THE STANDOFF IS THE ARM'S REACH, AND IT WAS BARELY HALF OF IT ──────────
  //
  // The arm runs z = -0.02 to -0.38 in local space. The placer marks the wall's
  // SURFACE, so for the bracket to end AT the masonry the origin has to stand
  // 0.38 out from it — less the small bite a bolted bracket takes into the
  // stone, which is the 0.04.
  //
  // It was 0.20. That put the arm's far end 0.18m behind the wall surface, in a
  // wall 0.25m thick — the bracket ran nearly all the way through, and the flame
  // (which is the model's ORIGIN, and therefore where the light is registered)
  // sat 0.14m nearer the stone than the fixture is drawn. Josh, on a screenshot:
  // *"i think torch lightsources are partially wrong compared to the model and
  // almost stuck inside the walls."* Both halves of that are this number.
  //
  // Moving it out also gives the light back the room it needs: at 0.20 a point
  // light two handspans off the masonry blows out the wall behind it and reaches
  // very little floor, which is the other complaint this quietly fixes.
  mount: { to: 'wall', standoff: 0.34 },
  materials: {
    iron: {
      color: 0x14110d,
      roughness: 0.85,
      metalness: 0.55,
      flatShading: 'auto',
    },
    wax: {
      color: 0x4a3a2e,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: 'auto',
    },
    wick: {
      color: 0x1a0f08,
      roughness: 1.0,
      metalness: 0.0,
    },
    flame: {
      color: 0xffd58a,
      emissive: 0xff8844,
      emissiveIntensity: 2.8,
      roughness: 0.4,
    },
  },
  parts: [
    // Sconce arm — long thin box reaching from the wall to the sconce bowl.
    // -Z is the wall direction in local space. Centered at z=-0.20 with
    // length 0.36, so it reaches from z=-0.02 (just behind the bowl) to
    // z=-0.38 (well into the wall when the torch is placed within ~0.2m
    // of the wall surface — see level placements).
    { kind: 'box',  pos: [0, -0.24, -0.20], size: [0.045, 0.035, 0.36], mat: 'iron' },
    // Sconce bowl — short flared cylinder holding the wax. Wider at top.
    { kind: 'cylinder', pos: [0, -0.21, 0], radius: 0.05, radiusTop: 0.065, height: 0.05, segments: 10, mat: 'iron' },
    // Wax candle — short fat pillar
    { kind: 'cylinder', pos: [0, -0.10, 0], radius: 0.04, height: 0.16, segments: 10, mat: 'wax' },
    // Wick — narrow dark cylinder just below the flame
    { kind: 'cylinder', pos: [0, -0.02, 0], radius: 0.005, height: 0.024, segments: 4, mat: 'wick' },
    // Flame: emissive sphere at the local origin (= light source). Scale +
    // position animated by updateTorchlight(); values here are the rest pose.
    {
      name: 'flame',
      kind: 'sphere',
      pos: [0, 0.02, 0],
      scale: [1.0, 1.4, 1.0],
      radius: 0.04,
      segments: [10, 10],
      mat: 'flame',
      castShadow: false,
    },
    // Wisp: additive-blended halo sprite above the flame. The
    // 'wisp' name is recognised by torchlight.ts updateTorchlight
    // for the dramatic dim-out cycles, so this one stays
    // animation-free (driven by the runtime ticker instead of the
    // built-in flicker field).
    {
      name: 'wisp',
      kind: 'sprite',
      pos: [0, 0.10, 0],
      size: [0.30, 0.45],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffaa55,
    },
    // Subtle flame tongue layers stacked above the flame sphere —
    // same family as the bonfire's flicker stack but small.
    // These DON'T have the 'wisp' name so torchlight.ts won't
    // touch them; their own per-sprite flicker (scale wobble + Y
    // bob, desynced via random phase) does the work.
    // A single flame tongue over the emissive sphere (the wisp halo above
    // sells the rest). Was two stacked tongues; one is enough once batching
    // makes torches cheap — keeps the flame shape at one fewer draw each.
    {
      kind: 'sprite',
      pos: [0, 0.08, 0],
      size: [0.14, 0.30],
      texture: 'fire-wisp',
      blending: 'additive',
      color: 0xffc060,
      flicker: { scale: 0.26, bob: 0.026, speed: 3.0 },
    },
  ],
  slots: {
    flame_top: { pos: [0, 0.08, 0] },
  },
  light: {
    color: CONFIG.TORCH_COLOR,
    intensity: CONFIG.TORCH_INTENSITY,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    castShadow: true,
    shadowMapSize: 512,
    shadowBias: -0.005,
  },
};
