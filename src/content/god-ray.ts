import type { ModelSpec } from '../ecs/model-types';

// God ray — a shaft of light pouring through a crack in the ceiling
// down to the floor. The PROP itself does nothing when touched, but it
// is NOT free decoration: under DELVE's "Lighting as signal" pillar an
// uncommon light source is a PROMISE that something is there. A god ray
// ANCHORS CONTENT — it must land on or beside something the player can
// engage with (altar, chest, corpse-with-note, boss spawn). A beam over
// empty floor trains the player to distrust light, which quietly breaks
// the whole signalling language. See the Usage rules below.
//
// Built in the stair-beam pattern (see src/interactables/stairs.ts):
//   - Bright ceiling-crack emitter at the top — the visible source.
//   - Outer haze + bright core planes vertically anchored from
//     floor to ceiling so the shaft never reads as a floating oval.
//   - Floor disc at the base — pool of light where the ray lands.
//   - Dust motes along the shaft for the volumetric "particles in
//     the beam" feel.
//   - PointLight aligned directly under the shaft so the lit floor
//     matches what the eye sees.
//
// All glow parts use the neutral 'moonbeam' texture (pure white-to-
// transparent radial). Hue comes purely from the `tint` param — no
// red bleed from a fire-wisp gradient.
//
// Usage rules:
//   - ANCHOR, never decorate. Every god ray must illuminate or sit
//     beside engageable content. Never place one to "fill" an empty
//     room — if a room feels empty, give it a reason to exist
//     (encounter, hint, interactable), don't light up a corner.
//   - Land the beam ON the anchor (≤~1.5m). The payoff is "I crossed
//     the light AND arrived at the thing." A beam offset several
//     metres into open floor, with the altar/boss across the room,
//     reads as a random shaft — anchored on paper, noise in play.
//   - Sparingly. A god ray loses meaning if every room has one; they
//     should read as "this chamber is special." Maybe one in every
//     few vaults — and only where there's content to anchor.

export interface GodRayOpts {
  /** Hex color tint. Default pale moonlight blue. */
  tint?: number;
  /** Room ceiling height — shaft top anchors here. Default 3.2
   *  matches the standard dungeon ceiling (see archway.ts). */
  ceilingHeight?: number;
}

export function godRay(opts: GodRayOpts = {}): ModelSpec {
  const tint = opts.tint ?? 0xb8c8ff;
  const ceiling = opts.ceilingHeight ?? 3.2;

  const shaftMidY = ceiling / 2;
  const id = `god-ray-${tint.toString(16)}-${ceiling.toFixed(1)}`;

  return {
    id,
    materials: {},
    parts: [
      // Ceiling crack emitter — bright slit just below the ceiling.
      // Reads as "the light is pouring through HERE". Horizontal
      // plane facing down; small + bright.
      {
        kind: 'decal',
        pos: [0, ceiling - 0.01, 0],
        rot: [Math.PI / 2, 0, 0],
        size: [0.55, 0.12],
        texture: 'moonbeam',
        color: tint,
        blending: 'additive',
        opacity: 0.85,
      },
      // Outer haze — wide, dim. Anchored floor-to-ceiling.
      {
        kind: 'decal',
        pos: [0, shaftMidY, 0],
        size: [0.55, ceiling],
        texture: 'moonbeam',
        color: tint,
        blending: 'additive',
        opacity: 0.22,
      },
      // Bright core — narrow, brighter. Slightly forward of the
      // outer haze so it always renders on top.
      {
        kind: 'decal',
        pos: [0, shaftMidY, 0.02],
        size: [0.18, ceiling],
        texture: 'moonbeam',
        color: tint,
        blending: 'additive',
        opacity: 0.40,
      },
      // Floor disc — soft pool of light where the ray lands.
      // Centered directly under the shaft (no offset like the
      // old version) so the light source, shaft, and floor pool
      // all line up.
      {
        kind: 'decal',
        pos: [0, 0.012, 0],
        rot: [-Math.PI / 2, 0, 0],
        size: [0.85, 0.85],
        texture: 'moonbeam',
        color: tint,
        blending: 'additive',
        opacity: 0.55,
      },
      // Dust motes — sprites along the shaft. Slightly jittered
      // in X/Z so they don't form a perfect column.
      {
        kind: 'sprite', pos: [-0.04, ceiling * 0.25, 0.01], size: [0.07, 0.07],
        texture: 'moonbeam', color: tint, blending: 'additive', opacity: 0.55,
      },
      {
        kind: 'sprite', pos: [0.05, ceiling * 0.45, -0.02], size: [0.06, 0.06],
        texture: 'moonbeam', color: tint, blending: 'additive', opacity: 0.50,
      },
      {
        kind: 'sprite', pos: [-0.03, ceiling * 0.62, 0.03], size: [0.05, 0.05],
        texture: 'moonbeam', color: tint, blending: 'additive', opacity: 0.45,
      },
      {
        kind: 'sprite', pos: [0.04, ceiling * 0.80, -0.01], size: [0.05, 0.05],
        texture: 'moonbeam', color: tint, blending: 'additive', opacity: 0.40,
      },
    ],
    light: {
      color: tint,
      intensity: 5,
      distance: 5,
      decay: 1.8,
      // Directly under the shaft, slightly above the floor — so
      // the lit floor patch matches where the shaft visibly lands.
      pos: [0, 0.4, 0],
      castShadow: false,
    },
  };
}
