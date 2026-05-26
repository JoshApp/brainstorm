// Tile-map level format.
//
// A floor is a 2D ASCII grid. Each character represents one 1m × 1m cell
// in the world. The parser converts a grid into a LevelSpec the existing
// builder consumes — so all the runtime (collision, doors, room-clear
// gating, stairs, etc.) keeps working.
//
// Grid orientation:
//   - Row 0 = north edge of the map  (z = -mapHeight/2 in world space)
//   - Last row = south edge          (z = +mapHeight/2)
//   - Column 0 = west edge           (x = -mapWidth/2)
//   - Last column = east edge        (x = +mapWidth/2)
//   - Cell center at world (x = col + 0.5 - mapWidth/2, z = row + 0.5 - mapHeight/2)
//
// Tile dictionary (extend as needed — every char maps to a TileKind):
//
//   #   wall
//   .   floor / corridor (walkable)
//   ,   corridor floor (currently same as '.' but kept for readability)
//   S   player spawn (cell is walkable; one allowed)
//   /   stairs DOWN cell (walkable; one allowed)
//   o   door cell (walkable when open; defaults closed)
//   O   door SEALED until room cleared (walkable when open)
//   P   pillar (obstacle)
//   A   altar (obstacle + visual)
//   c   chest (obstacle + visual + loot — random loot for procgen)
//   C   corpse (walkable, walk-up to read; note picked from a pool)
//   F   fountain (walkable, walk-up to drink)
//   ^   spike trap (walkable, hazard)
//   T   torch on the NORTH wall behind this cell
//   t   torch on the SOUTH wall ahead of this cell
//   <   torch on the WEST wall left of this cell
//   >   torch on the EAST wall right of this cell
//   G   ghoul spawn (walkable)
//   R   rat spawn (walkable)
//   K   skirmisher spawn (walkable)
//   W   wraith spawn (walkable)
//   space  treated as wall (so authors can omit perimeter quoting)

import type {
  LevelSpec, PropSpec, EnemySpawnSpec, TorchSpec, RoomSpec, DoorSpec, StairsSpec, TileMap,
} from './types';
import { ITEMS } from '../content/items';

// Pool of corpse notes. Procgen picks one per corpse-cell — deterministic
// via the seed if we extend the API to take a Random.
const CORPSE_NOTES = [
  'I came down to forget. The dungeon obliged.',
  'They told us it was one floor. They counted wrong.',
  'The water is not safe. Nothing here is.',
  'My name was almost a song once.',
  'If you find a blade that hums, leave it.',
];

export interface TileMapOptions {
  id: string;
  displayName?: string;
  /** Player spawn yaw in radians. Default 0 (facing -Z / north). */
  spawnYaw?: number;
  /** Default room height in meters. */
  roomHeight?: number;
  /** Color tint for the room's torches (applied to all torches in the map). */
  torchTint?: number;
  /**
   * Where do stairs go? Required if the map has a '/' tile. The id is
   * looked up in the LEVELS registry at descent time.
   */
  stairsTarget?: string;
  /** If set, props on stairs cells get this LevelSpec.id assigned. */
  floorId?: string;
}

// TileMap type exported from level/types.ts so both tilemap + procgen share.

// Tiles where the CELL is technically walkable for room-shape purposes
// (no auto-wall around them) — even though some place an obstacle inside
// the cell (pillar / altar / chest / fountain) that blocks movement.
// Authors who want a SOLID block of stone use '#'.
const FLOOR_CHARS = new Set('.,SoO/^FCGRKWPAcTt<>'.split(''));

/**
 * Parse a TileMap into a LevelSpec the existing buildLevel consumes.
 *
 * Walkable footprint:
 *   The parser computes a single bounding rectangle that covers the
 *   entire walkable area (everything that's NOT a wall). Then auto-
 *   places wall segments at every boundary between walkable + non-
 *   walkable cells. This keeps the WalkableRegion code unchanged but
 *   handles irregular shapes correctly via the wall segments.
 *
 *   For multi-room gating, callers can pass a roomMask map that assigns
 *   roomId to ranges of cells — but for V1, treat the whole floor as
 *   one "room" identified by levelId itself. Doors that gate on
 *   "cleared" use this single room id.
 */
export function parseTileMap(map: TileMap, opts: TileMapOptions): LevelSpec {
  const rows = map.length;
  const cols = Math.max(...map.map(r => r.length));
  const W = cols;
  const D = rows;
  const originX = -W / 2;
  const originZ = -D / 2;

  // Helper: world center of cell (col, row).
  const cellCenter = (col: number, row: number) => ({
    x: originX + col + 0.5,
    z: originZ + row + 0.5,
  });
  const cellChar = (col: number, row: number): string => {
    const r = map[row] ?? '';
    return r[col] ?? ' ';
  };
  const isFloor = (col: number, row: number): boolean => {
    return FLOOR_CHARS.has(cellChar(col, row));
  };

  // ── Room rect: single big bounding rect covering the map ──────────
  // (Walls inside it segment the space into "rooms" visually.)
  const room: RoomSpec = {
    id: 'main',
    rect: { x: 0, z: 0, w: W, d: D },
    height: opts.roomHeight ?? 3.2,
  };

  // ── Walls: emit a segment between every walkable/non-walkable
  // adjacency. ────────────────────────────────────────────────────
  // Horizontal walls (running along X at z = fixed):
  //   For each row, scan adjacent cells UP/DOWN. Where a floor cell
  //   meets a wall cell vertically, emit a wall segment along the
  //   shared edge (1m long, axis-aligned).
  // Vertical walls (running along Z at x = fixed):
  //   Same but for left/right adjacencies.
  // We accumulate runs of same-edge into longer segments for fewer
  // physics queries, but if you don't want that optimization, each
  // boundary cell can emit a 1m segment.

  type Seg = { ax: number; az: number; bx: number; bz: number };
  const walls: Seg[] = [];

  // Build sets of "wall edges" per kind. Each edge is (cellRow, colStart..colEnd, z)
  // or (cellCol, rowStart..rowEnd, x). Then we MERGE adjacent edges.
  // ── Horizontal edges (running along X) ─────────────────────────
  // Between row r and row r-1, edge z = originZ + r. The edge exists
  // for any col where cell(col, r) and cell(col, r-1) have different
  // walkability AND at least one is walkable (perimeter walls included).
  for (let r = 0; r <= rows; r++) {
    let runStart: number | null = null;
    for (let c = 0; c <= cols; c++) {
      const above = r > 0 ? isFloor(c, r - 1) : false;
      const below = r < rows ? isFloor(c, r) : false;
      const isEdge = above !== below;
      if (isEdge) {
        if (runStart === null) runStart = c;
      } else if (runStart !== null) {
        walls.push({
          ax: originX + runStart, az: originZ + r,
          bx: originX + c,        bz: originZ + r,
        });
        runStart = null;
      }
    }
  }
  // ── Vertical edges (running along Z) ───────────────────────────
  for (let c = 0; c <= cols; c++) {
    let runStart: number | null = null;
    for (let r = 0; r <= rows; r++) {
      const left  = c > 0 ? isFloor(c - 1, r) : false;
      const right = c < cols ? isFloor(c, r) : false;
      const isEdge = left !== right;
      if (isEdge) {
        if (runStart === null) runStart = r;
      } else if (runStart !== null) {
        walls.push({
          ax: originX + c, az: originZ + runStart,
          bx: originX + c, bz: originZ + r,
        });
        runStart = null;
      }
    }
  }

  // ── Per-cell features ───────────────────────────────────────────
  const props: PropSpec[] = [];
  const spawns: EnemySpawnSpec[] = [];
  const torches: TorchSpec[] = [];
  const doors: DoorSpec[] = [];
  const stairs: StairsSpec[] = [];
  let startPos = { x: 0, z: 0, yaw: opts.spawnYaw ?? 0 };
  let noteIndex = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = cellChar(c, r);
      const { x, z } = cellCenter(c, r);
      switch (ch) {
        case 'S': {
          startPos = { x, z, yaw: opts.spawnYaw ?? 0 };
          break;
        }
        case 'P': {
          props.push({ kind: 'pillar', x, z });
          break;
        }
        case 'A': {
          props.push({ kind: 'altar', x, z });
          break;
        }
        case 'c': {
          // Pseudo-random loot — pick something useful but not headline.
          props.push({ kind: 'chest', x, z, loot: ITEMS['healing-potion'] });
          break;
        }
        case 'C': {
          props.push({
            kind: 'corpse', x, z, rotY: Math.random() * Math.PI * 2,
            note: CORPSE_NOTES[(noteIndex++) % CORPSE_NOTES.length],
          });
          break;
        }
        case 'F': {
          props.push({ kind: 'fountain', x, z });
          break;
        }
        case '^': {
          props.push({ kind: 'spike-trap', x, z, damage: 2 });
          break;
        }
        case 'T':
        case 't':
        case '<':
        case '>': {
          // Torch on a specific wall edge of this cell.
          const wall: 'N' | 'S' | 'W' | 'E' =
            ch === 'T' ? 'N' :
            ch === 't' ? 'S' :
            ch === '<' ? 'W' : 'E';
          // Position the torch FLUSH against that wall edge so it
          // visually mounts on a wall plane.
          const tx = wall === 'W' ? x - 0.499 : wall === 'E' ? x + 0.499 : x;
          const tz = wall === 'N' ? z - 0.499 : wall === 'S' ? z + 0.499 : z;
          torches.push({
            x: tx, z: tz,
            height: 2.2,
            wall,
            colorTint: opts.torchTint,
            intensityMul: 0.95,
          });
          break;
        }
        case 'G': spawns.push({ enemyId: 'ghoul',      x, z, roomId: 'main' }); break;
        case 'R': spawns.push({ enemyId: 'rat',        x, z, roomId: 'main' }); break;
        case 'K': spawns.push({ enemyId: 'skirmisher', x, z, roomId: 'main' }); break;
        case 'W': spawns.push({ enemyId: 'wraith',     x, z, roomId: 'main' }); break;
        case '/': {
          if (opts.stairsTarget) {
            stairs.push({
              id: `stairs-${opts.id}`,
              x, z, rotY: 0,
              targetLevel: opts.stairsTarget,
            });
          }
          break;
        }
        case 'o':
        case 'O': {
          // Door at this cell. The door SPAN is along the perpendicular
          // axis — we pick based on neighbors: if cells E/W of this are
          // walls and N/S are walkable, the door runs E↔W.
          const nIsFloor = isFloor(c, r - 1);
          const sIsFloor = isFloor(c, r + 1);
          const ew = nIsFloor && sIsFloor;  // door swings E↔W
          const doorRect = ew
            ? { ax: x - 0.5, az: z, bx: x + 0.5, bz: z }
            : { ax: x, az: z - 0.5, bx: x, bz: z + 0.5 };
          doors.push({
            id: `door-${c}-${r}`,
            ax: doorRect.ax, az: doorRect.az,
            bx: doorRect.bx, bz: doorRect.bz,
            height: 2.6,
            hinge: 'a',
            swingDir: 1,
            unlock: ch === 'O' ? { kind: 'cleared', roomIds: ['main'] } : undefined,
          });
          break;
        }
      }
    }
  }

  // Wall segments are the auto-detected boundaries between walkable and
  // non-walkable cells (perimeter + interior '#' walls). The bounding
  // rect's auto-perimeter would duplicate the outer walls; trim those
  // out by detecting segments that lie exactly on the rect's edge.
  const halfW = W / 2;
  const halfD = D / 2;
  const onRectEdge = (s: { ax: number; az: number; bx: number; bz: number }) => {
    const EPS = 1e-3;
    // Horizontal segment along an X-aligned edge
    if (Math.abs(s.az - s.bz) < EPS) {
      return Math.abs(Math.abs(s.az) - halfD) < EPS;
    }
    // Vertical segment along a Z-aligned edge
    return Math.abs(Math.abs(s.ax) - halfW) < EPS;
  };
  const extraWalls = walls
    .filter(s => !onRectEdge(s))
    .map(s => ({ ...s, height: room.height }));

  return {
    id: opts.id,
    displayName: opts.displayName,
    startPos,
    rooms: [room],
    corridors: [],
    props,
    torches,
    spawns,
    doors,
    stairs,
    extraWalls,
  };
}
