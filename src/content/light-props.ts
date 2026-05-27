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

// Floor glow: an ambient mood light that floods the room with a
// coloured wash. NOT a tight spotlight — earlier passes used a
// bright inner disc which read as "a glowing object" (eg. a relic
// dropped on the floor). What we actually want here is "the air
// in this chamber is tinted blue/green/etc" — a volumetric mood
// register. So the layers are:
//
//   1. Wide soft floor wash decal — dim, big, no clear edge
//   2. Vertical haze column at chest height — reads as fog
//      catching the tint
//   3. Ceiling-level wash — large faint sprite suggesting the
//      colour bouncing off the ceiling
//
// PointLight has lower intensity but much larger distance + a
// softer decay so the colour reaches the walls without anywhere
// being uncomfortably bright.
export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  const id = `floor-glow-${tint.toString(16)}`;
  return {
    id,
    materials: {},
    parts: [
      // Layer 1: wide floor wash — large, soft, no bright core.
      // Bigger and dimmer than the old halo so the eye reads "the
      // floor here is tinted" rather than "spotlight on floor".
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
      // Layer 2: chest-height haze column — a tall billboarded
      // sprite catching the tint. From across the room this reads
      // as "the air is glowing", a volumetric fog feel.
      {
        kind: 'sprite',
        pos: [0, 1.10, 0],
        size: [2.20, 2.40],
        texture: 'fire-wisp',
        color: tint,
        blending: 'additive',
      },
      // Layer 3: ceiling-level wash — wide, short, low-opacity
      // sprite implying the colour bouncing up. Visible above
      // when the player looks up, peripheral when looking
      // forward.
      {
        kind: 'sprite',
        pos: [0, 2.60, 0],
        size: [3.40, 1.20],
        texture: 'fire-wisp',
        color: tint,
        blending: 'additive',
      },
    ],
    light: {
      color: tint,
      // Softer + wider than before: was intensity 22, distance
      // 7.5, decay 1.2 — bright spot, tight pool. Now intensity
      // 13, distance 13, decay 1.8 — the colour reaches all the
      // way to the walls but no single spot is glaring.
      intensity: 13,
      distance: 13,
      decay: 1.8,
      pos: [0, 1.20, 0],          // raised from floor → chest height for room-wide wash
      castShadow: false,
    },
  };
}
