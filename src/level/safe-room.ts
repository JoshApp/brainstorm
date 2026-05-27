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
    // Player enters at the south end, facing north toward the stairs.
    startPos: { x: 0, z: 5.0, yaw: 0 },
    rooms: [
      {
        id: 'safe-chamber',
        rect: { x: 0, z: 0, w: 12, d: 14 },
        height: 3.4,
      },
    ],
    corridors: [],

    props: [
      // ── STASH (west side, pulled inward so the player can circle it).
      {
        kind: 'stash-chest',
        x: -3.5, z: 0.0,
        rotY: Math.PI / 2,   // face east (toward room centre)
      },
      // Candles flanking the stash.
      { kind: 'model', model: FLOOR_CANDLE, x: -3.5, y: 0, z: -1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x: -3.5, y: 0, z:  1.0 },

      // ── FOUNTAIN (east side).
      {
        kind: 'fountain',
        x: 3.5, z: 0.0,
        rotY: -Math.PI / 2,
      },
      // Candles flanking the fountain.
      { kind: 'model', model: FLOOR_CANDLE, x: 3.5, y: 0, z: -1.0 },
      { kind: 'model', model: FLOOR_CANDLE, x: 3.5, y: 0, z:  1.0 },

      // ── REST ALTAR (centre of the room) — small skull on stone for
      // atmosphere. No interaction yet; just a focal point.
      { kind: 'altar', x: 0, z: 0 },
      { kind: 'model', model: ALTAR_SKULL, x: 0, y: 0.62, z: 0, rotY: 0.3 },

      // ── DESCENT STAIRS (north end). Stairs are pulled into the room
      // so they don't sit flush against the back wall. The candles
      // immediately south of the stairs frame the descent.
      { kind: 'model', model: FLOOR_CANDLE, x: -1.4, y: 0, z: 1.8 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.4, y: 0, z: 1.8 },

      // ── CENTRAL FLOOR GLOW — warm pool of light at the room centre.
      { kind: 'model', model: SAFE_FLOOR_GLOW_CENTER, x: 0, y: 0, z: 0 },
      // Secondary glow further north, between the rest altar and the
      // stairs — guides the eye toward the egress.
      { kind: 'model', model: SAFE_FLOOR_GLOW_NORTH, x: 0, y: 0, z: 2.4 },
    ],

    torches: [
      // Six wall torches around the room. Warm tone everywhere except
      // the stair-side accent which gets a cool blue to mark the
      // descent (matches the moonbeam palette).
      { x: -5.95, z: -4.0, height: 2.4, wall: 'W', colorTint: 0xffb070, intensityMul: 0.95 },
      { x:  5.95, z: -4.0, height: 2.4, wall: 'E', colorTint: 0xffb070, intensityMul: 0.95 },
      { x: -5.95, z:  0.5, height: 2.4, wall: 'W', colorTint: 0xffa860, intensityMul: 1.0 },
      { x:  5.95, z:  0.5, height: 2.4, wall: 'E', colorTint: 0xffa860, intensityMul: 1.0 },
      // Stair-flanking torches — cool blue.
      { x: -5.95, z:  4.5, height: 2.4, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.75 },
      { x:  5.95, z:  4.5, height: 2.4, wall: 'E', colorTint: 0x88aaff, intensityMul: 0.75 },
    ],

    spawns: [],  // no enemies — this is the SAFE room
    doors: [],

    stairs: [
      {
        id: `stairs-${id}-down`,
        // Pulled away from the back wall — z=4.0 puts the stair's
        // back end at z=6.56, leaving 0.44m of buffer to the room's
        // back edge at z=7.0. No more "wall overhanging the stairs"
        // — the wall sits well past the descent.
        x: 0, z: 4.0,
        rotY: 0,
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
