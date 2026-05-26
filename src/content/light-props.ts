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

// Floor glow: a luminous source built INTO the floor — cracked stone with
// something glowing beneath, or phosphorescent fungus. Three layered parts
// give it depth (vs the old single flat disc):
//
//   1. Wide outer halo decal — soft falloff, the "ambient pool"
//   2. Bright inner disc — the "core" you read as the source
//   3. Vertical ember plume sprite — a billboarded heat-haze pillar that
//      reads from any angle as light rising from the floor
//
// Plus the PointLight that does the actual room-illumination.
export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  const id = `floor-glow-${tint.toString(16)}`;
  return {
    id,
    materials: {},
    parts: [
      // Layer 1: outer halo — wide soft falloff.
      {
        kind: 'decal',
        pos: [0, 0.005, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [2.2, 2.2],
        texture: 'fire-wisp',
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.9,
      },
      // Layer 2: bright inner core — smaller, brighter, gives the eye an
      // anchor "this is THE source" instead of an indistinct smear.
      {
        kind: 'decal',
        pos: [0, 0.012, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [0.8, 0.8],
        texture: 'fire-wisp',
        color: tint,
        emissive: tint,
        emissiveIntensity: 2.4,
      },
      // Layer 3: vertical ember-plume sprite. Billboarded so it ALWAYS
      // faces the camera, reads as a column of light/heat rising from
      // the floor. Tinted with the same color and additively blended so
      // it stays luminous through fog.
      {
        kind: 'sprite',
        pos: [0, 0.45, 0],
        size: [0.55, 0.9],
        texture: 'fire-wisp',
        color: tint,
        blending: 'additive',
      },
    ],
    light: {
      color: tint,
      intensity: 22,              // bumped 18 → 22 for the brighter overall look
      distance: 7.5,              // bumped 6.5 → 7.5
      decay: 1.2,
      pos: [0, 0.35, 0],
      castShadow: false,
    },
  };
}
