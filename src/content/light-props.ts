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

// Floor glow: a soft circular puddle of cool light on the floor — implies
// luminous fungus, a cracked floor with cold light bleeding through, or some
// strange phosphorescence. Uses the fire-wisp texture as the gradient mask,
// tinted cool cyan and emissive.
export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  return {
    id: `floor-glow-${tint.toString(16)}`,
    materials: {},
    parts: [
      // Decal lying flat on the floor (-PI/2 around X), soft round gradient
      // from the fire-wisp texture, tinted + emissive in the target color.
      {
        kind: 'decal',
        pos: [0, 0.01, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [0.9, 0.9],
        texture: 'fire-wisp',
        color: tint,
        emissive: tint,
        emissiveIntensity: 1.8,
      },
    ],
    light: {
      color: tint,
      intensity: 9,
      distance: 2.8,
      decay: 1.6,
      pos: [0, 0.20, 0],          // just above the floor, gentle upward pool
      castShadow: false,
    },
  };
}
