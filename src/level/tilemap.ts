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
//   Y   acolyte spawn (walkable) — ranged caster
//   space  treated as wall (so authors can omit perimeter quoting)

import type {
  LevelSpec, PropSpec, EnemySpawnSpec, TorchSpec, RoomSpec, DoorSpec, StairsSpec, TileMap,
} from './types';
import { ITEMS } from '../content/items';
import { STAIRWELL_TOTAL_DEPTH } from '../interactables/stairs';

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
  /**
   * Optional world-space offset applied to every position the parser
   * produces. By default the map is centred on world origin (its
   * (cols, rows) midpoint sits at (0, 0)); with an offset the SAME map
   * is positioned at that offset instead. Used by the vault composer
   * to stitch multiple maps into one floor.
   */
  offsetX?: number;
  offsetZ?: number;
  /** Override the room id assigned to spawns + the produced RoomSpec.
   *  Defaults to 'main' for single-map floors. */
  roomId?: string;
}

// TileMap type exported from level/types.ts so both tilemap + procgen share.

// Tiles where the CELL is technically walkable for room-shape purposes
// (no auto-wall around them) — even though some place an obstacle inside
// the cell (pillar / altar / chest / fountain) that blocks movement.
// Authors who want a SOLID block of stone use '#'.
const FLOOR_CHARS = new Set('.,SoO/^FCGRKWYPAcTt<>'.split(''));

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
  const offsetX = opts.offsetX ?? 0;
  const offsetZ = opts.offsetZ ?? 0;
  const originX = -W / 2 + offsetX;
  const originZ = -D / 2 + offsetZ;
  const roomId = opts.roomId ?? 'main';
  // The room RECT shrinks by 1m on each side so its perimeter aligns
  // with the parser-emitted inner walls (the ones at the floor/'#'
  // boundary). Without this, the rect extended a full cell PAST those
  // walls — giving each room a 1m thick "dead zone" between outer
  // rect and inner walls where the player could end up trapped. The
  // shrunken rect IS the walkable area; buildRoomShell will build
  // perimeter walls + open them where corridors abut, and the parser
  // skips its perimeter walls (handled below) to avoid double walls.
  const innerW = Math.max(0, W - 2);
  const innerD = Math.max(0, D - 2);

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
    id: roomId,
    rect: { x: offsetX, z: offsetZ, w: innerW, d: innerD },
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
          // Auto-orient so the back of the chest sits AGAINST a
          // nearby wall, lid swings forward into the open room.
          // Chest's local -Z is the back / hinge edge; the
          // rotations below put -Z toward the named wall.
          let chestRotY = 0;
          const wallN = !isFloor(c, r - 1);
          const wallS = !isFloor(c, r + 1);
          const wallE = !isFloor(c + 1, r);
          const wallW = !isFloor(c - 1, r);
          // Prefer the wall that's exactly adjacent if there's
          // only one; otherwise pick by priority N → S → E → W.
          if      (wallN && !wallS) chestRotY = 0;
          else if (wallS && !wallN) chestRotY = Math.PI;
          else if (wallE && !wallW) chestRotY = -Math.PI / 2;
          else if (wallW && !wallE) chestRotY = Math.PI / 2;
          else if (wallN)           chestRotY = 0;
          else if (wallS)           chestRotY = Math.PI;
          else if (wallE)           chestRotY = -Math.PI / 2;
          else if (wallW)           chestRotY = Math.PI / 2;
          props.push({ kind: 'chest', x, z, rotY: chestRotY, loot: ITEMS['healing-potion'] });
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
          // Torch on a specific wall edge of this cell. The
          // character names a side, but several vaults in the
          // library use 'T' (north) on cells whose north neighbour
          // is interior floor — that puts the torch FLOATING in
          // the middle of the room. We auto-correct: if the named
          // side has no wall (the next cell is floor), fall back
          // to whichever adjacent side IS a wall.
          const requested: 'N' | 'S' | 'W' | 'E' =
            ch === 'T' ? 'N' :
            ch === 't' ? 'S' :
            ch === '<' ? 'W' : 'E';
          const opp = (s: 'N' | 'S' | 'W' | 'E'): 'N' | 'S' | 'W' | 'E' =>
            s === 'N' ? 'S' : s === 'S' ? 'N' : s === 'W' ? 'E' : 'W';
          const sideIsWall = (s: 'N' | 'S' | 'W' | 'E') => {
            const nr = s === 'N' ? r - 1 : s === 'S' ? r + 1 : r;
            const nc = s === 'W' ? c - 1 : s === 'E' ? c + 1 : c;
            return !isFloor(nc, nr);
          };
          // Try requested → opposite → perpendicular sides.
          const order: Array<'N' | 'S' | 'W' | 'E'> = [
            requested, opp(requested),
            ...(requested === 'N' || requested === 'S'
              ? (['W', 'E'] as const)
              : (['N', 'S'] as const)),
          ];
          const wall = order.find(sideIsWall);
          if (!wall) break;     // truly interior cell, no wall on any side
          // Offset the torch position ~0.18m INTO the room from
          // the wall plane (which sits 0.5m off the cell centre
          // toward the wall direction). The torch model's sconce
          // arm extends 0.2m+ along -Z in local space, so this
          // offset puts the back of the arm just past the wall
          // surface (hidden in the wall material) while the bowl
          // / candle / flame sit forward in the room. Without the
          // offset the bowl's mid-radius landed inside the wall
          // plane — "torch stuck halfway in the wall".
          const WALL_OFFSET = 0.32;   // = 0.5 (wall pos) - 0.18 (clearance)
          const tx = wall === 'W' ? x - WALL_OFFSET : wall === 'E' ? x + WALL_OFFSET : x;
          const tz = wall === 'N' ? z - WALL_OFFSET : wall === 'S' ? z + WALL_OFFSET : z;
          torches.push({
            x: tx, z: tz,
            height: 2.2,
            wall,
            colorTint: opts.torchTint,
            intensityMul: 0.95,
          });
          break;
        }
        case 'G': spawns.push({ enemyId: 'ghoul',      x, z, roomId }); break;
        case 'R': spawns.push({ enemyId: 'rat',        x, z, roomId }); break;
        case 'K': spawns.push({ enemyId: 'skirmisher', x, z, roomId }); break;
        case 'W': spawns.push({ enemyId: 'wraith',     x, z, roomId }); break;
        case 'Y': spawns.push({ enemyId: 'acolyte',    x, z, roomId }); break;
        case '/': {
          if (opts.stairsTarget) {
            // Auto-orient: the stairs descend INTO the adjacent wall.
            // Look at the four cardinal neighbours of the '/' cell; the
            // one that's '#' tells us which way to rotate the descent.
            // No wall adjacent → default south-descending (rotY=0).
            const isWall = (cc: number, rr: number) => cellChar(cc, rr) === '#' || cellChar(cc, rr) === ' ';
            let rotY = 0;
            if (isWall(c, r + 1))      rotY = 0;             // descend +Z
            else if (isWall(c, r - 1)) rotY = Math.PI;       // descend -Z
            else if (isWall(c + 1, r)) rotY = Math.PI / 2;   // descend +X
            else if (isWall(c - 1, r)) rotY = -Math.PI / 2;  // descend -X
            // Stair body extends STAIRWELL_TOTAL_DEPTH (≈2.56m) along
            // local +Z. If the '/' cell sits within that distance of
            // the rect edge in the descent direction, the stair body
            // overhangs the wall — only a sliver of the carved floor
            // hole shows and the geometry visibly "sticks into the
            // wall" past where the player can see. Shift the stair
            // position backward so the BACK of the stairwell lands
            // FLUSH with the room's wall, putting the full body
            // inside the carved hole. A small inset (0.04m) matches
            // the hole-clip margin in builder.ts so the back parapet
            // sits just inside the wall mesh.
            const dirX = Math.sin(rotY);
            const dirZ = Math.cos(rotY);
            const rectMinX = offsetX - innerW / 2;
            const rectMaxX = offsetX + innerW / 2;
            const rectMinZ = offsetZ - innerD / 2;
            const rectMaxZ = offsetZ + innerD / 2;
            const backX = x + dirX * STAIRWELL_TOTAL_DEPTH;
            const backZ = z + dirZ * STAIRWELL_TOTAL_DEPTH;
            const INSET = 0.04;
            let shiftX = 0;
            let shiftZ = 0;
            if (backX > rectMaxX - INSET) shiftX = (rectMaxX - INSET) - backX;
            else if (backX < rectMinX + INSET) shiftX = (rectMinX + INSET) - backX;
            if (backZ > rectMaxZ - INSET) shiftZ = (rectMaxZ - INSET) - backZ;
            else if (backZ < rectMinZ + INSET) shiftZ = (rectMinZ + INSET) - backZ;
            stairs.push({
              id: `stairs-${opts.id}`,
              x: x + shiftX,
              z: z + shiftZ,
              rotY,
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
            unlock: ch === 'O' ? { kind: 'cleared', roomIds: [roomId] } : undefined,
          });
          break;
        }
      }
    }
  }

  // Wall segments are auto-detected boundaries between walkable and
  // non-walkable cells (perimeter + interior '#' walls). buildRoomShell
  // will build the room's perimeter walls at the (shrunken) rect edge
  // — so we skip ANY parser-emitted segment that sits on that perimeter
  // and keep only the interior ones. The check is offset-aware so
  // vault-composed floors (where each parse runs with its own
  // offsetX/Z) skip correctly relative to the room's local centre.
  const innerHalfW = innerW / 2;
  const innerHalfD = innerD / 2;
  const onRectEdge = (s: { ax: number; az: number; bx: number; bz: number }) => {
    const EPS = 1e-3;
    if (Math.abs(s.az - s.bz) < EPS) {
      return Math.abs(Math.abs(s.az - offsetZ) - innerHalfD) < EPS;
    }
    return Math.abs(Math.abs(s.ax - offsetX) - innerHalfW) < EPS;
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
