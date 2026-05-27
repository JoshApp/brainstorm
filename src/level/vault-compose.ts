import type { LevelSpec, PropSpec, RoomSpec, EnemySpawnSpec, TorchSpec, DoorSpec, StairsSpec } from './types';
import type { Vault, VaultTag } from './vault';
import { vaultsForTag, VAULTS } from './vault-library';
import { parseTileMap } from './tilemap';
import { populateTemplate } from './procgen';
import { PROP_GROUPS, type GroupChild } from './prop-groups';

// Floor composition — pick a chain of vaults by depth, lay them out
// with corridors between, and assemble a single LevelSpec the
// existing builder consumes.
//
// Pass A variety:
//   - Main spine south-going, plus an OPTIONAL side branch (a leaf
//     vault hanging off a mid spine vault via a perpendicular
//     corridor). 30% chance per floor, depth-gated, dead end with
//     reward.
//   - Variable per-connection corridor PROFILES: width from
//     1.6m (squeeze) to 3.4m (gallery), length from 1.8m to 5m.
//   - L-shape allowance: mid spine vaults can offset east or west of
//     the spine to break the linear feel.
//
// Pass B atmosphere lives in vault-library.ts — each vault declares
// its own props (floor glows, candle clusters) so a treasure vault
// can shine warm even inside a cool act.

const CORRIDOR_HEIGHT = 2.8;
const ROOM_ID = (i: number) => `vault-${i}`;
const BRANCH_ROOM_ID = (i: number) => `branch-${i}`;

interface PlacedVault {
  vault: Vault;
  roomId: string;
  offsetX: number;
  offsetZ: number;
}

interface CorridorPlacement {
  rect: { x: number; z: number; w: number; d: number };
  height: number;
  /** For debug — which two placed vaults this connects. */
  fromIdx: number;
  toIdx: number;
}

interface CorridorProfile {
  width: number;
  length: number;
}

/** Roll a corridor profile. Skewed toward "normal" (2.2m × 3m) with
 *  occasional squeezes and galleries. */
function pickCorridorProfile(rand: () => number): CorridorProfile {
  const r = rand();
  const width = r < 0.20 ? 1.6 + rand() * 0.4
              : r < 0.85 ? 2.0 + rand() * 0.6
                         : 2.8 + rand() * 0.6;
  const length = 1.8 + rand() * 3.2;
  return { width, length };
}

/** Compose a LevelSpec for the given floor depth. */
export function composeFloor(
  depth: number,
  rand: () => number,
  nextLevelId: string,
  opts: {
    id: string;
    displayName?: string;
    torchTint?: number;
    fogColor?: number;
    isBossFloor?: boolean;
  },
): LevelSpec {
  // ── 1. Tag sequence for the main spine ─────────────────────────
  const middleCount = clamp(1 + Math.floor((depth - 1) / 2), 1, 4);
  const tagSeq: VaultTag[] = ['start'];
  for (let i = 0; i < middleCount; i++) tagSeq.push(pickMiddleTag(depth, rand));
  tagSeq.push(opts.isBossFloor ? 'boss' : 'exit');

  // ── 2. Resolve + place spine vaults with VARIABLE corridors ────
  // Each mid vault can also offset east or west (L-shape) to break
  // the linear feel — clamped to small offsets so corridors stay
  // reasonable.
  const placed: PlacedVault[] = [];
  const corridors: CorridorPlacement[] = [];
  let zCursor = 0;
  for (let i = 0; i < tagSeq.length; i++) {
    const tag = tagSeq[i];
    const candidates = vaultsForTag(tag, depth);
    const pool = candidates.length > 0
      ? candidates
      : tag === 'exit'
        ? VAULTS.filter((v) => v.tags.includes('exit'))
        : VAULTS.filter((v) => v.tags.includes('combat'));
    const vault = weightedPick(pool, rand);
    const dims = vaultDims(vault);

    if (i === 0) {
      placed.push({ vault, roomId: ROOM_ID(i), offsetX: 0, offsetZ: 0 });
      zCursor = dims.d / 2;
    } else {
      const prev = placed[i - 1];
      const prevDims = vaultDims(prev.vault);
      const profile = pickCorridorProfile(rand);

      // L-shape offset: mid vaults can shift east or west, NOT the
      // exit/boss (we want the final descent clearly at the end of
      // the spine). Clamped so the corridor still connects both
      // perimeter walls along the connecting axis.
      const isMid = tag !== 'exit' && tag !== 'boss';
      const maxLOffset =
        Math.max(0, Math.min(prevDims.w, dims.w) / 2 - profile.width / 2 - 0.5);
      const lOffset = isMid && rand() < 0.45
        ? (rand() * 2 - 1) * maxLOffset
        : 0;

      const corridorNorthZ = zCursor;
      const corridorSouthZ = corridorNorthZ + profile.length;
      const vaultCentreZ = corridorSouthZ + dims.d / 2;
      placed.push({
        vault,
        roomId: ROOM_ID(i),
        offsetX: prev.offsetX + lOffset,
        offsetZ: vaultCentreZ,
      });
      // Corridor centred between the two vaults' x positions so it
      // bridges any L-offset cleanly.
      const corridorMidX = (prev.offsetX + (prev.offsetX + lOffset)) / 2;
      corridors.push({
        rect: {
          x: corridorMidX,
          z: (corridorNorthZ + corridorSouthZ) / 2,
          w: profile.width,
          d: profile.length,
        },
        height: CORRIDOR_HEIGHT,
        fromIdx: i - 1,
        toIdx: i,
      });
      zCursor = vaultCentreZ + dims.d / 2;
    }
  }

  // ── 3. Side branch (30% chance, depth-gated) ───────────────────
  // Pick a random mid spine vault as the branch point; spawn a leaf
  // vault perpendicular to it (east or west) with its own corridor.
  // Dead end — leaf vault has no further connection.
  // Branch chance — gated on having any mid vault to hang off of.
  // Bumped over the earlier "middleCount >= 2" so even depth-1
  // floors (which only get one mid vault) can fork — the user
  // was never seeing non-south corridors because the gate was
  // never satisfied early.
  const wantsBranch = middleCount >= 1 && rand() < (depth >= 3 ? 0.6 : 0.45);
  if (wantsBranch) {
    const branchIdx = 1 + Math.floor(rand() * middleCount);   // mid index
    const parent = placed[branchIdx];
    const parentDims = vaultDims(parent.vault);
    const dir: 1 | -1 = rand() < 0.5 ? 1 : -1;                 // 1 = east
    const leafTag: VaultTag = rand() < 0.5 ? 'treasure' : 'encounter';
    const leafPool = vaultsForTag(leafTag, depth);
    if (leafPool.length > 0) {
      const leaf = weightedPick(leafPool, rand);
      const leafDims = vaultDims(leaf);
      const profile = pickCorridorProfile(rand);
      const corridorWestX = parent.offsetX + dir * (parentDims.w / 2);
      const corridorEastX = corridorWestX + dir * profile.length;
      const leafCentreX = corridorEastX + dir * (leafDims.w / 2);
      const leafIdx = placed.length;
      placed.push({
        vault: leaf,
        roomId: BRANCH_ROOM_ID(leafIdx),
        offsetX: leafCentreX,
        offsetZ: parent.offsetZ,
      });
      corridors.push({
        rect: {
          x: (corridorWestX + corridorEastX) / 2,
          z: parent.offsetZ,
          // For E-W corridors: width = X span (length), depth = Z span (corridor width)
          w: profile.length,
          d: profile.width,
        },
        height: CORRIDOR_HEIGHT,
        fromIdx: branchIdx,
        toIdx: leafIdx,
      });
    }
  }

  // ── 4. Parse each vault and translate to world coords ──────────
  const rooms: RoomSpec[] = [];
  const corridorRooms: RoomSpec[] = [];
  const props: PropSpec[] = [];
  const torches: TorchSpec[] = [];
  const spawns: EnemySpawnSpec[] = [];
  const doors: DoorSpec[] = [];
  const stairs: StairsSpec[] = [];
  const extraWalls: NonNullable<LevelSpec['extraWalls']> = [];
  let startPos: LevelSpec['startPos'] = { x: 0, z: 0, yaw: 0 };

  for (let i = 0; i < placed.length; i++) {
    const pv = placed[i];
    const populated = populateTemplate(pv.vault.map, depth, rand);
    const sub = parseTileMap(populated, {
      id: `${opts.id}-${pv.vault.id}`,
      offsetX: pv.offsetX,
      offsetZ: pv.offsetZ,
      roomId: pv.roomId,
      torchTint: opts.torchTint,
      stairsTarget: nextLevelId,
      roomHeight: pv.vault.roomHeight,
      spawnYaw: pv.vault.tags.includes('start') ? Math.PI : undefined,
    });
    rooms.push(...sub.rooms);
    corridorRooms.push(...sub.corridors);
    props.push(...sub.props);
    torches.push(...sub.torches);
    spawns.push(...sub.spawns);
    if (sub.doors) doors.push(...sub.doors);
    if (sub.stairs) stairs.push(...sub.stairs);
    if (sub.extraWalls) extraWalls.push(...sub.extraWalls);

    if (pv.vault.props) {
      // Vault-local rect for clearance culling — used to drop group
      // children that would clip into a wall.
      const dims = vaultDims(pv.vault);
      const vaultRect = { x: 0, z: 0, w: dims.w, d: dims.d };
      for (const p of pv.vault.props) {
        if (p.kind === 'group') {
          // Expand this group's children in VAULT-local coords,
          // clearance-cull against the vault's own walls, then
          // translate to WORLD via the vault's offset.
          const expanded = expandGroup(p, vaultRect);
          for (const child of expanded) {
            props.push(translateProp(child, pv.offsetX, pv.offsetZ));
          }
        } else {
          props.push(translateProp(p, pv.offsetX, pv.offsetZ));
        }
      }
    }
    if (pv.vault.tags.includes('start')) startPos = sub.startPos;
  }

  // ── 5. Stamp the corridor rects into the LevelSpec ─────────────
  for (let i = 0; i < corridors.length; i++) {
    const c = corridors[i];
    corridorRooms.push({
      id: `corridor-${i}`,
      rect: c.rect,
      height: c.height,
    });
  }

  return {
    id: opts.id,
    depth,
    displayName: opts.displayName,
    fogColor: opts.fogColor,
    startPos,
    rooms,
    corridors: corridorRooms,
    props,
    torches,
    spawns,
    doors,
    stairs,
    extraWalls,
  };
}

// ── helpers ──────────────────────────────────────────────────────

function vaultDims(v: Vault): { w: number; d: number } {
  const rows = v.map.length;
  const cols = Math.max(...v.map.map((r) => r.length));
  // Parser shrinks the rect to the inner walkable area (cell grid
  // minus 1m on each side, since the outer '#' tiles are wall
  // material). Composer matches: corridor edges align with the
  // SHRUNK vault edges so buildRoomShell's findOpenings detects
  // abuttment correctly.
  return { w: Math.max(0, cols - 2), d: Math.max(0, rows - 2) };
}

function pickMiddleTag(depth: number, rand: () => number): VaultTag {
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
  // Every PropSpec variant has x + z at top level. Some have a y for
  // 'model' which we leave alone.
  return { ...p, x: p.x + dx, z: p.z + dz } as PropSpec;
}

/**
 * Expand a group reference into its concrete child props, in
 * VAULT-local coordinates. Children are translated by (group.x,
 * group.z) and rotated around the group origin by group.rotY.
 * Each child is then clearance-culled against the vault's rect —
 * children whose world-pos lands within `minClearance` of any
 * vault wall are dropped. Lets the same group flow into different
 * vault sizes without manually trimming each one.
 */
function expandGroup(
  groupProp: PropSpec & { kind: 'group' },
  vaultRect: { x: number; z: number; w: number; d: number },
): PropSpec[] {
  const groupSpec = PROP_GROUPS[groupProp.groupId];
  if (!groupSpec) {
    // eslint-disable-next-line no-console
    console.warn(`Unknown propGroup id: ${groupProp.groupId}`);
    return [];
  }
  const rotY = groupProp.rotY ?? 0;
  const cosA = Math.cos(rotY);
  const sinA = Math.sin(rotY);
  const out: PropSpec[] = [];
  for (const child of groupSpec.children) {
    const transformed = transformGroupChild(child, groupProp.x, groupProp.z, cosA, sinA, rotY);
    if (!withinClearance(transformed, child.minClearance ?? 0, vaultRect)) continue;
    out.push(transformed);
  }
  return out;
}

/** Rotate child's (x, z) around the group origin, then translate. */
function transformGroupChild(
  child: GroupChild,
  gx: number,
  gz: number,
  cosA: number,
  sinA: number,
  rotY: number,
): PropSpec {
  const cx = child.prop.x;
  const cz = child.prop.z;
  const rx = cx * cosA - cz * sinA;
  const rz = cx * sinA + cz * cosA;
  const result: PropSpec = { ...child.prop, x: gx + rx, z: gz + rz };
  // If the child carries its own rotY (chest / fountain / corpse /
  // model / stash-chest), compound it with the group rotation.
  if ('rotY' in child.prop && rotY !== 0) {
    (result as { rotY?: number }).rotY = (child.prop.rotY ?? 0) + rotY;
  }
  return result;
}

/** Returns true if the prop's vault-local position is at least
 *  `minClearance` metres from each wall of the vault rect. */
function withinClearance(
  prop: PropSpec,
  minClearance: number,
  rect: { x: number; z: number; w: number; d: number },
): boolean {
  if (minClearance <= 0) return true;
  const dWest  = prop.x - (rect.x - rect.w / 2);
  const dEast  = (rect.x + rect.w / 2) - prop.x;
  const dNorth = prop.z - (rect.z - rect.d / 2);
  const dSouth = (rect.z + rect.d / 2) - prop.z;
  const nearest = Math.min(dWest, dEast, dNorth, dSouth);
  return nearest >= minClearance;
}
