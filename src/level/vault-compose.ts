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
      // Start vault: face SOUTH (+Z) toward the corridor that exits
      // the room. yaw=π puts the camera's default-forward (-Z) onto
      // +Z, so the player's first frame looks down the chain toward
      // the next vault instead of into the back wall. Without this
      // override the default yaw=0 (north) had us spawning faced AT
      // the wall the player came from.
      spawnYaw: pv.vault.tags.includes('start') ? Math.PI : undefined,
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

  // (Wall clipping no longer needed — parseTileMap now produces a
  // shrunk rect whose perimeter aligns with where its walls would
  // otherwise sit, and skips those walls entirely. buildRoomShell
  // handles the perimeter visual + collision + corridor openings
  // via findOpenings. Interior '#' walls inside a vault still come
  // through extraWalls and don't conflict with corridors.)
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
    extraWalls,
  };
}

// (clipInnerWallsAtCorridors + clipWallsAtZ removed — the rect-
// shrinking approach in parseTileMap obsoletes them.)

// ── helpers ──────────────────────────────────────────────────────

function vaultDims(v: Vault): { w: number; d: number } {
  const rows = v.map.length;
  const cols = Math.max(...v.map.map((r) => r.length));
  // Parser shrinks the rect to the inner walkable area (cell grid
  // minus 1m on each side, since the outer '#' tiles are wall
  // material the player can't stand on). Composer matches: corridor
  // edges align with the SHRUNK vault edges so buildRoomShell's
  // findOpenings detects abuttment correctly.
  return { w: Math.max(0, cols - 2), d: Math.max(0, rows - 2) };
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
