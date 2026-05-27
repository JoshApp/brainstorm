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

// Floor glow: ambient mood for a room. NOT a spotlight or a
// volumetric fog wall — earlier attempts produced a billboarded
// sprite at chest height that read as a "fireball" obscuring the
// view ahead. What works instead:
//
//   1. Wide soft floor wash decal — dim, big, no bright core.
//      The colour "stains" the floor.
//   2. A handful of tiny scattered ember motes hanging in the
//      air around the source. Small enough that no single one
//      blocks vision, additive so they only ADD colour, never
//      obscure. Their offsets break the always-camera-facing
//      sprite illusion so the room feels like it has particulate
//      material in the air.
//
// The PointLight does the heavy "room flooded with colour" work —
// it's lower intensity but much larger distance + soft decay so
// the tint reaches the walls without any one spot being glaring.
export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  const id = `floor-glow-${tint.toString(16)}`;
  // Small additive motes scattered around the source. Each is a
  // billboard but they sit at varied positions/sizes so the eye
  // reads "specks of glowing dust in the air" rather than "wall
  // of haze". Authored in a small grid pattern with jittered
  // sizes for organic feel.
  const motes: Array<{ pos: [number, number, number]; size: [number, number] }> = [
    { pos: [-0.6,  0.45,  0.2], size: [0.30, 0.34] },
    { pos: [ 0.5,  0.30, -0.4], size: [0.26, 0.30] },
    { pos: [ 0.3,  0.85,  0.5], size: [0.22, 0.26] },
    { pos: [-0.4,  1.20, -0.3], size: [0.28, 0.32] },
    { pos: [ 0.1,  1.70,  0.0], size: [0.20, 0.24] },
    { pos: [-0.2,  2.20,  0.3], size: [0.18, 0.22] },
  ];
  return {
    id,
    materials: {},
    parts: [
      // Wide soft floor wash — colour stain on the ground.
      {
        kind: 'decal',
        pos: [0, 0.005, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [3.6, 3.6],
        texture: 'fire-wisp',
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.45,
      },
      // Scattered ember motes. Additive so they layer subtly with
      // the room torchlight and fog instead of stacking into an
      // opaque wall.
      ...motes.map((m) => ({
        kind: 'sprite' as const,
        pos: m.pos,
        size: m.size,
        texture: 'fire-wisp',
        color: tint,
        blending: 'additive' as const,
      })),
    ],
    light: {
      color: tint,
      intensity: 13,
      distance: 13,
      decay: 1.8,
      pos: [0, 1.20, 0],
      castShadow: false,
    },
  };
}
