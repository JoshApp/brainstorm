import type { LevelSpec } from './types';
import type { ModelSpec } from '../ecs/model-types';
import { ITEMS } from '../content/items';

// Safe room — the calm chamber between dungeon floors. No enemies, no
// traps, every interactable visible from the spawn end.
//
// V5 layout (the "bonfire is the centrepiece" pass):
//   - 9 × 11m chamber, ceiling 2.8m (kept from V3 — cozy proportions
//     that earned their keep).
//   - THE BONFIRE on the central axis, dead on the walk-line between
//     spawn and the descent — you can't leave without passing it.
//     This is the room's heart: REST at it to level (the level-up
//     menu). Scaled up + ringed by two stone benches as the hearth
//     circle. Replaces V4's decorative iron brazier.
//   - TOME PILLAR pulled off-axis to the front-left flank — a quiet
//     REVIEW station you pass on the way in, no longer the centre.
//   - GREEN FOUNTAIN mirrors it front-right (heal to full). STASH +
//     MERCHANT sit at the back corners.
//   - 6 wall torches, ALL warm amber. Candles frame the approach + the
//     descent.
//
// Future fixtures (placeholders to wire later):
//   - Smith pedestal (upgrade a weapon)
//   - Vendor stall (buy a one-off consumable / scroll)
//   - Mystery NPC slot (LLM-driven encounter)

// Stone bench — simple slab on two short stubs. Built inline rather
// than added to the content/ library since it only appears here.
// Used for decorative seating flanking the central brazier; no
// collision (the player walks around them, never on them).
const STONE_BENCH: ModelSpec = {
  id: 'stone-bench',
  materials: {
    stone: { color: 0x4a4238, roughness: 0.95, metalness: 0.0, flatShading: true },
  },
  parts: [
    // Slab top — long box, sits at sitting height (~0.42m top).
    { kind: 'box', size: [1.20, 0.10, 0.42], pos: [0, 0.37, 0], mat: 'stone' },
    // Two stubby leg blocks under the slab ends.
    { kind: 'box', size: [0.22, 0.32, 0.32], pos: [-0.45, 0.16, 0], mat: 'stone' },
    { kind: 'box', size: [0.22, 0.32, 0.32], pos: [ 0.45, 0.16, 0], mat: 'stone' },
  ],
};

// Raised hearth dais — a two-step circular stone plinth the centrepiece
// bonfire stands on, so the fire reads as the BUILT heart of the refuge
// (a thing someone hewed and tends) rather than a fire on bare floor.
// Steps taper slightly (wider at the base = grounded plinth read), low
// segment count for the carved-stone PS1 family, a worn dark rim lip on
// the top edge. Decorative only — no collision; the player walks up to
// its edge to REST. Top sits at y≈0.30, where the bonfire is placed.
const STONE_DAIS: ModelSpec = {
  id: 'safe-hearth-dais',
  class: 'decor',
  materials: {
    base:  { color: 0x39332b, roughness: 0.96, metalness: 0.0, flatShading: true },
    riser: { color: 0x4a4238, roughness: 0.9,  metalness: 0.0, flatShading: true },
    rim:   { color: 0x2a241d, roughness: 1.0,  metalness: 0.0, flatShading: true },
  },
  parts: [
    // Lower step — wide, low, slight taper.
    { kind: 'cylinder', pos: [0, 0.07, 0], radiusTop: 1.45, radius: 1.55, height: 0.14, segments: 16, mat: 'base' },
    // Upper step — narrower, where the fire sits.
    { kind: 'cylinder', pos: [0, 0.22, 0], radiusTop: 1.08, radius: 1.18, height: 0.16, segments: 16, mat: 'riser' },
    // Worn dark lip ringing the upper edge.
    { kind: 'torus', pos: [0, 0.30, 0], rot: [Math.PI / 2, 0, 0], radius: 1.08, tube: 0.035, segments: [16, 8], mat: 'rim' },
  ],
};

export function generateSafeRoom(prevDepth: number): LevelSpec {
  const nextDepth = prevDepth + 1;
  const id = `safe-${prevDepth}`;
  const nextId = `depth-${nextDepth}`;

  return {
    id,
    depth: nextDepth,
    displayName: 'A still place between the dark',
    // Warm dark — a touch warmer than the dungeon floors. Reads as
    // refuge without flipping to a brightly-lit room.
    fogColor: 0x1a0e08,
    // Player enters at the south end, facing north (-Z) toward the
    // descent at the far end. Spawn pulled close to the south wall so
    // there's zero chance of overlapping the stair footprint.
    startPos: { x: 0, z: 4.0, yaw: 0 },
    rooms: [
      {
        id: 'safe-chamber',
        rect: { x: 0, z: 0, w: 9, d: 11 },
        height: 2.8,
      },
    ],
    corridors: [],

    props: [
      // ── THE BONFIRE — the heart of the room (centre, on the path) ───
      // V5 recentres the whole chamber on the fire. It sits dead on the
      // walk-line between spawn and the descent, so you cannot leave
      // without passing it: this is where you REST (the level-up menu,
      // ui/levelup-menu.ts) and turn earned levels into strength. Scaled
      // up from the per-floor fire so it reads as the grand hearth of the
      // refuge. The REST interactable is wired by builder.ts off the
      // 'bonfire' model id — same path as every dungeon-floor fire, so
      // authoring it here is all it takes. Slight rotY so the sword
      // landmark catches the eye at an angle rather than edge-on. The
      // fire stands on a raised stone dais (below) — y=0.30 sits it on
      // the plinth's top — and is scaled up to read as the grand hearth.
      { kind: 'model', model: STONE_DAIS, x: 0, y: 0, z: 0.3 },
      { kind: 'model', model: BONFIRE, x: 0, y: 0.30, z: 0.3, rotY: 0.5, scale: 1.45 },
      // Stone benches drawn in around the dais — the hearth circle. They
      // sell "sit here" literally now: the fire is the rest. No collision
      // (the player walks around them).
      { kind: 'model', model: STONE_BENCH, x: -2.6, y: 0, z: 0.3, rotY: Math.PI / 2 },
      { kind: 'model', model: STONE_BENCH, x:  2.6, y: 0, z: 0.3, rotY: -Math.PI / 2 },

      // ── TOME PILLAR (front-left flank) — REVIEW your delver ──────────
      // Moved off the central axis (it used to be the centrepiece): the
      // fire owns the room now, the book is a quiet station you pass on
      // the way in. STUDY reflects your build; it never spends.
      { kind: 'tome-pillar', x: -2.7, z: 2.6, rotY: Math.PI / 2 },

      // ── GREEN FOUNTAIN (front-right flank, mirror of the tome) ──────
      // Sickly green basin — looks suspect, drinks clean. Always heals
      // to full. (The 'gamble' variant.)
      {
        kind: 'fountain',
        x: 2.7, z: 2.6,
        rotY: -Math.PI / 2,
        variant: 'gamble',
      },

      // (Stash removed from the safe room — Josh, 2026-07-31.)

      // The merchant — a hooded trader tucked at the back-right, the
      // harbor's gold sink. Faces the fire so you find them as you arrive.
      { kind: 'merchant', x: 3.0, z: -2.8, rotY: Math.PI },

      // ── Candles ─────────────────────────────────────────────────────
      // Flank the approach between the front fixtures and the central
      // path, then frame the descent behind the fire.
      { kind: 'model', model: FLOOR_CANDLE, x: -1.6, y: 0, z: 2.8 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.6, y: 0, z: 2.8 },
      { kind: 'model', model: FLOOR_CANDLE, x: -1.3, y: 0, z: -1.4 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.3, y: 0, z: -1.4 },

      // Warm floor glow at the spawn end (greets the player) and a
      // stronger one under the bonfire so the centre reads as the hot
      // heart of the room.
      { kind: 'model', model: SAFE_FLOOR_GLOW_SPAWN,  x: 0, y: 0, z: 3.6 },
      { kind: 'model', model: SAFE_FLOOR_GLOW_HEARTH, x: 0, y: 0, z: 0.3 },
    ],

    torches: [
      // Six wall torches, all WARM amber. V2's cool-blue back torches
      // told the wrong story — a refuge shouldn't have "more dark ahead"
      // signalling on its walls. The stair's own warm shaft (variant
      // resolved in interactables/stairs.ts) carries the guide-toward
      // signal now, so the walls stay uniformly inviting.
      { x: -4.45, z:  3.5, height: 2.2, wall: 'W', colorTint: 0xffb070, intensityMul: 0.95 },
      { x:  4.45, z:  3.5, height: 2.2, wall: 'E', colorTint: 0xffb070, intensityMul: 0.95 },
      { x: -4.45, z:  0.0, height: 2.2, wall: 'W', colorTint: 0xffa860, intensityMul: 1.0  },
      { x:  4.45, z:  0.0, height: 2.2, wall: 'E', colorTint: 0xffa860, intensityMul: 1.0  },
      { x: -4.45, z: -2.8, height: 2.2, wall: 'W', colorTint: 0xffa860, intensityMul: 0.9  },
      { x:  4.45, z: -2.8, height: 2.2, wall: 'E', colorTint: 0xffa860, intensityMul: 0.9  },
    ],

    spawns: [],  // no enemies — this is the SAFE room
    doors: [],

    stairs: [
      {
        id: `stairs-${id}-down`,
        // North end. rotY=π descends in -Z (further north into the
        // back wall). Stair top at z=-2.0; footprint extends to
        // z=-4.66 — 0.84m buffer to the back wall at z=-5.5. The
        // descent is well clear of the player's south-end spawn.
        x: 0, z: -2.0,
        rotY: Math.PI,
        targetLevel: nextId,
      },
    ],
  };
}

// Lazy imports — keep this module's top-level surface small.
import { FLOOR_CANDLE } from '../content/candle';
import { BONFIRE } from '../content/bonfire';
import { floorGlow } from '../content/light-props';
const SAFE_FLOOR_GLOW_SPAWN  = floorGlow(0xffb070);
const SAFE_FLOOR_GLOW_HEARTH = floorGlow(0xff9050);
void ITEMS;
