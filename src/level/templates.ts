// Procgen template library.
//
// Each template is an ASCII grid (TileMap) PLUS some metadata (display
// name, room height, torch palette). Templates have 'X' slots that the
// procgen populator fills with depth-appropriate enemies, plus 'B' for
// the floor's boss.
//
// Authoring rules:
//   - 1 char = 1 cell = 1m in world space
//   - Every template MUST include 'S' (player spawn) + '/' (stairs)
//   - Wrap the playable area in '#' walls; perimeter walls are auto-added
//     but explicit '#' makes shape easier to read
//   - Use 'X' for generic enemy slots, 'B' for the floor's boss
//   - Torches: T (north wall), t (south), < (west), > (east) — mount on
//     the wall edge of the indicated direction; place on a cell adjacent
//     to a wall in that direction or on the perimeter. AT LEAST one torch
//     every 5-6 cells of player travel so the floor isn't pitch black —
//     fog hides anything more than ~6m from the player.
//
// Tile dictionary (see src/level/tilemap.ts for the canonical list):
//   #  wall      .  floor    S  player spawn   /  stairs DOWN
//   o  door      O  sealed door (clear room to open)
//   P  pillar    A  altar    c  chest          C  corpse
//   F  fountain  ^  spike trap
//   T  torch (N) t  torch (S)  <  torch (W)  >  torch (E)
//   G  ghoul     R  rat      K  skirmisher    W  wraith   X  random  B  boss

import type { TileMap } from './types';

export interface Template {
  name: string;
  map: TileMap;
  spawnYaw?: number;
  roomHeight?: number;
  torchTint?: number;
  /** Per-floor fog tint — distant darkness reads as this floor's
   *  atmosphere, not absence. Typically a darker mix of the torchTint. */
  fogColor?: number;
}

// ── T1: "The Old Refectory" ────────────────────────────────────────
// Wide chamber with pillar columns and torches at regular intervals.
// Player enters from the south facing north; the stairs are at the far
// end past the boss.
const REFECTORY: TileMap = [
  '####################',
  '#..T...T....T...T..#',
  '#.........../......#',
  '#..................#',
  '#..P............P..#',
  '#......B...........#',
  '#..T............T..#',
  '#............X.....#',
  '#..X..C...^........#',
  '#..T............T..#',
  '#..P.....F......P..#',
  '#..................#',
  '#......C....c......#',
  '#..T............T..#',
  '#..P............P..#',
  '#..................#',
  '#......S...........#',
  '####################',
];

// ── T2: "The Long Hall" ──────────────────────────────────────────────
// Narrow + linear. Threats unveil one at a time. Torches on alternating
// walls every few cells.
const LONG_HALL: TileMap = [
  '##############',
  '#..T.........#',
  '#............#',
  '#..P.....P...#',
  '#.........>..#',
  '#......X.....#',
  '#............#',
  '#..X.........#',
  '#......C..T..#',
  '#............#',
  '#..^.........#',
  '#.<..........#',
  '#.......F....#',
  '#............#',
  '#..P.....P...#',
  '#.........>..#',
  '#......B.....#',
  '#............#',
  '#...../......#',
  '#............#',
  '#..T...S.....#',
  '##############',
];

// ── T3: "The Pillar Maze" ─────────────────────────────────────────
// Forest of stone columns. Perception AI matters here — enemies can't
// see through the columns. Torches sparse to keep it ominous.
const PILLAR_MAZE: TileMap = [
  '####################',
  '#..T..T...T...T..T.#',
  '#..................#',
  '#.P.P.P.P.P.P.P.P..#',
  '#..................#',
  '#......X......X....#',
  '#.P.P.P.P.P.P.P.P..#',
  '#..T............T..#',
  '#..X.....B......X..#',
  '#..................#',
  '#.P.P.P.P.P.P.P.P..#',
  '#..T............T..#',
  '#..........C.......#',
  '#.P.P.P.P.P.P.P.P../',
  '#......F...........#',
  '#.P.P.P.P.P.P.P.P..#',
  '#..T............T..#',
  '#.........S........#',
  '####################',
];

// ── T4: "The Cistern" ────────────────────────────────────────────
// Cross-shaped — three connected rooms in a + layout. Traps in the
// central hub; spawn south arm, boss north arm.
const CISTERN: TileMap = [
  '######o######',
  '#....T......#',
  '#...........#',
  '#....c./....#',
  '#....C......#',
  '#..T......T.#',
  '#....B......#',
  '#####...#####',
  '#...........#',
  '#..^.....^..#',
  '#.<.F.....>.#',
  '#X.........X#',
  '#...........#',
  '#..^.....^..#',
  '#...........#',
  '#####...#####',
  '#..T..X..T..#',
  '#...........#',
  '#....S......#',
  '#...........#',
  '#....T......#',
  '#############',
];

export const TEMPLATES: Template[] = [
  { name: 'The Old Refectory', map: REFECTORY,   torchTint: 0xffaa55, fogColor: 0x140a05 },
  { name: 'The Long Hall',     map: LONG_HALL,   torchTint: 0xddc090, fogColor: 0x100c08 },
  { name: 'The Pillar Maze',   map: PILLAR_MAZE, torchTint: 0xa090ff, fogColor: 0x0a0815 },
  { name: 'The Cistern',       map: CISTERN,     torchTint: 0x66ccdd, fogColor: 0x05101a },
];
