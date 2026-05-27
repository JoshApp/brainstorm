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

// Floor glow: ambient mood. Earlier passes tried to make this
// the primary "room is tinted" lever via a bright PointLight +
// bright floor decal — but that read as "spotlight on the floor"
// and competed with fountains, altars, anything else that wanted
// to anchor the eye in the room centre.
//
// New model: floorGlow is JUST a handful of additive specks of
// dust hanging in the air around its anchor, plus a very soft
// fill light that tints nearby surfaces. The actual room mood
// (warm vs cold vs sickly green) comes from per-vault TORCH
// tinting now. floorGlow's role is the local accent — a hint of
// colour over a specific prop (an altar, a chest pile) — not the
// room's lighting register.
export function floorGlow(tint: number = 0x6cc6e0): ModelSpec {
  const id = `floor-glow-${tint.toString(16)}`;
  // Small additive motes scattered around the source. Tiny enough
  // that they read as "dust in the air catching the light"
  // rather than as a glowing object on the floor.
  const motes: Array<{ pos: [number, number, number]; size: [number, number] }> = [
    { pos: [-0.6,  0.45,  0.2], size: [0.22, 0.26] },
    { pos: [ 0.5,  0.30, -0.4], size: [0.18, 0.22] },
    { pos: [ 0.3,  0.85,  0.5], size: [0.16, 0.20] },
    { pos: [-0.4,  1.20, -0.3], size: [0.20, 0.24] },
    { pos: [ 0.1,  1.70,  0.0], size: [0.14, 0.18] },
    { pos: [-0.2,  2.20,  0.3], size: [0.12, 0.16] },
  ];
  return {
    id,
    materials: {},
    parts: motes.map((m) => ({
      kind: 'sprite' as const,
      pos: m.pos,
      size: m.size,
      texture: 'fire-wisp',
      color: tint,
      blending: 'additive' as const,
    })),
    light: {
      color: tint,
      // Subtle, broad, raised. Doesn't ANCHOR the room — just
      // tints whatever's already in it. Was intensity 13 / dist 13
      // / decay 1.8; now much softer + wider so the colour
      // suffuses without any spot being bright.
      intensity: 6,
      distance: 14,
      decay: 2.2,
      pos: [0, 2.0, 0],
      castShadow: false,
    },
  };
}
