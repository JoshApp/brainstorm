import type { LevelSpec } from './types';
import { SCIMITAR_RELIC } from '../content/relics';
import { FLOOR_CANDLE } from '../content/candle';
import { MOONLIGHT_CRACK, floorGlow } from '../content/light-props';
import { ITEMS } from '../content/items';

const CORRIDOR_FLOOR_GLOW = floorGlow(0x6cc6e0);    // cool cyan — corridor transition
const ANTE_FLOOR_GLOW     = floorGlow(0x6cffa0);    // sickly green — antechamber palette

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
      loot: ITEMS.scimitar,
    },

    // FLOOR CANDLES — ankle-level light sources flanking the altar. Casts
    // upward-warm-light on nearby pillars; reads as votive offering.
    { kind: 'model', model: FLOOR_CANDLE, x: -0.9, y: 0, z: -2.6 },
    { kind: 'model', model: FLOOR_CANDLE, x:  0.9, y: 0, z: -2.6 },
    // Two more candles inside the corridor to provide floor-level light along
    // the path. Tight light cones; create dramatic shadow drama on the walls.
    { kind: 'model', model: FLOOR_CANDLE, x:  0.6, y: 0, z: 5.0 },
    { kind: 'model', model: FLOOR_CANDLE, x: -0.6, y: 0, z: 7.5 },

    // --- COOL LIGHT ACCENTS — Floor 1 palette pass ---
    // The whole dungeon was previously ochre-on-ochre (warm ambient + warm
    // torches). These three coloured-light fixtures introduce a per-room
    // palette: warm chamber, transitional-cyan corridor, sickly-green
    // antechamber. The eye reads each room as its own place.

    // MOONLIGHT CRACK on the chamber's east wall — a vertical glowing slit
    // implying light bleeding through cracked masonry from somewhere outside.
    // Cold pale-blue, casts onto the east half of the chamber so the room
    // has warm/cold contrast (north torch + altar candles are warm; east
    // wall is touched by cool moonlight).
    { kind: 'model', model: MOONLIGHT_CRACK, x: 3.99, y: 1.5, z: -0.5, rotY: -Math.PI / 2 },

    // CYAN FLOOR GLOW in the corridor mid-way — luminous fungus or a
    // cracked floor stone with cold light leaking through. Pairs with the
    // corridor candles to give the corridor a warm+cool split palette.
    { kind: 'model', model: CORRIDOR_FLOOR_GLOW, x: 0, y: 0, z: 6.25 },

    // GREEN FLOOR GLOW in the antechamber — reinforces the haunted-green
    // tint of the antechamber's torch with a floor-level source. Sickly,
    // unhealthy, alien green.
    { kind: 'model', model: ANTE_FLOOR_GLOW, x: 0, y: 0, z: 11 },
  ],

  torches: [
    // Chamber — north wall, the one the player faces at spawn. Warm orange,
    // full intensity; the "main fire" of the chamber.
    { x: 0, z: -3.85, height: 2.2, wall: 'N', colorTint: 0xffaa55, intensityMul: 1.0 },
    // Chamber — south wall, offset west of the corridor doorway. Paler /
    // cooler so the two ends of the room have visual contrast.
    { x: -2.5, z: 3.85, height: 2.2, wall: 'S', colorTint: 0xddc090, intensityMul: 0.85 },
    // Chamber — south wall, offset east of the corridor doorway. Same color
    // family; symmetry around the doorway.
    { x:  2.5, z: 3.85, height: 2.2, wall: 'S', colorTint: 0xddc090, intensityMul: 0.85 },

    // Corridor has no wall torch — floor candles provide its light (see props).
    // Creates a "the candlelit path" feel from chamber to antechamber.

    // Antechamber — east wall. Saturated sickly-green: the room's palette
    // pillar. Strongly tinted so the antechamber doesn't just feel "less
    // warm than the chamber" but actively HAUNTED. Matches the green floor
    // glow underneath; together they paint the whole antechamber green.
    { x: 2.85, z: 11, height: 2.0, wall: 'E', colorTint: 0x70e090, intensityMul: 1.0 },
  ],

  spawns: [
    // Slow heavy hitter directly ahead — the primary fight, visible at spawn.
    // BUG FIX: previously at z=-2.0 which overlaps the altar's collision
    // circle (altar at z=-2.8 has combined collision radius 1.1m with the
    // ghoul's 0.45m radius). Ghoul got stuck unable to move. Now at z=-1.2,
    // well clear of the altar, free to chase.
    { enemyId: 'ghoul', x: 0, z: -1.2 },
    // Skirmisher hangs further back to the east — engages AFTER the ghoul is
    // in range, so the player isn't sandwiched at spawn.
    { enemyId: 'skirmisher', x: 2.6, z: -2.6 },
    // Rat starts at the back of the room (south side, behind the player at
    // spawn). It has to traverse the chamber to engage, giving the player
    // time to deal with the ghoul first.
    { enemyId: 'rat', x: -2.5, z: 3.0 },
  ],
};
