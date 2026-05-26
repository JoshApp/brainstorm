import type { LevelSpec } from './types';
import { SCIMITAR_RELIC } from '../content/relics';
import { FLOOR_CANDLE } from '../content/candle';
import { MOONLIGHT_CRACK, floorGlow } from '../content/light-props';
import { ITEMS } from '../content/items';

const CORRIDOR_FLOOR_GLOW = floorGlow(0x6cc6e0);    // cool cyan — corridor transition
const ANTE_FLOOR_GLOW     = floorGlow(0x6cffa0);    // sickly green — antechamber palette
const CRYPT_FLOOR_GLOW    = floorGlow(0xff3a20);    // hot red — crypt palette

// ─── LEVEL 1: ritual chamber → corridor → antechamber → stairwell ─────
//
//   ┌──── ritual-chamber ────┐
//   │  spawn, 3 enemies      │
//   │  altar + chest         │
//   │     8 × 8              │
//   └────── DOOR ────────────┘    ← sealed until chamber cleared
//          │ corridor │
//          │ 2 × 4.5  │
//   ┌──────└──────────┘─────┐
//   │     antechamber       │
//   │  wraith (magic boss)  │
//   │     6 × 5             │
//   └────── DOOR ───────────┘    ← sealed until antechamber cleared
//          │ stairwell │
//          │  3 × 2    │
//          │ STAIRS ↓  │
//          └───────────┘    → LEVEL_2
//
// All coordinates in world XZ. Doors live as wall segments that the door
// system adds/removes from the walkable region.

export const LEVEL_1: LevelSpec = {
  id: 'depth-1',
  displayName: 'I — The Ritual Chamber',

  startPos: { x: 0, z: 0, yaw: 0 }, // spawn center of chamber, facing -Z (north)

  rooms: [
    {
      id: 'ritual-chamber',
      rect: { x: 0, z: 0, w: 8, d: 8 },
      height: 3.2,
    },
    {
      id: 'antechamber',
      rect: { x: 0, z: 11, w: 6, d: 5 },
      height: 3.0,
    },
    {
      // Small stairwell beyond the antechamber. Holds the descent stairs.
      // Lower ceiling, smaller footprint — feels like a service tunnel.
      // z=14.5 with d=2 → north edge at z=13.5, matching antechamber south.
      id: 'stairwell',
      rect: { x: 0, z: 14.5, w: 3, d: 2 },
      height: 2.4,
    },
  ],

  corridors: [
    {
      id: 'corridor-1',
      rect: { x: 0, z: 6.25, w: 2, d: 4.5 },
      height: 2.6,
    },
  ],

  // Doors gate progression. The wall-segmenter already leaves a gap where
  // rooms abut; the door geometry plugs that gap until unlocked.
  doors: [
    {
      // Chamber south → corridor north. Shared edge at z=4, x in [-1, 1].
      id: 'chamber-to-corridor',
      ax: -1, az: 4,
      bx:  1, bz: 4,
      height: 2.6,
      hinge: 'a',
      swingDir: 1,
      unlock: { kind: 'cleared', roomIds: ['ritual-chamber'] },
    },
    {
      // Antechamber south → stairwell north. Shared edge at z=13.5, x in [-1.5, 1.5].
      id: 'antechamber-to-stairwell',
      ax: -1.5, az: 13.5,
      bx:  1.5, bz: 13.5,
      height: 2.4,
      hinge: 'a',
      swingDir: 1,
      unlock: { kind: 'cleared', roomIds: ['antechamber'] },
    },
  ],

  stairs: [
    {
      id: 'stairs-down-1',
      // Top tread inside stairwell; descends south toward back wall.
      // Stairwell z range: 13.5 to 15.5. Stairs top at z=14.0; 4 steps of
      // depth 0.34 = 1.36m of horizontal extent, bottom at z=15.36 — just
      // inside the back wall. Reads as "descend into the wall".
      x: 0, z: 14.0,
      rotY: 0,
      targetLevel: 'depth-2',
    },
  ],

  props: [
    { kind: 'pillar', x: -1.8, z: -2.2 },
    { kind: 'pillar', x: 1.8, z: -2.2 },
    { kind: 'pillar', x: -1.8, z: 2.2 },
    { kind: 'pillar', x: 1.8, z: 2.2 },
    { kind: 'altar', x: 0, z: -2.8 },
    {
      kind: 'model',
      model: SCIMITAR_RELIC,
      x: 0, y: 0.56, z: -2.78,
      rotX: -Math.PI / 2,
      rotY: 0.6,
    },
    {
      kind: 'chest',
      x: -2.2, z: 2.6,
      rotY: -Math.PI * 0.7,
      loot: ITEMS.scimitar,
    },

    { kind: 'model', model: FLOOR_CANDLE, x: -0.9, y: 0, z: -2.6 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.9, y: 0, z: -2.6 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.6, y: 0, z: 5.0 },
    { kind: 'model', model: FLOOR_CANDLE, x: -0.6, y: 0, z: 7.5 },

    { kind: 'model', model: MOONLIGHT_CRACK, x: 3.99, y: 1.5, z: -0.5, rotY: -Math.PI / 2 },
    { kind: 'model', model: CORRIDOR_FLOOR_GLOW, x: 0, y: 0, z: 6.25 },
    { kind: 'model', model: ANTE_FLOOR_GLOW, x: 0, y: 0, z: 11 },
  ],

  torches: [
    { x: 0, z: -3.85, height: 2.2, wall: 'N', colorTint: 0xffaa55, intensityMul: 1.0 },
    { x: -2.5, z: 3.85, height: 2.2, wall: 'S', colorTint: 0xddc090, intensityMul: 0.85 },
    { x:  2.5, z: 3.85, height: 2.2, wall: 'S', colorTint: 0xddc090, intensityMul: 0.85 },
    { x: 2.85, z: 11, height: 2.0, wall: 'E', colorTint: 0x70e090, intensityMul: 1.0 },
    // Stairwell — a dim warning lamp at the entrance to "the deeper dungeon".
    { x: -1.4, z: 14.5, height: 1.8, wall: 'W', colorTint: 0x88aaff, intensityMul: 0.7 },
  ],

  spawns: [
    // ── Chamber: three enemies that gate the first door ───────────────
    { enemyId: 'ghoul',      x: 0,    z: -1.2, roomId: 'ritual-chamber' },
    { enemyId: 'skirmisher', x: 2.6,  z: -2.6, roomId: 'ritual-chamber' },
    { enemyId: 'rat',        x: -2.5, z:  3.0, roomId: 'ritual-chamber' },
    // ── Antechamber: the wraith gates the second door (to stairwell) ──
    { enemyId: 'wraith',     x: 0,    z: 12.3, roomId: 'antechamber' },
  ],
};

// ─── LEVEL 2: the blood crypt ─────────────────────────────────────────
//
// Single larger chamber with a different palette (hot red — votive blood
// chamber). Two enemies pre-positioned to flank the player from cover; a
// chest at the far end with a fresh loot pick. Dead-end stairs for now —
// LEVEL_3 will continue when we build it.

export const LEVEL_2: LevelSpec = {
  id: 'depth-2',
  displayName: 'II — The Blood Crypt',

  // Spawn is at one end of the room — the player walks into the crypt
  // facing the altar/chest at the far end.
  startPos: { x: 0, z: -4, yaw: 0 },

  rooms: [
    {
      id: 'crypt',
      rect: { x: 0, z: 0, w: 10, d: 10 },
      height: 3.4,
    },
  ],
  corridors: [],

  props: [
    // Four pillars near the entrance form a colonnade. Player navigates
    // between them; enemies can ambush from behind.
    { kind: 'pillar', x: -2.6, z: -2.0, size: 0.6 },
    { kind: 'pillar', x:  2.6, z: -2.0, size: 0.6 },
    { kind: 'pillar', x: -2.6, z:  1.0, size: 0.6 },
    { kind: 'pillar', x:  2.6, z:  1.0, size: 0.6 },
    // Altar at the far end — visual anchor + chest beside it.
    { kind: 'altar', x: 0, z: 3.6 },
    {
      kind: 'chest',
      x: 1.8, z: 3.6,
      rotY: -Math.PI / 2,
      loot: ITEMS['bone-amulet'],
    },
    // Floor candles flanking the altar (matches the chamber's ritual feel
    // but in a more brutal register).
    { kind: 'model', model: FLOOR_CANDLE, x: -0.9, y: 0, z: 3.4 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.9, y: 0, z: 3.4 },
    // RED FLOOR GLOW at the center of the room — hot blood-ember palette.
    // Distinguishes Level 2 instantly from Level 1's warm/cool/green mix.
    { kind: 'model', model: CRYPT_FLOOR_GLOW, x: 0, y: 0, z: 0 },
  ],

  torches: [
    // Hot red-orange torches all around. Saturated, oppressive — the room
    // ITSELF feels angry. No cool accents — this floor is mono-temperature.
    { x: 0,    z: -4.85, height: 2.4, wall: 'N', colorTint: 0xff5530, intensityMul: 1.0 },
    { x: 0,    z:  4.85, height: 2.4, wall: 'S', colorTint: 0xff7040, intensityMul: 0.9 },
    { x: -4.85, z: -1.5, height: 2.4, wall: 'W', colorTint: 0xff6035, intensityMul: 0.85 },
    { x:  4.85, z:  1.5, height: 2.4, wall: 'E', colorTint: 0xff6035, intensityMul: 0.85 },
  ],

  spawns: [
    // Ambush layout: two enemies BEHIND the colonnade so they're not
    // visible on entry. Player walks in, gets to the pillars, mobs flank.
    { enemyId: 'ghoul',      x: -3.2, z:  2.5, roomId: 'crypt' },
    { enemyId: 'skirmisher', x:  3.2, z:  2.5, roomId: 'crypt' },
    // Rat in the center for movement variety — closes immediately,
    // forces the player to split attention.
    { enemyId: 'rat',        x:  0,   z:  0.5, roomId: 'crypt' },
  ],

  // No stairs yet — LEVEL_2 is the dead-end for now. Future floors plug
  // their id here.
};

// Registry. The level loader looks up targetLevel against this map.
export const LEVELS: Record<string, LevelSpec> = {
  'depth-1': LEVEL_1,
  'depth-2': LEVEL_2,
};
