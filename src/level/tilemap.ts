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
//   <enemy chars>  spawn an enemy — REGISTRY-DRIVEN. Each EnemySpec
//                  declares its own `tileChar` (content/enemies.ts);
//                  the parser, FLOOR_CHARS, and procgen all derive from
//                  that one source (ENEMY_BY_CHAR) so chars can't drift.
//                  Current: G ghoul · R rat · K skirmisher · W wraith ·
//                  Y acolyte · M stoneguard · Z ooze · Q acid-spitter ·
//                  H defiler. ('X'/'B' are procgen slot placeholders,
//                  NOT enemy chars.)
//   space  treated as wall (so authors can omit perimeter quoting)

import type {
  LevelSpec, PropSpec, EnemySpawnSpec, TorchSpec, RoomSpec, DoorSpec, StairsSpec, TileMap,
} from './types';
import { ITEMS } from '../content/items';
import { ENEMY_BY_CHAR } from '../content/enemies';
import { STAIRWELL_TOTAL_DEPTH, STAIRWELL_HALF_WIDTH } from '../interactables/stairs';
import { pickWallFixture } from './lit-fixture-pool';
import { buildRng } from '../engine/rng';

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
// Every char that's conceptually FLOOR with a feature on it has to
// be in here, or the boundary scanner will treat the cell as a wall
// (because isFloor() drives the floor/non-floor edge detection). If
// a feature char is missing, an isolated cell of that char produces
// exactly the same boundary edges as an isolated '#' would — which
// after consolidation becomes the X-walls-in-mid-room artifact.
//
// STRUCTURAL chars are listed here literally; ENEMY chars are pulled
// from the enemy registry (ENEMY_BY_CHAR) so a new enemy is walkable
// floor automatically — no risk of forgetting to add it here. 'X' is
// the procgen generic-enemy slot (replaced before parse, but kept
// walkable as a safety net).
const STRUCTURAL_FLOOR_CHARS = '.,SoOD/^FCPAcvVTt<>X';
const FLOOR_CHARS = new Set([
  ...STRUCTURAL_FLOOR_CHARS.split(''),
  ...ENEMY_BY_CHAR.keys(),
]);

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

  // ── Flood fill walkable cells into sub-rooms ──────────────────────
  // Door tiles ('o', 'O', 'D') are treated as separators alongside
  // walls — each door connects two distinct sub-rooms. This is what
  // lets the arena door's unlock target a SPECIFIC inner sub-room
  // instead of the whole vault. Authors get sub-rooms "for free" just
  // by putting interior walls + a door tile in their map.
  const isWalkableForFlood = (col: number, row: number): boolean => {
    const ch = cellChar(col, row);
    return FLOOR_CHARS.has(ch) && ch !== 'o' && ch !== 'O' && ch !== 'D';
  };
  const cellComp: number[][] = [];
  for (let r = 0; r < rows; r++) cellComp.push(new Array(cols).fill(-1));
  type Bbox = { minC: number; maxC: number; minR: number; maxR: number };
  const componentBboxes: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellComp[r][c] !== -1) continue;
      if (!isWalkableForFlood(c, r)) continue;
      const comp = componentBboxes.length;
      const bb: Bbox = { minC: c, maxC: c, minR: r, maxR: r };
      const queue: Array<[number, number]> = [[c, r]];
      while (queue.length > 0) {
        const [qc, qr] = queue.shift()!;
        if (cellComp[qr][qc] !== -1) continue;
        cellComp[qr][qc] = comp;
        if (qc < bb.minC) bb.minC = qc;
        if (qc > bb.maxC) bb.maxC = qc;
        if (qr < bb.minR) bb.minR = qr;
        if (qr > bb.maxR) bb.maxR = qr;
        const neighbors: Array<[number, number]> = [
          [qc + 1, qr], [qc - 1, qr], [qc, qr + 1], [qc, qr - 1],
        ];
        for (const [nc, nr] of neighbors) {
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          if (cellComp[nr][nc] !== -1) continue;
          if (isWalkableForFlood(nc, nr)) queue.push([nc, nr]);
        }
      }
      componentBboxes.push(bb);
    }
  }

  // Component-id → sub-room id mapping. For SINGLE-component vaults
  // we keep the existing roomId as the canonical id (no sub-rooms
  // emitted at all — backward compatibility for every existing vault).
  // For multi-component vaults the main RoomSpec keeps its id for
  // shell geometry and each component gets `${roomId}-sub${i}`.
  const componentRoomIds: string[] = componentBboxes.length === 1
    ? [roomId]
    : componentBboxes.map((_, i) => `${roomId}-sub${i}`);

  /** Look up the sub-room a tile cell belongs to. Returns the cell's
   *  component id if walkable; for door cells (which are separators),
   *  returns null — door placement uses adjacentComponentIds. */
  const cellRoomId = (col: number, row: number): string => {
    const comp = cellComp[row]?.[col] ?? -1;
    return comp >= 0 ? componentRoomIds[comp] : roomId;
  };
  /** For a door cell, return the unique component ids on either side
   *  of the door (axis inferred from the door's span). Used to fill
   *  unlock.roomIds without forcing authors to type them. */
  const adjacentComponentIds = (col: number, row: number, ew: boolean): string[] => {
    const out = new Set<string>();
    const neighbors: Array<[number, number]> = ew
      ? [[col, row - 1], [col, row + 1]]
      : [[col - 1, row], [col + 1, row]];
    for (const [nc, nr] of neighbors) {
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const comp = cellComp[nr][nc];
      if (comp >= 0) out.add(componentRoomIds[comp]);
    }
    return [...out];
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

  // ── Isolated-wall-cell detection ─────────────────────────────────
  // A single '#' tile surrounded on all 4 cardinal sides by floor
  // would otherwise emit four boundary edges (one per side). The
  // consolidator on the back end merges the parallel pairs (top/bottom
  // → one mid-cell horizontal wall; left/right → one mid-cell vertical
  // wall), leaving TWO perpendicular walls crossing through the cell
  // centre. From above that's a '+'; from any oblique angle it reads
  // as an X-shaped pair of intersecting wall planes hanging in mid-
  // room. Almost certainly never what the vault author intended.
  //
  // Fix: treat such cells as a PILLAR. They get no boundary walls
  // (treated as floor by the boundary scan below) and we emit a
  // pillar prop at the cell centre — same as the explicit 'P' tile.
  // The pillar prop carries its own collision so the cell remains a
  // physical obstacle; flood fill is unaffected because it walks the
  // raw cellChar grid, not isFloor.
  const isolatedWallCells = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellChar(c, r) !== '#') continue;
      const allFloorAround =
        r > 0        && isFloor(c, r - 1) &&
        r < rows - 1 && isFloor(c, r + 1) &&
        c > 0        && isFloor(c - 1, r) &&
        c < cols - 1 && isFloor(c + 1, r);
      if (allFloorAround) isolatedWallCells.add(`${c},${r}`);
    }
  }
  const isFloorForBoundary = (col: number, row: number): boolean =>
    isFloor(col, row) || isolatedWallCells.has(`${col},${row}`);

  // Build sets of "wall edges" per kind. Each edge is (cellRow, colStart..colEnd, z)
  // or (cellCol, rowStart..rowEnd, x). Then we MERGE adjacent edges.
  // ── Horizontal edges (running along X) ─────────────────────────
  // Between row r and row r-1, edge z = originZ + r. The edge exists
  // for any col where cell(col, r) and cell(col, r-1) have different
  // walkability AND at least one is walkable (perimeter walls included).
  for (let r = 0; r <= rows; r++) {
    let runStart: number | null = null;
    for (let c = 0; c <= cols; c++) {
      const above = r > 0 ? isFloorForBoundary(c, r - 1) : false;
      const below = r < rows ? isFloorForBoundary(c, r) : false;
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
      const left  = c > 0 ? isFloorForBoundary(c - 1, r) : false;
      const right = c < cols ? isFloorForBoundary(c, r) : false;
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
      // Enemy spawns are registry-driven (see ENEMY_BY_CHAR in
      // content/enemies.ts) — one source of truth shared with procgen
      // + FLOOR_CHARS, so a new enemy's char can't drift out of sync.
      const enemyId = ENEMY_BY_CHAR.get(ch);
      if (enemyId) {
        spawns.push({ enemyId, x, z, roomId: cellRoomId(c, r) });
        continue;
      }
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
          // Declarative facing: the back of the chest sits AGAINST
          // the nearest wall, lid swings forward into the open
          // room. resolveAllFacings (in level/facing.ts) computes
          // the concrete rotY at compose time using the room rects.
          props.push({
            kind: 'chest', x, z,
            facing: { kind: 'wall-away' },
            loot: ITEMS['healing-potion'],
          });
          break;
        }
        case 'C': {
          props.push({
            kind: 'corpse', x, z, rotY: buildRng() * Math.PI * 2,
            note: CORPSE_NOTES[(noteIndex++) % CORPSE_NOTES.length],
          });
          break;
        }
        case 'F': {
          props.push({ kind: 'fountain', x, z });
          break;
        }
        case 'v': {
          // Destructible ceramic vase. One-tile prop; smashes
          // into a small loot drop on hit.
          props.push({ kind: 'vase', x, z });
          break;
        }
        case 'V': {
          // Cluster of 2-4 jittered vases around this cell. The
          // builder calls spawnVaseCluster which handles the
          // random count + variants + spacing.
          props.push({ kind: 'vase-cluster', x, z });
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
            // Roll the wall-fixture pool — mostly torches with the
            // occasional wall cresset for silhouette variety. Same
            // light spec across variants so the env light pool sees
            // no difference; only the visible model changes.
            fixtureKind: pickWallFixture(buildRng),
          });
          break;
        }
        // Spawns attributed to their containing sub-room — this is what
        // makes per-sub-room room-clear detection (arena unlock,
        // boss-antechamber gating, etc.) work. cellRoomId falls back to
        // the canonical roomId for single-component vaults.
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
            // Same shift, perpendicular to descent. Stair body is
            // STAIRWELL_HALF_WIDTH on each side of its long axis; if a
            // side lands past the rect edge, shift it back inside.
            // Without this, a '/' cell adjacent to a SIDE wall (not
            // just the back wall) overshoots — the floor hole gets
            // clipped to the rect, but the side wall stays standing
            // above where the stair body extends past, leaving a wall
            // face hanging above the stair pit. Symptom in screenshots:
            // stair half-buried in the left wall + a floating wall
            // section above it.
            const sideX = Math.cos(rotY);
            const sideZ = -Math.sin(rotY);
            const cx = x + shiftX;
            const cz = z + shiftZ;
            const leftX  = cx - sideX * STAIRWELL_HALF_WIDTH;
            const leftZ  = cz - sideZ * STAIRWELL_HALF_WIDTH;
            const rightX = cx + sideX * STAIRWELL_HALF_WIDTH;
            const rightZ = cz + sideZ * STAIRWELL_HALF_WIDTH;
            // Each side may overflow independently; pick the larger
            // correction in each axis (you can't satisfy both walls if
            // the stair is wider than the room, but for realistic vault
            // sizes only one side will overshoot).
            if (leftX  < rectMinX + INSET) shiftX += (rectMinX + INSET) - leftX;
            if (rightX > rectMaxX - INSET) shiftX += (rectMaxX - INSET) - rightX;
            if (leftZ  < rectMinZ + INSET) shiftZ += (rectMinZ + INSET) - leftZ;
            if (rightZ > rectMaxZ - INSET) shiftZ += (rectMaxZ - INSET) - rightZ;
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
        case 'O':
        case 'D': {
          // Door at this cell. The door SPAN is along the perpendicular
          // axis — we pick based on neighbors: if cells E/W of this are
          // walls and N/S are walkable, the door runs E↔W.
          //
          // Tile semantics:
          //   o → always-unlocked door (open on first interact, no gate)
          //   O → sealed from spawn until the containing room clears
          //   D → arena door. STARTS open + passable; slams shut when
          //       the player crosses into the containing room; reopens
          //       when the room clears. Lock-on-enter.
          //
          // Roomids on the unlock are auto-derived from flood fill:
          // the two sub-rooms on either side of the door. For O / D
          // this means the door's gate predicate covers BOTH sides,
          // so the arena slam fires the moment the player enters
          // either side from a corridor (or interior wall passage).
          const nIsFloor = isFloor(c, r - 1);
          const sIsFloor = isFloor(c, r + 1);
          const ew = nIsFloor && sIsFloor;  // door swings E↔W
          const doorRect = ew
            ? { ax: x - 0.5, az: z, bx: x + 0.5, bz: z }
            : { ax: x, az: z - 0.5, bx: x, bz: z + 0.5 };
          const neighborRooms = adjacentComponentIds(c, r, ew);
          const gateRooms = neighborRooms.length > 0 ? neighborRooms : [roomId];
          doors.push({
            id: `door-${c}-${r}`,
            ax: doorRect.ax, az: doorRect.az,
            bx: doorRect.bx, bz: doorRect.bz,
            height: 2.6,
            hinge: 'a',
            swingDir: 1,
            unlock: ch === 'O' ? { kind: 'cleared', roomIds: gateRooms }
                  : ch === 'D' ? { kind: 'arena',   roomIds: gateRooms }
                  : undefined,
          });
          break;
        }
      }
    }
  }

  // Emit a pillar prop for each isolated '#' cell — same as the 'P'
  // tile would have produced. Done here, after the per-cell loop, so
  // `props` is in scope. Boundary scan above already skipped these
  // cells (treated them as floor) so no crossed walls are produced.
  for (const key of isolatedWallCells) {
    const [cStr, rStr] = key.split(',');
    const cc = Number(cStr);
    const rr = Number(rStr);
    const { x, z } = cellCenter(cc, rr);
    props.push({ kind: 'pillar', x, z });
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

  // ── Interior 1-cell-thick wall consolidation ─────────────────────
  // When a single row (or column) of '#' tiles sits between two open
  // areas, the boundary-emission loop above puts TWO parallel wall
  // edges — one at each side of the wall cell. Visually that reads as
  // a 1m-thick "channel" of empty floor between two thin walls, with
  // any door tile floating in the middle of the channel. Looks wrong.
  //
  // Fix: post-process the wall list. Find any pair of parallel walls
  // exactly 1m apart with the same running-axis range — that's a 1-
  // cell-thick interior wall — and replace the pair with a SINGLE wall
  // at the midpoint. Door cells, which already break the wall edge
  // with a 1m gap, naturally end up with a clean 1m opening at the
  // cell centre after consolidation.
  //
  // Only operates on NON-perimeter walls (perimeter pairs across an
  // adjacent vault's matching edge get carved into a corridor opening
  // by the room-shell builder; they shouldn't be merged).
  // Door cells AND stair body cells are FLOOR but bracketed by walls
  // on the perpendicular sides. The boundary scanner emits those
  // bracketing edges as a parallel pair 1m apart with the same
  // running-axis range — the EXACT pattern the consolidator matches.
  // Without a guard the consolidator collapses those edges into a
  // single mid-cell wall, putting:
  //   - Doors: a wall through the doorway (the "wall slab in the
  //     middle of the door" symptom).
  //   - Stairs: a wall through the stair body's path (the "orphaned
  //     hanging wall above the stair" symptom — the end-cap removal
  //     pass killed the other half of what was originally an X).
  // Pass these cell centres to the consolidator so it can skip the
  // candidate pairs that straddle them.
  const openingCells: Array<{ x: number; z: number }> = doors.map((d) => ({
    x: (d.ax + d.bx) / 2,
    z: (d.az + d.bz) / 2,
  }));
  // Stair body footprint — extends from the stair's '/' cell forward
  // by STAIRWELL_TOTAL_DEPTH along the descent axis. Cell centres
  // every 1m starting at the stair position. ceil(depth) + 1 covers
  // both ends so consolidation candidates between any two adjacent
  // cells in the body are also guarded.
  for (const st of stairs) {
    const sDirX = Math.sin(st.rotY ?? 0);
    const sDirZ = Math.cos(st.rotY ?? 0);
    const steps = Math.ceil(STAIRWELL_TOTAL_DEPTH) + 1;
    for (let i = 0; i <= steps; i++) {
      openingCells.push({
        x: st.x + sDirX * i,
        z: st.z + sDirZ * i,
      });
    }
  }
  const consolidated: Seg[] = consolidateInteriorWalls(walls, onRectEdge, openingCells);

  const extraWalls = consolidated
    .filter(s => !onRectEdge(s))
    .map(s => ({ ...s, height: room.height }));

  // Sub-room emission. Only when flood fill found >1 component — for
  // single-component vaults we emit nothing extra so every existing
  // vault is byte-identical to before this refactor. Each sub-room is
  // a logical-only RoomSpec whose rect = the component's bbox in
  // WORLD coords (cell centres → outer edges, +0.5m each side so a
  // cell at the bbox edge is fully inside the rect).
  const subRooms: RoomSpec[] = componentBboxes.length > 1
    ? componentBboxes.map((bb, i) => {
        const minX = originX + bb.minC;
        const maxX = originX + bb.maxC + 1;
        const minZ = originZ + bb.minR;
        const maxZ = originZ + bb.maxR + 1;
        return {
          id: componentRoomIds[i],
          rect: {
            x: (minX + maxX) / 2,
            z: (minZ + maxZ) / 2,
            w: maxX - minX,
            d: maxZ - minZ,
          },
          height: opts.roomHeight ?? 3.2,
          logicalOnly: true,
        };
      })
    : [];

  return {
    id: opts.id,
    displayName: opts.displayName,
    startPos,
    rooms: [room, ...subRooms],
    corridors: [],
    props,
    torches,
    spawns,
    doors,
    stairs,
    extraWalls,
  };
}

/**
 * Find pairs of parallel interior walls 1m apart with identical
 * running-axis ranges (a 1-cell-thick wall row/column emitted as two
 * boundary segments) and replace each pair with a single wall at the
 * midpoint. Non-paired walls are returned unchanged. Perimeter walls
 * (per onRectEdge) are never merged — corridor carving needs them at
 * the exact rect edge.
 */
function consolidateInteriorWalls(
  walls: Array<{ ax: number; az: number; bx: number; bz: number }>,
  onRectEdge: (s: { ax: number; az: number; bx: number; bz: number }) => boolean,
  openingCells: Array<{ x: number; z: number }> = [],
): Array<{ ax: number; az: number; bx: number; bz: number }> {
  const EPS = 1e-3;
  // Interior horizontal walls: az === bz, ax !== bx.
  const horizontal: typeof walls = [];
  // Interior vertical walls: ax === bx, az !== bz.
  const vertical: typeof walls = [];
  const passthrough: typeof walls = [];   // perimeter + degenerates

  for (const w of walls) {
    if (onRectEdge(w)) { passthrough.push(w); continue; }
    if (Math.abs(w.az - w.bz) < EPS) horizontal.push(w);
    else if (Math.abs(w.ax - w.bx) < EPS) vertical.push(w);
    else passthrough.push(w);
  }

  const consumed = new Set<typeof walls[number]>();
  const merged: typeof walls = [];
  // Track consolidated walls' termini so we can detect & drop the
  // perpendicular end-cap walls that the boundary scanner emitted
  // around the original 1-cell-thick wall's open ends. See the
  // end-cap removal block below.
  const mergedHTermini: Array<{ midZ: number; minX: number; maxX: number }> = [];
  const mergedVTermini: Array<{ midX: number; minZ: number; maxZ: number }> = [];

  // Door-cell guard: a horizontal pair brackets a door if the door
  // cell's Z centre equals the pair's midZ AND its X centre is in
  // the pair's X range. Symmetric for vertical pairs. Door cells
  // sit at the half-integer grid (cellCenter), and midZ of a 1m
  // pair also lands at half-integer, so EPS-tolerant compare is
  // enough — no special grid logic needed.
  const hCrossesOpening = (midZ: number, minX: number, maxX: number): boolean => {
    for (const o of openingCells) {
      if (Math.abs(o.z - midZ) > EPS) continue;
      if (o.x < minX - EPS || o.x > maxX + EPS) continue;
      return true;
    }
    return false;
  };
  const vCrossesOpening = (midX: number, minZ: number, maxZ: number): boolean => {
    for (const o of openingCells) {
      if (Math.abs(o.x - midX) > EPS) continue;
      if (o.z < minZ - EPS || o.z > maxZ + EPS) continue;
      return true;
    }
    return false;
  };

  // Horizontal pairs: same X range, |dz| == 1.
  for (let i = 0; i < horizontal.length; i++) {
    const a = horizontal[i];
    if (consumed.has(a)) continue;
    const aMinX = Math.min(a.ax, a.bx);
    const aMaxX = Math.max(a.ax, a.bx);
    let match: typeof a | null = null;
    for (let j = i + 1; j < horizontal.length; j++) {
      const b = horizontal[j];
      if (consumed.has(b)) continue;
      if (Math.abs(Math.abs(b.az - a.az) - 1) > EPS) continue;
      const bMinX = Math.min(b.ax, b.bx);
      const bMaxX = Math.max(b.ax, b.bx);
      if (Math.abs(aMinX - bMinX) > EPS || Math.abs(aMaxX - bMaxX) > EPS) continue;
      match = b;
      break;
    }
    if (match) {
      const midZ = (a.az + match.az) / 2;
      // Skip the merge if a door cell sits between this pair — the
      // pair is the door FRAME, not a 1-cell wall. Leaving them as
      // separate walls keeps the doorway open.
      if (hCrossesOpening(midZ, aMinX, aMaxX)) {
        // Both walls stay; neither gets consumed.
      } else {
        merged.push({ ax: aMinX, az: midZ, bx: aMaxX, bz: midZ });
        consumed.add(a);
        consumed.add(match);
        mergedHTermini.push({ midZ, minX: aMinX, maxX: aMaxX });
      }
    }
  }
  for (const w of horizontal) if (!consumed.has(w)) merged.push(w);

  // Vertical pairs: same Z range, |dx| == 1.
  for (let i = 0; i < vertical.length; i++) {
    const a = vertical[i];
    if (consumed.has(a)) continue;
    const aMinZ = Math.min(a.az, a.bz);
    const aMaxZ = Math.max(a.az, a.bz);
    let match: typeof a | null = null;
    for (let j = i + 1; j < vertical.length; j++) {
      const b = vertical[j];
      if (consumed.has(b)) continue;
      if (Math.abs(Math.abs(b.ax - a.ax) - 1) > EPS) continue;
      const bMinZ = Math.min(b.az, b.bz);
      const bMaxZ = Math.max(b.az, b.bz);
      if (Math.abs(aMinZ - bMinZ) > EPS || Math.abs(aMaxZ - bMaxZ) > EPS) continue;
      match = b;
      break;
    }
    if (match) {
      const midX = (a.ax + match.ax) / 2;
      if (vCrossesOpening(midX, aMinZ, aMaxZ)) {
        // Door cell sits between this pair — leave both walls as
        // the door frame.
      } else {
        merged.push({ ax: midX, az: aMinZ, bx: midX, bz: aMaxZ });
        consumed.add(a);
        consumed.add(match);
        mergedVTermini.push({ midX, minZ: aMinZ, maxZ: aMaxZ });
      }
    }
  }
  for (const w of vertical) if (!consumed.has(w)) merged.push(w);

  // ── End-cap removal ─────────────────────────────────────────────
  // When a 1-cell-thick interior wall terminates in mid-room (the row
  // or column ENDS without joining a perimeter wall), the boundary
  // scanner emits a perpendicular 1m wall at the terminus — closing
  // off the original wall's open 1m end face. The consolidator above
  // then collapses the parallel-pair walls into a single mid-cell
  // plane, dropping that thickness to zero. The end-cap STAYS at its
  // full cell-edge position, perpendicular to the consolidated plane,
  // straddling the plane's terminus by ±0.5m on each side. That's
  // the X-shape visible in mid-room: consolidated plane crossing
  // through the END-CAP's mid-length.
  //
  // Drop these end-caps. They're identifiable as:
  //   - exactly 1m long
  //   - perpendicular to a consolidated wall
  //   - at the consolidated wall's terminus (X equals minX/maxX for H;
  //     Z equals minZ/maxZ for V)
  //   - straddling the consolidated wall's centre by ±0.5
  //
  // A real 1m perpendicular wall in the same position would be part
  // of a LONGER perpendicular run — the boundary scanner glues
  // adjacent same-edge segments, so a continuing wall would be > 1m.
  // The 1m-length check is the discriminator.
  const isEndCap = (w: { ax: number; az: number; bx: number; bz: number }): boolean => {
    if (Math.abs(w.az - w.bz) < EPS) {
      // Horizontal candidate — would cap a VERTICAL consolidated.
      const wLen = Math.abs(w.bx - w.ax);
      if (Math.abs(wLen - 1) > EPS) return false;
      const wMinX = Math.min(w.ax, w.bx);
      const wMaxX = Math.max(w.ax, w.bx);
      for (const v of mergedVTermini) {
        if (Math.abs(wMinX - (v.midX - 0.5)) > EPS) continue;
        if (Math.abs(wMaxX - (v.midX + 0.5)) > EPS) continue;
        if (Math.abs(w.az - v.minZ) < EPS || Math.abs(w.az - v.maxZ) < EPS) return true;
      }
      return false;
    }
    if (Math.abs(w.ax - w.bx) < EPS) {
      // Vertical candidate — would cap a HORIZONTAL consolidated.
      const wLen = Math.abs(w.bz - w.az);
      if (Math.abs(wLen - 1) > EPS) return false;
      const wMinZ = Math.min(w.az, w.bz);
      const wMaxZ = Math.max(w.az, w.bz);
      for (const h of mergedHTermini) {
        if (Math.abs(wMinZ - (h.midZ - 0.5)) > EPS) continue;
        if (Math.abs(wMaxZ - (h.midZ + 0.5)) > EPS) continue;
        if (Math.abs(w.ax - h.minX) < EPS || Math.abs(w.ax - h.maxX) < EPS) return true;
      }
      return false;
    }
    return false;
  };

  const filteredMerged = merged.filter(w => !isEndCap(w));

  return [...passthrough, ...filteredMerged];
}
