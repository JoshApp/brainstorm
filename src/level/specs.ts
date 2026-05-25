import type { LevelSpec } from './types';
import { SCIMITAR_RELIC } from '../content/relics';
import { FLOOR_CANDLE } from '../content/candle';
import type { ModelSpec } from '../ecs/model-types';

// Decal-as-prop helper. A decal is a flat textured plane oriented in world
// space. We wrap it as a ModelSpec with a single 'decal' part so it slots
// into the existing 'model' prop kind without adding a new prop type.
function decalModel(id: string, texture: string, size: [number, number], color = 0xffffff): ModelSpec {
  return {
    id,
    materials: {},
    parts: [
      { name: 'decal', kind: 'decal', size, texture, color },
    ],
  };
}

const MOSS_WALL_SMALL = decalModel('moss-wall-sm', 'moss-patch', [0.7, 0.5]);
const MOSS_WALL_LARGE = decalModel('moss-wall-lg', 'moss-patch', [1.1, 0.8]);
const MOSS_FLOOR      = decalModel('moss-floor',   'moss-patch', [1.0, 1.0], 0xa0b070);
const BLOOD_FLOOR     = decalModel('blood-floor',  'blood-splatter', [0.9, 0.9]);
const SOOT_WALL       = decalModel('soot-wall',    'soot-streak', [0.55, 1.4]);

// Hand-authored level 1 — the current ritual chamber, expressed as data.
// Once we trust this format, procgen and additional floors just produce more
// LevelSpecs.

// LEVEL_1: two connected rooms.
//
//   ┌──────────────┐     ╔═══ ritual chamber ═══╗
//   │   chamber    │     ║    (player spawn)    ║
//   │              │     ║       8 × 8          ║
//   │   8 × 8      │     ╚═══════ □  ═══════════╝   ← S side has an opening
//   │              │             │ │                 (door to corridor)
//   └─door──door───┘             │ │
//   ┌──┴──corridor────────────┐  │ │
//   │  2 × 4                  │  ▼ ▼
//   └─door──door──────────────┘  ← corridor connects S of chamber to N of antechamber
//   ┌─door──door──────────────┐
//   │    antechamber          │
//   │       6 × 5             │
//   └─────────────────────────┘
//
// World coordinates: chamber at (0, 0), corridor at (0, 6), antechamber at (0, 11).
// Their shared edges have openings auto-computed by the wall-segmenter.

export const LEVEL_1: LevelSpec = {
  id: 'depth-1',

  startPos: { x: 0, z: 0, yaw: 0 }, // spawn center of chamber, facing -Z (north)

  rooms: [
    {
      id: 'ritual-chamber',
      rect: { x: 0, z: 0, w: 8, d: 8 },
      height: 3.2,
    },
    {
      // Smaller adjacent room — the "antechamber" reached via the corridor.
      // Currently empty atmosphere — to be filled with more content later.
      id: 'antechamber',
      rect: { x: 0, z: 11, w: 6, d: 5 },
      height: 3.0,
    },
  ],

  corridors: [
    // Corridor connecting chamber south wall (z=4) to antechamber north wall
    // (z=8.5). Width 2m, depth 4.5m, centered at (0, 6.25).
    {
      id: 'corridor-1',
      rect: { x: 0, z: 6.25, w: 2, d: 4.5 },
      height: 2.6,  // lower ceiling than rooms — more claustrophobic
    },
  ],

  props: [
    { kind: 'pillar', x: -1.8, z: -2.2 },
    { kind: 'pillar', x: 1.8, z: -2.2 },
    { kind: 'pillar', x: -1.8, z: 2.2 },
    { kind: 'pillar', x: 1.8, z: 2.2 },
    { kind: 'altar', x: 0, z: -2.8 },
    // SCIMITAR RELIC laid across the altar top.
    {
      kind: 'model',
      model: SCIMITAR_RELIC,
      x: 0, y: 0.56, z: -2.78,
      rotX: -Math.PI / 2,
      rotY: 0.6,
    },
    // CHEST in the south-WEST of the chamber, off the line between spawn and
    // the corridor doorway (so the player can navigate to either without
    // bumping into the chest).
    {
      kind: 'chest',
      x: -2.2, z: 2.6,
      rotY: -Math.PI * 0.7,
      loot: SCIMITAR_RELIC,
    },

    // FLOOR CANDLES — ankle-level light sources for atmosphere. Cast
    // upward-warm-light on nearby pillars + altar. Placed in pairs flanking
    // the altar like a votive offering.
    { kind: 'model', model: FLOOR_CANDLE, x: -0.9, y: 0, z: -2.6 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.9, y: 0, z: -2.6 },

    // DECALS — sprite-textured planes oriented in world space. Break up the
    // uniform stone with moss patches, old blood stains, soot above torches.
    // Y for floor decals = 0.01 (just above floor to avoid z-fight).
    // Rotation for floor: -PI/2 around X. For walls: face into room.

    // Moss on the floor near the south-east pillar
    { kind: 'model', model: MOSS_FLOOR, x: 1.8, y: 0.012, z: 1.8, rotX: -Math.PI / 2 },
    // Moss on the floor under the north-west pillar
    { kind: 'model', model: MOSS_FLOOR, x: -2.4, y: 0.012, z: -1.4, rotX: -Math.PI / 2, rotY: 0.4 },

    // Old blood stain in front of the altar — the ritual fight's history
    { kind: 'model', model: BLOOD_FLOOR, x: -0.3, y: 0.013, z: -1.3, rotX: -Math.PI / 2, rotY: 1.2 },
    // Another smaller stain off to the east
    { kind: 'model', model: BLOOD_FLOOR, x: 1.5, y: 0.013, z: -0.4, rotX: -Math.PI / 2 },

    // Moss climbing the north wall (above where the altar sits)
    { kind: 'model', model: MOSS_WALL_LARGE, x: -1.2, y: 1.0, z: -3.99, rotY: 0 },
    { kind: 'model', model: MOSS_WALL_SMALL, x:  1.4, y: 1.4, z: -3.99, rotY: 0 },

    // Moss on the south wall
    { kind: 'model', model: MOSS_WALL_SMALL, x: -2.0, y: 1.2, z:  3.99, rotY: Math.PI },

    // Soot streak above the north torch from years of flame
    { kind: 'model', model: SOOT_WALL, x: 0, y: 2.85, z: -3.99, rotY: 0 },
    // Soot above the offset south torches (skip soot above the corridor doorway)
    { kind: 'model', model: SOOT_WALL, x: -2.5, y: 2.85, z:  3.99, rotY: Math.PI },
    { kind: 'model', model: SOOT_WALL, x:  2.5, y: 2.85, z:  3.99, rotY: Math.PI },
  ],

  torches: [
    // Chamber — north wall, the one the player faces at spawn. Warm orange,
    // full intensity; the "main fire" of the chamber.
    { x: 0, z: -3.6, height: 2.2, wall: 'N', colorTint: 0xffaa55, intensityMul: 1.0 },
    // Chamber — south wall, offset west of the corridor doorway. Paler /
    // cooler so the two ends of the room have visual contrast.
    { x: -2.5, z: 3.6, height: 2.2, wall: 'S', colorTint: 0xddc090, intensityMul: 0.85 },
    // Chamber — south wall, offset east of the corridor doorway. Same color
    // family; symmetry around the doorway.
    { x:  2.5, z: 3.6, height: 2.2, wall: 'S', colorTint: 0xddc090, intensityMul: 0.85 },

    // Corridor — west wall, midpoint. A single dim torch creates a "down the
    // dark hall" feel — the player sees it from chamber south door.
    { x: -0.6, z: 6.25, height: 1.9, wall: 'W', colorTint: 0xaa6633, intensityMul: 0.55 },

    // Antechamber — east wall, with a haunted pale-green tint. Different room,
    // different fire. Cue that the player has entered new territory.
    { x: 2.5, z: 11, height: 2.0, wall: 'E', colorTint: 0xa0d0b0, intensityMul: 0.75 },
  ],

  spawns: [
    // Slow heavy hitter directly ahead — the primary fight, visible at spawn.
    // Player faces this one first; the ritual altar lies just behind it.
    { enemyId: 'ghoul', x: 0, z: -2.0 },
    // Skirmisher hangs further back behind a pillar — engages AFTER the ghoul
    // is in range, so the player isn't sandwiched at spawn.
    { enemyId: 'skirmisher', x: 2.5, z: -3.0 },
    // Rat starts at the back of the room (south side, behind the player at
    // spawn). It has to traverse the chamber to engage, giving the player
    // time to deal with the ghoul first.
    { enemyId: 'rat', x: -2.5, z: 3.0 },
  ],
};
