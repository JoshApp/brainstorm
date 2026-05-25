import type { ModelSpec } from '../ecs/model-types';

// "Coloured-light props" — small fixtures whose primary purpose is throwing a
// non-warm light into a space. Used to break up the dungeon's default warm
// torch palette: e.g. a cold pale-blue crack of moonlight in a warm chamber,
// or a cyan glow in the corridor transitioning to the haunted antechamber.
//
// Each is just a ModelSpec with one visible part (a glowing slit/disc) and
// an attached PointLight in the same color family. The whole thing is placed
// via the existing 'model' prop kind — no new prop type needed.

// Moonlight crack: a vertical glowing slit on a wall. Reads as light bleeding
// in through a crack in the masonry from somewhere outside the dungeon. The
// emissive box itself is highly visible against the dark stone; the
// PointLight casts cool pale-blue into the room.
export const MOONLIGHT_CRACK: ModelSpec = {
  id: 'moonlight-crack',
  materials: {
    moonlight: {
      color: 0x000000,
      emissive: 0xbcd6ff,        // cold pale blue-white
      emissiveIntensity: 4.5,
      roughness: 1.0,
    },
  },
  parts: [
    // Thin vertical slit — 4cm wide, 1.4m tall, paper-thin so it pokes
    // through the wall plane without z-fighting. Cast no shadow (the bright
    // emissive would create a dark shadow on the wall behind itself).
    { kind: 'box', pos: [0, 0, 0], size: [0.04, 1.4, 0.02], mat: 'moonlight', castShadow: false },
  ],
  light: {
    color: 0xbcd6ff,
    intensity: 14,
    distance: 5.0,
    decay: 1.5,
    pos: [0, 0, 0.35],            // shifted slightly into the room
    castShadow: false,
  },
};

// Floor glow: a soft pool of cool light on the floor — implies luminous
// fungus, cracked floor with cold light bleeding through, or strange
// phosphorescence. Uses the fire-wisp texture as the visible gradient
// mask. Light has long range + gentle decay so it actually illuminates
// the surrounding area (not just a small spot).
export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  return {
    id: `floor-glow-${tint.toString(16)}`,
    materials: {},
    parts: [
      // Visible disc on the floor — bigger than before so the source reads
      // as a wide soft pool, not a tiny dot.
      {
        kind: 'decal',
        pos: [0, 0.01, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [1.6, 1.6],
        texture: 'fire-wisp',
        color: tint,
        emissive: tint,
        emissiveIntensity: 1.5,
      },
    ],
    light: {
      color: tint,
      intensity: 18,
      distance: 6.5,              // much further reach — actually lights the room
      decay: 1.2,                 // gentler falloff so the light feels diffuse
      pos: [0, 0.30, 0],
      castShadow: false,
    },
  };
}
