import type { LevelSpec } from './types';
import { ITEMS } from '../content/items';

// Safe room — the small chamber between dungeon floors where the
// player catches their breath. No enemies. No traps. Just a calm beat.
//
// V2 layout (bigger + warmer than V1):
//   - 12 × 14 m chamber, taller ceiling (3.4m). Reads as a refuge,
//     not a tight closet.
//   - Stash chest + fountain on opposite sides, both pulled INTO the
//     room (not flush against walls) so the player walks AROUND them.
//   - Stairs forward of the back wall with breathing room (player can
//     stand a couple metres back, see the descent, decide when to go).
//   - 6 wall torches (warm orange), 2 candles near the stash + 2 near
//     the fountain, 2 candles flanking the stairs, plus a central
//     floor glow → the room is COMFORTABLY LIT, not dim.
//   - Bench-ish stone slabs at the south end and a "rest" altar in
//     the middle for atmosphere (no interaction yet — just things
//     to look at while you breathe).
//
// Future fixtures (placeholders to wire later):
//   - Smith pedestal (upgrade a weapon)
//   - Vendor stall (buy a one-off consumable / scroll)
//   - Mystery NPC slot (LLM-driven encounter)

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
    startPos: { x: 0, z: 5.5, yaw: 0 },
    rooms: [
      {
        id: 'safe-chamber',
        rect: { x: 0, z: 0, w: 12, d: 14 },
        height: 3.4,
      },
    ],
    corridors: [],

    props: [
      // ── STASH (west side, between spawn and altar).
      {
        kind: 'stash-chest',
        x: -3.5, z: 2.0,
        rotY: Math.PI / 2,   // face east (toward room centre)
      },
      { kind: 'model', model: FLOOR_CANDLE, x: -3.5, y: 0, z: 1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x: -3.5, y: 0, z: 3.0 },

      // ── FOUNTAIN (east side, mirror of stash).
      {
        kind: 'fountain',
        x: 3.5, z: 2.0,
        rotY: -Math.PI / 2,
      },
      { kind: 'model', model: FLOOR_CANDLE, x: 3.5, y: 0, z: 1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x: 3.5, y: 0, z: 3.0 },

      // ── REST ALTAR (centre of the room) — skull on stone, atmospheric.
      { kind: 'altar', x: 0, z: -0.5 },
      { kind: 'model', model: ALTAR_SKULL, x: 0, y: 0.62, z: -0.5, rotY: 0.3 },

      // Candles immediately south of the stair mouth — frame the descent.
      { kind: 'model', model: FLOOR_CANDLE, x: -1.4, y: 0, z: -2.6 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.4, y: 0, z: -2.6 },

      // Warm floor glow near the spawn end + cool glow guiding north to
      // the descent.
      { kind: 'model', model: SAFE_FLOOR_GLOW_CENTER, x: 0, y: 0, z: 2.0 },
      { kind: 'model', model: SAFE_FLOOR_GLOW_NORTH,  x: 0, y: 0, z: -2.5 },
    ],

    torches: [
      // Six wall torches around the room. Cool blue accent flanks the
      // descent stair at the NORTH end; warm orange everywhere else.
      // Mirrored across the room's centre line.
      { x: -5.95, z:  4.0, height: 2.4, wall: 'W', colorTint: 0xffb070, intensityMul: 0.95 },
      { x:  5.95, z:  4.0, height: 2.4, wall: 'E', colorTint: 0xffb070, intensityMul: 0.95 },
      { x: -5.95, z:  0.0, height: 2.4, wall: 'W', colorTint: 0xffa860, intensityMul: 1.0 },
      { x:  5.95, z:  0.0, height: 2.4, wall: 'E', colorTint: 0xffa860, intensityMul: 1.0 },
      { x: -5.95, z: -4.0, height: 2.4, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.75 },
      { x:  5.95, z: -4.0, height: 2.4, wall: 'E', colorTint: 0x88aaff, intensityMul: 0.75 },
    ],

    spawns: [],  // no enemies — this is the SAFE room
    doors: [],

    stairs: [
      {
        id: `stairs-${id}-down`,
        // North end. rotY=π descends in -Z (further north into the
        // back wall). Stair top at z=-3.5; footprint extends to
        // z=-6.06 — 0.94m buffer to the back wall at z=-7. The
        // descent is well clear of the player's south-end spawn.
        x: 0, z: -3.5,
        rotY: Math.PI,
        targetLevel: nextId,
      },
    ],
  };
}

// Lazy imports — keep this module's top-level surface small.
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';
import { ALTAR_SKULL } from '../content/relics';
const SAFE_FLOOR_GLOW_CENTER = floorGlow(0xffb070);
const SAFE_FLOOR_GLOW_NORTH  = floorGlow(0xc4d8ff);  // cool, guides toward stairs
void ITEMS;
