import type { LevelSpec, PropSpec, RoomSpec, EnemySpawnSpec, TorchSpec, DoorSpec, StairsSpec, TileMap } from './types';
import type { Vault, VaultTag } from './vault';
import { vaultsForTag, VAULTS } from './vault-library';
import { parseTileMap } from './tilemap';
import { populateTemplate } from './procgen';

// Floor composition — pick a chain of vaults by depth, lay them out
// along the world Z axis, and assemble a single LevelSpec the
// existing builder consumes.
//
// V1 layout strategy: LINEAR CHAIN going south. Each subsequent vault
// is placed below the previous with a corridor between. Vaults are
// centred on x=0; the corridor sits centred at x=0 too. Per-vault
// torch / wall / spawn lists are translated to world space and
// concatenated into the composed LevelSpec.
//
// What this gets us:
//   - Multi-room floors (the user's ask: "a few rooms then stairs").
//   - Per-vault depth + tag gating so deeper floors lean toward boss
//     antechambers + treasure caches instead of trash rooms.
//   - The hybrid props layer (vault.props with float coords) survives
//     into the floor — the composer just translates by the vault's
//     world offset.
//
// What it doesn't do yet (next pass):
//   - Side branches (T-intersection paths to optional rooms).
//   - Vault rotation (each vault is placed with its grid orientation).
//   - Shortcut connectors back to earlier rooms.

const CORRIDOR_WIDTH = 2.2;
const CORRIDOR_LENGTH = 3.0;
const CORRIDOR_HEIGHT = 2.8;
const ROOM_ID = (i: number) => `vault-${i}`;

interface PlacedVault {
  vault: Vault;
  roomId: string;
  offsetX: number;
  offsetZ: number;
}

/** Compose a LevelSpec for the given floor depth. Targets the next
 *  level via stairsTarget. */
export function composeFloor(
  depth: number,
  rand: () => number,
  nextLevelId: string,
  opts: {
    id: string;
    displayName?: string;
    torchTint?: number;
    fogColor?: number;
    /** If true, the last vault is FORCED to be a boss antechamber.
     *  Acts.ts sets this on the boss-depth of each act. */
    isBossFloor?: boolean;
  },
): LevelSpec {
  // ── 1. Build the tag sequence ──────────────────────────────────
  // [start, ...middle, exit/boss]. Middle slot count scales gently
  // with depth so early floors are short and later floors feel
  // expedition-sized. The end tag is forced to 'boss' on boss
  // floors; otherwise it's a regular exit room.
  const middleCount = clamp(1 + Math.floor((depth - 1) / 2), 1, 4);
  const tagSeq: VaultTag[] = ['start'];
  for (let i = 0; i < middleCount; i++) {
    tagSeq.push(pickMiddleTag(depth, rand));
  }
  tagSeq.push(opts.isBossFloor ? 'boss' : 'exit');

  // ── 2. Resolve each slot to a concrete vault ───────────────────
  const placed: PlacedVault[] = [];
  let zCursor = 0;
  for (let i = 0; i < tagSeq.length; i++) {
    const tag = tagSeq[i];
    const candidates = vaultsForTag(tag, depth);
    // Fallback chain: if no candidates for the tag at this depth,
    // try 'combat' (always populated) then 'exit'.
    const pool = candidates.length > 0
      ? candidates
      : tag === 'exit'
        ? VAULTS.filter((v) => v.tags.includes('exit'))
        : VAULTS.filter((v) => v.tags.includes('combat'));
    const vault = weightedPick(pool, rand);
    const dims = vaultDims(vault);
    // First vault: place its centre at z=0. Subsequent vaults sit
    // south of the previous, with a corridor between.
    if (i === 0) {
      zCursor = dims.d / 2;        // south edge of this vault
      placed.push({
        vault,
        roomId: ROOM_ID(i),
        offsetX: 0,
        offsetZ: 0,
      });
    } else {
      const corridorNorthEdge = zCursor;
      const corridorSouthEdge = corridorNorthEdge + CORRIDOR_LENGTH;
      const vaultNorthEdge = corridorSouthEdge;
      const vaultCentreZ = vaultNorthEdge + dims.d / 2;
      placed.push({
        vault,
        roomId: ROOM_ID(i),
        offsetX: 0,
        offsetZ: vaultCentreZ,
      });
      zCursor = vaultCentreZ + dims.d / 2;
    }
  }

  // ── 3. Parse each vault and translate to world coords ──────────
  // Each vault is parsed as a standalone tilemap with its own offset.
  // The parser already handles cell→world coords + auto walls. We
  // collect all output into running lists, then add corridors and
  // doorway gaps between them.
  const rooms: RoomSpec[] = [];
  const corridors: RoomSpec[] = [];
  const props: PropSpec[] = [];
  const torches: TorchSpec[] = [];
  const spawns: EnemySpawnSpec[] = [];
  const doors: DoorSpec[] = [];
  const stairs: StairsSpec[] = [];
  const extraWalls: NonNullable<LevelSpec['extraWalls']> = [];
  let startPos: LevelSpec['startPos'] = { x: 0, z: 0, yaw: 0 };

  for (let i = 0; i < placed.length; i++) {
    const pv = placed[i];
    // Resolve 'X' / 'B' enemy slots against the depth-weighted roll
    // tables before the parser sees the grid. Each vault rolls
    // independently, so a floor can have a mix of ghouls in one room
    // + skirmishers in another.
    const populated = populateTemplate(pv.vault.map, depth, rand);
    const sub = parseTileMap(populated, {
      id: `${opts.id}-${pv.vault.id}`,
      offsetX: pv.offsetX,
      offsetZ: pv.offsetZ,
      roomId: pv.roomId,
      torchTint: opts.torchTint,
      stairsTarget: nextLevelId,
      roomHeight: pv.vault.roomHeight,
    });
    rooms.push(...sub.rooms);
    corridors.push(...sub.corridors);
    props.push(...sub.props);
    torches.push(...sub.torches);
    spawns.push(...sub.spawns);
    if (sub.doors) doors.push(...sub.doors);
    if (sub.stairs) stairs.push(...sub.stairs);
    if (sub.extraWalls) extraWalls.push(...sub.extraWalls);

    // Translate vault-local PROPS to world by adding offset.
    if (pv.vault.props) {
      for (const p of pv.vault.props) {
        props.push(translateProp(p, pv.offsetX, pv.offsetZ));
      }
    }

    // Capture the START vault's spawn position.
    if (pv.vault.tags.includes('start')) {
      startPos = sub.startPos;
    }
  }

  // ── 4. Add corridor segments between adjacent vaults ───────────
  // Each corridor is a 2.2m-wide rect occupying the space between
  // two vaults along the Z axis. Adding it as a 'corridor' rect in
  // the LevelSpec → the room builder treats it as walkable, and the
  // wall-segmenter automatically skips perimeter walls where the
  // corridor abuts the vault rect.
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1];
    const b = placed[i];
    const aDims = vaultDims(a.vault);
    const bDims = vaultDims(b.vault);
    const aSouth = a.offsetZ + aDims.d / 2;
    const bNorth = b.offsetZ - bDims.d / 2;
    if (bNorth <= aSouth + 0.01) continue;   // no gap = no corridor
    const corridor: RoomSpec = {
      id: `corr-${i}`,
      rect: {
        x: 0,
        z: (aSouth + bNorth) / 2,
        w: CORRIDOR_WIDTH,
        d: bNorth - aSouth,
      },
      height: CORRIDOR_HEIGHT,
    };
    corridors.push(corridor);
  }

  // ── 5. Clip vault inner walls through corridor mouths ─────────
  // parseTileMap emits walls along each vault's INNER perimeter (1m
  // inset from the rect edges, where the '#' tiles meet the floor
  // cells). Those walls sit BETWEEN the player's walkable interior
  // and the corridor mouth — that's the "blocked like a wall" bug.
  // We clip wall segments that run along the inner perimeter z-row
  // of a vault adjacent to a corridor, removing the portion that
  // falls inside the corridor's x range.
  const clippedWalls = clipInnerWallsAtCorridors(extraWalls, corridors);

  return {
    id: opts.id,
    depth,
    displayName: opts.displayName,
    fogColor: opts.fogColor,
    startPos,
    rooms,
    corridors,
    props,
    torches,
    spawns,
    doors,
    stairs,
    extraWalls: clippedWalls,
  };
}

/**
 * Remove segments of vault inner-perimeter walls that cross a
 * corridor mouth. Walls are at the boundary BETWEEN cells (floor on
 * one side, '#' on the other) — for a corridor abutting a vault's
 * south edge, the relevant wall sits at z = corridor.northEdge - 1
 * (one metre INSIDE the vault from the corridor mouth). We clip
 * everything horizontal at that z that overlaps the corridor's
 * x range, leaving the rest of the wall intact.
 */
function clipInnerWallsAtCorridors(
  walls: NonNullable<LevelSpec['extraWalls']>,
  corridors: RoomSpec[],
): NonNullable<LevelSpec['extraWalls']> {
  let out = walls.slice();
  for (const c of corridors) {
    const northMouthZ = c.rect.z - c.rect.d / 2;   // vault A's south rect edge
    const southMouthZ = c.rect.z + c.rect.d / 2;   // vault B's north rect edge
    const xMin = c.rect.x - c.rect.w / 2;
    const xMax = c.rect.x + c.rect.w / 2;
    // Inner wall on each side sits 1m INTO the adjacent vault.
    out = clipWallsAtZ(out, northMouthZ - 1, xMin, xMax);
    out = clipWallsAtZ(out, southMouthZ + 1, xMin, xMax);
  }
  return out;
}

/** Clip horizontal wall segments at the given z, keeping the
 *  portions that fall OUTSIDE [xMin, xMax]. */
function clipWallsAtZ(
  walls: NonNullable<LevelSpec['extraWalls']>,
  z: number,
  xMin: number,
  xMax: number,
): NonNullable<LevelSpec['extraWalls']> {
  const EPS = 0.01;
  const out: NonNullable<LevelSpec['extraWalls']> = [];
  for (const w of walls) {
    // Only horizontal walls at this z qualify.
    if (Math.abs(w.az - z) > EPS || Math.abs(w.bz - z) > EPS) {
      out.push(w);
      continue;
    }
    const wMin = Math.min(w.ax, w.bx);
    const wMax = Math.max(w.ax, w.bx);
    if (wMax <= xMin + EPS || wMin >= xMax - EPS) {
      out.push(w);
      continue;
    }
    // Wall overlaps the clip range. Keep portions outside.
    if (wMin < xMin - EPS) {
      out.push({ ...w, ax: wMin, az: z, bx: xMin, bz: z });
    }
    if (wMax > xMax + EPS) {
      out.push({ ...w, ax: xMax, az: z, bx: wMax, bz: z });
    }
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────

function vaultDims(v: Vault): { w: number; d: number } {
  const rows = v.map.length;
  const cols = Math.max(...v.map.map((r) => r.length));
  return { w: cols, d: rows };
}

function pickMiddleTag(depth: number, rand: () => number): VaultTag {
  // Weighted pool of middle-vault tags. Combat dominates; treasure +
  // encounter sprinkle in. Deeper floors get more variety.
  const weights: Array<[VaultTag, number]> = [
    ['combat', 5],
    ['treasure', depth >= 2 ? 2 : 1],
    ['encounter', depth >= 2 ? 2 : 1],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [tag, w] of weights) {
    r -= w;
    if (r <= 0) return tag;
  }
  return 'combat';
}

function weightedPick<T extends { weight?: number }>(pool: T[], rand: () => number): T {
  const total = pool.reduce((s, v) => s + (v.weight ?? 1), 0);
  let r = rand() * total;
  for (const v of pool) {
    r -= v.weight ?? 1;
    if (r <= 0) return v;
  }
  return pool[pool.length - 1];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function translateProp(p: PropSpec, dx: number, dz: number): PropSpec {
  // PropSpec is a discriminated union — every variant has x + z at
  // its top level. Add the vault offset to land in world space.
  // Some variants have additional pos fields ('model' has y) which
  // we leave alone.
  return { ...p, x: p.x + dx, z: p.z + dz } as PropSpec;
}

// (carveDoorways helper removed — see clipInnerWallsAtCorridors above.
// Previously we modified the vault tilemap to '.' at the corridor
// mouth, but the parser then emitted a NEW outer-edge wall in those
// cells, which blocked corridor entry from the vault side. Clipping
// the inner-perimeter walls post-parse leaves the geometry clean.)
