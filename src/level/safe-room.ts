import type { LevelSpec } from './types';
import type { ModelSpec } from '../ecs/model-types';
import { ITEMS } from '../content/items';

// Safe room — the small chamber between dungeon floors where the
// player catches their breath. No enemies. No traps. Just a calm beat.
//
// V3 layout (smaller + warmer than V2):
//   - 9 × 11 m chamber, lower ceiling (2.8m). Cozier proportions —
//     V2's 12×14×3.4 read as "vast empty prototype" once the dark-
//     adaptation pass made the dungeon navigable; we cut volume so
//     the candle-and-brazier light fully claims the room.
//   - Central IRON BRAZIER as the room's heart — warm radial light
//     anchor, replaces V2's altar-as-centerpiece. Two stone benches
//     flank it (decorative, no interaction yet — but they sell
//     "you can rest here").
//   - Stash + REST FOUNTAIN on opposite walls (variant: 'rest' —
//     guaranteed heal, warm amber glow; no curse gamble like the
//     dungeon variant).
//   - 6 wall torches, ALL warm amber (V2's cool-blue back torches
//     pushed "more dark ahead" — wrong signal for a refuge).
//   - Two candles flanking the descent stairs to frame the way
//     forward. The stair itself uses the warm-passive variant
//     when leading to a next-act first depth (handled in
//     interactables/stairs.ts based on targetLevel id).
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
      // ── HEARTH (centre) — iron brazier + flanking stone benches.
      // The brazier carries warm light + the room's focal point;
      // benches sell "rest here" without needing interaction yet.
      { kind: 'model', model: IRON_BRAZIER, x: 0, y: 0, z: 0.6 },
      { kind: 'model', model: STONE_BENCH,  x: -1.6, y: 0, z: 0.6, rotY: Math.PI / 2 },
      { kind: 'model', model: STONE_BENCH,  x:  1.6, y: 0, z: 0.6, rotY: -Math.PI / 2 },

      // ── STASH (west wall, between spawn and hearth).
      {
        kind: 'stash-chest',
        x: -3.7, z: 2.6,
        rotY: Math.PI / 2,   // face east (toward room centre)
      },
      { kind: 'model', model: FLOOR_CANDLE, x: -3.7, y: 0, z: 1.6 },
      { kind: 'model', model: FLOOR_CANDLE, x: -3.7, y: 0, z: 3.6 },

      // ── REST FOUNTAIN (east wall, mirror of stash). Guaranteed
      // heal, no curse — the safe-room variant.
      {
        kind: 'fountain',
        x: 3.7, z: 2.6,
        rotY: -Math.PI / 2,
        variant: 'rest',
      },
      { kind: 'model', model: FLOOR_CANDLE, x: 3.7, y: 0, z: 1.6 },
      { kind: 'model', model: FLOOR_CANDLE, x: 3.7, y: 0, z: 3.6 },

      // Candles immediately south of the stair mouth — frame the descent.
      { kind: 'model', model: FLOOR_CANDLE, x: -1.4, y: 0, z: -1.2 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.4, y: 0, z: -1.2 },

      // Warm floor glow near the spawn end (greets the player as they
      // arrive) and a second smaller glow under the hearth so the floor
      // around the brazier reads as warmed stone.
      { kind: 'model', model: SAFE_FLOOR_GLOW_SPAWN,  x: 0, y: 0, z: 3.5 },
      { kind: 'model', model: SAFE_FLOOR_GLOW_HEARTH, x: 0, y: 0, z: 0.6 },
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
import { IRON_BRAZIER } from '../content/light-props';
import { floorGlow } from '../content/light-props';
const SAFE_FLOOR_GLOW_SPAWN  = floorGlow(0xffb070);
const SAFE_FLOOR_GLOW_HEARTH = floorGlow(0xff9050);
void ITEMS;
