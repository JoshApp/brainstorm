import type { LevelSpec, PropSpec, RoomSpec, EnemySpawnSpec, TorchSpec, DoorSpec, StairsSpec, CellBoundEntity } from './types';
import { applyProcgenDefaults } from './decor-defaults';
import { resolvePalette, type PaletteV1 } from './palette';
import { lightingPass } from './lighting-pass';
import { decorPass } from './decor-pass';
import { carvePass, voidCellsCovered } from './carve-pass';
import { actForDepth } from './acts';
import type { Vault, VaultTag } from './vault';
import type { EncounterSpec } from '../content/encounters';
import { vaultsForTag, VAULTS } from './vault-library';
import { parseTileMap } from './tilemap';
import { populateTemplate, type FeatureCell } from './procgen';
import { PROP_GROUPS, type GroupChild } from './prop-groups';
import { applyGeometryWarp, applySurfaceClutter } from './clutter';
import { CONFIG } from '../config';
import { corridorRampRun } from './elevation';
import { resolveAllFacings } from './facing';
import { rollManifest, reconcileManifest } from './floor-manifest';
import { getPropAABB, type PropAABB } from './prop-aabb';
import { STAIRWELL_TOTAL_DEPTH } from '../interactables/stairs';

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

const ROOM_ID = (i: number) => `vault-${i}`;
const BRANCH_ROOM_ID = (i: number) => `branch-${i}`;

interface PlacedVault {
  vault: Vault;
  roomId: string;
  offsetX: number;
  offsetZ: number;
  /** Direction this vault was placed from the previous one — i.e. the way the
   *  player heads IN (the entrance corridor is on the opposite edge). Used to
   *  face an exit vault's stair toward the entrance. Unset for the start. */
  placeDir?: Dir;
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
  height: number;
}

/** Roll a corridor profile. Skewed toward "normal" (2.2m wide × 2.8m
 *  tall) with occasional squeezes and galleries. Width and HEIGHT share
 *  the same roll so the silhouette reads coherent: a narrow corridor is
 *  also low (a tight mine-shaft tunnel you duck through), a wide one is
 *  tall (a vaulted gallery). That vertical variety is what keeps a long
 *  traverse from feeling like one flat tube. */
function pickCorridorProfile(rand: () => number): CorridorProfile {
  const r = rand();
  const width = r < 0.20 ? 1.6 + rand() * 0.4
              : r < 0.85 ? 2.0 + rand() * 0.6
                         : 2.8 + rand() * 0.6;
  const height = r < 0.20 ? 2.3 + rand() * 0.3    // tight + low — mine-shaft tunnel
               : r < 0.85 ? 2.7 + rand() * 0.4    // normal headroom
                          : 3.4 + rand() * 0.6;    // wide + tall — vaulted gallery
  const length = 1.8 + rand() * 3.2;
  return { width, length, height };
}

// ── 2D winding placement ─────────────────────────────────────────────
// The floor used to march due south (a linear Z-spine), so a traverse
// felt like one straight tube. Placement now winds: each vault is dropped
// in a chosen cardinal direction off the previous one — usually
// continuing, often turning, never reversing — with a straight corridor
// bridging the gap. Consecutive segments in different directions read as
// real L-bends. A 2D occupancy list (every vault + corridor AABB) keeps
// the path from crossing itself; a blocked direction falls back to a
// longer straight run so the chain always completes.
//
// Only WHERE pieces land changed: the wall/opening/nav machinery is
// already direction-agnostic (builder.findOpenings punches a gap wherever
// a corridor rect abuts a vault edge, on any of the four sides).

type Dir = 'N' | 'S' | 'E' | 'W';
interface Box { x: number; z: number; w: number; d: number; }
const DIR_VEC: Record<Dir, { x: number; z: number }> = {
  N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 },
};

function vaultBoxOf(pv: { offsetX: number; offsetZ: number }, dims: { w: number; d: number }): Box {
  return { x: pv.offsetX, z: pv.offsetZ, w: dims.w, d: dims.d };
}

/** AABBs overlap if their extents (grown by `margin`) intersect on both axes. */
function boxesOverlap(a: Box, b: Box, margin: number): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin
      && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + margin;
}

/** The two cardinal directions perpendicular to `d` (the available turns). */
function turnsOf(d: Dir): [Dir, Dir] {
  return d === 'N' || d === 'S' ? ['E', 'W'] : ['N', 'S'];
}

/** Geometry for placing `dims` a corridor of `length`×`width` away from a
 *  parent box in direction `dir`, perpendicular-aligned to the parent so
 *  the corridor abuts both walls cleanly (→ findOpenings punches gaps). */
function stepGeometry(
  parent: Box, dims: { w: number; d: number }, dir: Dir, length: number, width: number,
): { vault: Box; corridor: Box } {
  const v = DIR_VEC[dir];
  const alongZ = dir === 'N' || dir === 'S';
  const parentHalf = alongZ ? parent.d / 2 : parent.w / 2;
  const nextHalf = alongZ ? dims.d / 2 : dims.w / 2;
  const vx = parent.x + v.x * (parentHalf + length + nextHalf);
  const vz = parent.z + v.z * (parentHalf + length + nextHalf);
  const cx = parent.x + v.x * (parentHalf + length / 2);
  const cz = parent.z + v.z * (parentHalf + length / 2);
  return {
    vault: { x: vx, z: vz, w: dims.w, d: dims.d },
    corridor: {
      x: cx, z: cz,
      w: alongZ ? width : length,
      d: alongZ ? length : width,
    },
  };
}

/** Pick a ceiling shape for a placed vault. Role + depth-banded so it reads
 *  as deliberate strata, not random noise (per the design rule that ceiling
 *  shape is identity, not decoration): set-pieces vault grandly, the descent
 *  shifts flat → pitched (mine tunnels) → barrel (deep cathedral). Pure
 *  function of (role, depth, index) — no RNG, so it never perturbs the
 *  placement stream and stays reproducible per seed. */
export function ceilingFor(
  vault: Vault, depth: number, index: number,
): { style: 'flat' | 'barrel' | 'pitched'; rise: number } {
  const tags = vault.tags;
  if (tags.includes('boss')) return { style: 'barrel', rise: 1.9 };       // grand set-piece
  if (tags.includes('treasure')) return { style: 'barrel', rise: 1.0 };   // vaulted treasury
  if (tags.includes('start') || tags.includes('exit')) return { style: 'flat', rise: 0 };
  // Combat / encounter rooms shift with the descent.
  if (depth >= 7) return { style: 'barrel', rise: 1.4 };                  // deep — cathedral vaults
  if (depth >= 4) return { style: 'pitched', rise: 1.1 };                 // mid — mine-tunnel A-frames
  // Shallow: alternate flat / low-pitched by index for grounded variety.
  return index % 2 === 0 ? { style: 'flat', rise: 0 } : { style: 'pitched', rise: 0.9 };
}

// rotY per descent direction (matches tilemap.ts: +Z→0, -Z→π, +X→π/2, -X→-π/2).
const STAIR_ROTY: Record<Dir, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

/** Geometry-aware exit-stair placement: put the stair at the BACK of the room
 *  (the wall on the far side of the entrance) descending into that wall, so
 *  its MOUTH faces the entrance and the player walks in and meets it head-on —
 *  instead of arriving at the stair's back and having to skirt around it (the
 *  d4-0wgr soft-lock). `dir` is the direction the vault was placed from the
 *  previous one, i.e. the way the player heads in; the stair descends that way.
 *  Centred on the perpendicular axis for maximal side clearance. */
function reorientExitStair(st: StairsSpec, ox: number, oz: number, dims: { w: number; d: number }, dir: Dir): StairsSpec {
  const INSET = 0.04, D = STAIRWELL_TOTAL_DEPTH, hw = dims.w / 2, hd = dims.d / 2;
  let x = ox, z = oz;
  if (dir === 'S') z = oz + hd - INSET - D;
  else if (dir === 'N') z = oz - hd + INSET + D;
  else if (dir === 'E') x = ox + hw - INSET - D;
  else x = ox - hw + INSET + D;
  return { ...st, x, z, rotY: STAIR_ROTY[dir] };
}

/** Where the boss fog-gate goes — the ENTRANCE edge of the boss vault (the
 *  one the corridor abuts), so the gate seals the real way in instead of
 *  floating mid-arena. Mirror of reorientExitStair but at the OPPOSITE edge:
 *  the stair sits at the back (+placeDir), the gate at the entrance
 *  (−placeDir), with its normal pointing INTO the arena (+placeDir, so
 *  rotY = STAIR_ROTY[dir]). `dir` is the way the player heads in. */
function bossGatePlacement(
  ox: number, oz: number, dims: { w: number; d: number }, dir: Dir,
): { x: number; z: number; rotY: number } {
  const INSET = 0.5, hw = dims.w / 2, hd = dims.d / 2;
  let x = ox, z = oz;
  if (dir === 'S') z = oz - hd + INSET;        // entered from the N edge
  else if (dir === 'N') z = oz + hd - INSET;   // entered from the S edge
  else if (dir === 'E') x = ox - hw + INSET;   // entered from the W edge
  else x = ox + hw - INSET;                    // entered from the E edge
  return { x, z, rotY: STAIR_ROTY[dir] };
}

/** Resolve a vault's encounter archetype: explicit `encounter` wins, else
 *  every combat/boss room gets a coherent `mixed` pack by default (so the
 *  whole library benefits from pack coherence, not just tagged vaults).
 *  Non-combat rooms (treasure/encounter/exit) keep per-tile X unless they
 *  opt in explicitly. */
function encounterFor(vault: Vault): EncounterSpec | undefined {
  if (vault.encounter) return vault.encounter;
  if (vault.tags.includes('combat') || vault.tags.includes('boss')) {
    return { archetype: 'mixed', intensity: 'medium' };
  }
  return undefined;
}

/** Build a faithful single-vault LevelSpec for inspection + piloting — the
 *  SAME per-vault pipeline the composer runs (X enemies resolved via
 *  populateTemplate, prop groups expanded + facings resolved, ceiling / wall /
 *  void treatment) but standalone, no corridors or neighbours. Deterministic
 *  per (id, depth, seed). Returns null if the id is unknown. Used by the
 *  vault-inspector snaps and the `?vault=<id>` pilot entry. */
export function buildVaultPreview(vaultId: string, depth = 5, seed = 1): LevelSpec | null {
  const vault = VAULTS.find((v) => v.id === vaultId);
  if (!vault) return null;
  // Small deterministic PRNG so X-enemy picks are reproducible per seed.
  let s = (seed * 2654435761) >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };

  // Resolve once and reuse below for every pass.
  const resolvedPalette = resolvePalette(actForDepth(depth).palette, vault.palette);
  // Vault preview: allow boss expansion only for boss-tagged
  // vaults so a `vault-boss-hall` preview still shows the king,
  // while a `vault-combat-hall` preview shows an X-rolled mob
  // instead of a stray-B boss.
  const allowBoss = vault.tags.includes('boss');
  const { map: populated, spawns: cellSpawns, features: cellFeatures } = populateTemplate(
    vault.map, depth, rand, encounterFor(vault), resolvedPalette, allowBoss,
  );
  const ceil = ceilingFor(vault, depth, 1);
  const sub = parseTileMap(populated, {
    id: `vault-preview-${vault.id}`,
    offsetX: 0, offsetZ: 0,
    roomId: 'vault-0',
    torchTint: vault.torchTint,
    roomHeight: vault.roomHeight,
    ceilingStyle: ceil.style,
    ceilingRise: ceil.rise,
    wallVariant: vault.wallVariant,
    perimeterFitting: vault.perimeterFitting,
    lightTier: vault.lightTier,
    spawnYaw: Math.PI,
  });

  const props: PropSpec[] = [...sub.props];
  const previewSpawns = [...sub.spawns];
  if (vault.props) {
    const dims = vaultDims(vault);
    const vaultRect = { x: 0, z: 0, w: dims.w, d: dims.d };
    for (const p of vault.props) {
      if (p.kind === 'group') {
        for (const child of expandGroup(p, vaultRect)) props.push(translateProp(child, 0, 0));
      } else if (p.kind === 'spawn') {
        previewSpawns.push({ enemyId: p.enemyId, x: p.x, z: p.z, roomId: p.roomId ?? 'vault-0' });
      } else {
        props.push(translateProp(p, 0, 0));
      }
    }
  }
  // X-roll + B-boss spawns from the populated template — same cell-
  // to-world math as the composer; preview has no placement offset
  // so just centre on the vault's grid.
  if (cellSpawns.length) {
    const W = vault.map[0]?.length ?? 0;
    const D = vault.map.length;
    for (const cs of cellSpawns) {
      previewSpawns.push({
        enemyId: cs.enemyId,
        x: cs.col + 0.5 - W / 2,
        z: cs.row + 0.5 - D / 2,
        roomId: 'vault-0',
      });
    }
  }
  // Sophisticated torches authored on the vault (offset 0 in
  // preview — the vault is centred on origin).
  const previewTorches: TorchSpec[] = [...sub.torches];
  if (vault.torches) previewTorches.push(...vault.torches);

  // Cell-bound entities (Format C) — preview has no placement
  // offset so the helper routes everything in vault-local space.
  applyCellProps(vault, 0, 0, 'vault-0', depth, rand, {
    spawns: previewSpawns,
    torches: previewTorches,
    props,
  });
  // $ / ? slot rolls (chest / fountain / altar) — vault-local in preview.
  routeFeatures(cellFeatures, vault.map[0]?.length ?? 0, vault.map.length, 0, 0, depth, rand, props);

  // Cascade + pass pipeline mirroring composeFloor. resolvedPalette
  // is declared above (passed into populateTemplate for encounter/
  // event gating).
  const Wprev = vault.map[0]?.length ?? 0;
  const Dprev = vault.map.length;
  // Carve pass — runs first; voids become forbidden cells for the
  // light/decor passes that follow.
  const carveOccupiedPrev = new Set<string>(Object.keys(vault.cellProps ?? {}));
  const procPreviewVoids = carvePass(vault, resolvedPalette, carveOccupiedPrev, rand);
  const carvedCellsPrev = voidCellsCovered(procPreviewVoids, Wprev, Dprev);
  // Lighting pass — author lights + carved voids excluded.
  const existingTorchCellsPreview = new Set<string>(carvedCellsPrev);
  for (const t of previewTorches) {
    const col = Math.round(t.x - 0.5 + Wprev / 2);
    const row = Math.round(t.z - 0.5 + Dprev / 2);
    existingTorchCellsPreview.add(`${col},${row}`);
  }
  for (const [key, entries] of Object.entries(vault.cellProps ?? {})) {
    if (!entries) continue;
    if (entries.some((e) => e.kind === 'torch')) existingTorchCellsPreview.add(key);
  }
  const procPreviewTorches = lightingPass(vault, resolvedPalette, existingTorchCellsPreview, rand);
  previewTorches.push(...procPreviewTorches);
  // Decor pass for the preview — same occupancy union as the
  // composer path.
  const occupiedCellsPreview = new Set<string>(existingTorchCellsPreview);
  for (const key of Object.keys(vault.cellProps ?? {})) occupiedCellsPreview.add(key);
  for (const t of procPreviewTorches) {
    const col = Math.round(t.x - 0.5 + Wprev / 2);
    const row = Math.round(t.z - 0.5 + Dprev / 2);
    occupiedCellsPreview.add(`${col},${row}`);
  }
  props.push(...decorPass(vault, resolvedPalette, occupiedCellsPreview, rand));


  const spec: LevelSpec = {
    ...sub,
    id: `vault-preview-${vault.id}`,
    depth,
    props,
    spawns: previewSpawns,
    torches: previewTorches,
    voids: [
      ...(vault.voids ?? []).map((v) => ({ x: v.x, z: v.z, w: v.w, d: v.d })),
      ...procPreviewVoids,
    ],
  };
  resolveAllFacings(spec);   // orient declarative-facing props (no full warp/clutter)
  return spec;
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
    /** Preferred boss vault id — when set, the boss-tag slot
     *  prefers this vault if it's in the eligible pool for the
     *  current depth. Falls through to weighted-pick when the
     *  preference isn't available (wrong depth, removed from
     *  library, etc) so a missing preference never breaks gen. */
    preferredBossVaultId?: string;
    /** Hex tint for the boss-mist fog wall on the boss vault.
     *  Sourced from BossSpec.mistColor by the procgen layer. The
     *  composer emits a `boss-mist` prop at the boss vault's
     *  declared bossMist position with this colour. */
    bossMistColor?: number;
  },
): LevelSpec {
  // ── 1. Tag sequence for the main spine ─────────────────────────
  const middleCount = clamp(1 + Math.floor((depth - 1) / 2), 1, 4);
  const tagSeq: VaultTag[] = ['start'];
  for (let i = 0; i < middleCount; i++) tagSeq.push(pickMiddleTag(depth, rand));
  tagSeq.push(opts.isBossFloor ? 'boss' : 'exit');

  // ── 2. Place spine vaults along a WINDING 2D path ──────────────
  const placed: PlacedVault[] = [];
  const corridors: CorridorPlacement[] = [];
  const occupied: Box[] = [];   // every vault + corridor AABB (self-intersection guard)
  const MARGIN = 1.0;           // min gap between unrelated pieces (no clipped walls)
  let heading: Dir = 'S';       // start faces its entrance; the first move heads in
  let prevBox: Box = { x: 0, z: 0, w: 0, d: 0 };

  for (let i = 0; i < tagSeq.length; i++) {
    const tag = tagSeq[i];
    const candidates = vaultsForTag(tag, depth);
    const pool = candidates.length > 0
      ? candidates
      : tag === 'exit'
        ? VAULTS.filter((v) => v.tags.includes('exit'))
        : VAULTS.filter((v) => v.tags.includes('combat'));
    // Boss-vault preference: if this slot is the boss tag AND the
    // current boss has a preferredVaultId set AND that vault is in
    // the eligible pool, USE it directly. Otherwise fall through to
    // weighted-pick — the preference never blocks generation.
    const preferred = tag === 'boss' && opts.preferredBossVaultId
      ? pool.find((v) => v.id === opts.preferredBossVaultId)
      : undefined;
    const vault = preferred ?? weightedPick(pool, rand);
    const dims = vaultDims(vault);

    if (i === 0) {
      placed.push({ vault, roomId: ROOM_ID(0), offsetX: 0, offsetZ: 0 });
      prevBox = vaultBoxOf({ offsetX: 0, offsetZ: 0 }, dims);
      occupied.push(prevBox);
      continue;
    }

    const profile = pickCorridorProfile(rand);
    // Straight bias for the first move (a clean exit from the start vault)
    // and the last (a clearly-terminal descent to boss/exit). Mids wind:
    // about half the time they turn before continuing.
    const straightBias = i === 1 || tag === 'exit' || tag === 'boss';
    const [t0, t1] = turnsOf(heading);
    const turns = rand() < 0.5 ? [t0, t1] : [t1, t0];
    const order: Dir[] = straightBias || rand() < 0.5
      ? [heading, ...turns]
      : [...turns, heading];

    // Accept the first direction whose vault + corridor don't collide. The
    // corridor abuts prevBox by design, so prevBox is excluded from ITS test.
    let chosen: { vault: Box; corridor: Box; dir: Dir } | null = null;
    for (const dir of order) {
      const g = stepGeometry(prevBox, dims, dir, profile.length, profile.width);
      const vaultClear = !occupied.some((o) => boxesOverlap(g.vault, o, MARGIN));
      const corrClear = !occupied.some((o) => o !== prevBox && boxesOverlap(g.corridor, o, MARGIN));
      if (vaultClear && corrClear) { chosen = { ...g, dir }; break; }
    }
    // Fallback: push straight in `heading`, lengthening the corridor until it
    // clears. Terminates — far enough out, nothing is there.
    if (!chosen) {
      let len = profile.length;
      for (let tries = 0; tries < 24 && !chosen; tries++) {
        len += 2.5;
        const g = stepGeometry(prevBox, dims, heading, len, profile.width);
        const vaultClear = !occupied.some((o) => boxesOverlap(g.vault, o, MARGIN));
        const corrClear = !occupied.some((o) => o !== prevBox && boxesOverlap(g.corridor, o, MARGIN));
        if (vaultClear && corrClear) chosen = { ...g, dir: heading };
      }
      if (!chosen) {
        const g = stepGeometry(prevBox, dims, heading, profile.length, profile.width);
        chosen = { ...g, dir: heading };
      }
    }

    placed.push({ vault, roomId: ROOM_ID(i), offsetX: chosen.vault.x, offsetZ: chosen.vault.z, placeDir: chosen.dir });
    corridors.push({ rect: chosen.corridor, height: profile.height, fromIdx: i - 1, toIdx: i });
    occupied.push(chosen.vault);
    occupied.push(chosen.corridor);
    prevBox = chosen.vault;
    heading = chosen.dir;
  }

  // ── 3. Side branch — a dead-end leaf off a mid vault ───────────
  // With the spine now winding, this is bonus exploration (a treasure or
  // encounter pocket) dropped in whatever free cardinal direction fits off
  // a random mid vault. Occupancy-checked so it never clips the path; if
  // no direction is clear it's simply skipped.
  const wantsBranch = middleCount >= 1 && rand() < (depth >= 3 ? 0.6 : 0.45);
  if (wantsBranch) {
    const branchIdx = 1 + Math.floor(rand() * middleCount);   // mid index
    const parent = placed[branchIdx];
    const parentBox = vaultBoxOf(parent, vaultDims(parent.vault));
    const sameAsParent = (o: Box) =>
      o.x === parentBox.x && o.z === parentBox.z && o.w === parentBox.w && o.d === parentBox.d;
    const leafTag: VaultTag = rand() < 0.5 ? 'treasure' : 'encounter';
    const leafPool = vaultsForTag(leafTag, depth);
    if (leafPool.length > 0) {
      const leaf = weightedPick(leafPool, rand);
      const leafDims = vaultDims(leaf);
      const profile = pickCorridorProfile(rand);
      // Shuffle the four cardinals; take the first that fits.
      const dirs: Dir[] = ['N', 'S', 'E', 'W'];
      for (let k = dirs.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
      }
      for (const dir of dirs) {
        const g = stepGeometry(parentBox, leafDims, dir, profile.length, profile.width);
        const vaultClear = !occupied.some((o) => boxesOverlap(g.vault, o, MARGIN));
        const corrClear = !occupied.some((o) => !sameAsParent(o) && boxesOverlap(g.corridor, o, MARGIN));
        if (vaultClear && corrClear) {
          const leafIdx = placed.length;
          placed.push({ vault: leaf, roomId: BRANCH_ROOM_ID(leafIdx), offsetX: g.vault.x, offsetZ: g.vault.z, placeDir: dir });
          corridors.push({ rect: g.corridor, height: profile.height, fromIdx: branchIdx, toIdx: leafIdx });
          occupied.push(g.vault);
          occupied.push(g.corridor);
          break;
        }
      }
    }
  }

  // ── 3b. DESCENT BIAS — assign each vault an elevation ───────────
  // Floors trend DOWNWARD, never up: every corridor rolls a drop from
  // CONFIG.ELEVATION_DROP_WEIGHTS (flat stays the majority), clamped to
  // what its stair-run carries at ELEVATION_MAX_GRADE. Corridors are
  // recorded in connection order (spine, then branch), so fromIdx is
  // always assigned before toIdx — one forward pass settles the floor.
  // Monotonic descent means the boss/exit vault is ALWAYS the lowest
  // point: the player walks down into the end of every floor, and depth
  // reads as progress without a tutorial line. Fittings (doors, webs,
  // fog gates) install on the corridors' FLAT mouth aprons, so gated
  // thresholds stay level ground by construction.
  const elevations: number[] = placed.map(() => 0);
  for (const c of corridors) {
    const roll = weightedPick(
      CONFIG.ELEVATION_DROP_WEIGHTS.map((d) => ({ ...d })), rand,
    ).drop;
    const run = corridorRampRun(Math.max(c.rect.w, c.rect.d));
    const drop = Math.min(roll, run * CONFIG.ELEVATION_MAX_GRADE);
    elevations[c.toIdx] = elevations[c.fromIdx] - drop;
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
  const voids: NonNullable<LevelSpec['voids']> = [];
  const navGates: NonNullable<LevelSpec['navGates']> = [];
  let startPos: LevelSpec['startPos'] = { x: 0, z: 0, yaw: 0 };
  // Provenance: which vault TEMPLATE generated each room. The room ids
  // (`vault-0`, `branch-2`) are positional; this maps them back to the
  // authored template name (`lattice`, `blood-altar-chamber`) so the
  // debug capture tool can report "you're standing in the X vault."
  const roomVaults: Record<string, string> = {};

  for (let i = 0; i < placed.length; i++) {
    const pv = placed[i];
    roomVaults[pv.roomId] = pv.vault.id;
    // Resolve palette once per vault — feeds populateTemplate's
    // encounter/event gating AND the carve/light/decor passes below.
    const resolvedPalette = resolvePalette(actForDepth(depth).palette, pv.vault.palette);
    // Only the boss-tagged vault on a boss floor expands B → boss.
    // Stray B chars in non-boss vaults (combat-hall, combat-doors)
    // fall through to a rolled-enemy spawn — guards against a
    // duplicate boss in a pre-arena room.
    const allowBoss = opts.isBossFloor === true && pv.vault.tags.includes('boss');
    const { map: populated, spawns: cellSpawns, features: cellFeatures } = populateTemplate(
      pv.vault.map, depth, rand, encounterFor(pv.vault), resolvedPalette, allowBoss,
    );
    const ceil = ceilingFor(pv.vault, depth, i);
    const sub = parseTileMap(populated, {
      id: `${opts.id}-${pv.vault.id}`,
      offsetX: pv.offsetX,
      offsetZ: pv.offsetZ,
      roomId: pv.roomId,
      // Per-vault override wins over the act default — the
      // tonal mood of a chamber comes from its torches.
      torchTint: pv.vault.torchTint ?? opts.torchTint,
      stairsTarget: nextLevelId,
      roomHeight: pv.vault.roomHeight,
      ceilingStyle: ceil.style,
      ceilingRise: ceil.rise,
      wallVariant: pv.vault.wallVariant,
      perimeterFitting: pv.vault.perimeterFitting,
      lightTier: pv.vault.lightTier,
      spawnYaw: pv.vault.tags.includes('start') ? Math.PI : undefined,
      depth,
    });
    // Whole-vault elevation: the main room AND its logical sub-rooms sit
    // on one plateau (rooms are internally flat — see RoomSpec.elevation).
    for (const r of sub.rooms) r.elevation = elevations[i];
    rooms.push(...sub.rooms);
    corridorRooms.push(...sub.corridors);
    props.push(...sub.props);
    torches.push(...sub.torches);
    spawns.push(...sub.spawns);
    if (sub.doors) doors.push(...sub.doors);
    if (sub.navGates) navGates.push(...sub.navGates);
    if (sub.stairs && sub.stairs.length) {
      // Exit-vault stairs: re-place at the back of the room facing the entrance
      // (geometry-aware), so the player meets the mouth head-on. Other stairs
      // (boss vaults, hand-authored) keep their authored orientation.
      if (pv.vault.tags.includes('exit') && pv.placeDir) {
        const dims = vaultDims(pv.vault);
        for (const st of sub.stairs) stairs.push(reorientExitStair(st, pv.offsetX, pv.offsetZ, dims, pv.placeDir));
      } else {
        stairs.push(...sub.stairs);
      }
    }
    if (sub.extraWalls) extraWalls.push(...sub.extraWalls);

    // X-roll + B-boss spawns extracted from the populated template.
    // Cell (col, row) → world coords via the same math parseTileMap
    // uses (vault centred on its own midpoint, then translated by
    // the vault's placement offset). Attribute every spawn to the
    // vault's room so room-clear gating works.
    if (cellSpawns.length) {
      const W = pv.vault.map[0]?.length ?? 0;
      const D = pv.vault.map.length;
      for (const cs of cellSpawns) {
        spawns.push({
          enemyId: cs.enemyId,
          x: cs.col + 0.5 - W / 2 + pv.offsetX,
          z: cs.row + 0.5 - D / 2 + pv.offsetZ,
          roomId: pv.roomId,
          dormant: cs.dormant,
        });
      }
    }
    // $ / ? slot rolls (chest / fountain / altar) → world-coord props
    // through the same applyProcgenDefaults path as authored cellProps.
    routeFeatures(
      cellFeatures, pv.vault.map[0]?.length ?? 0, pv.vault.map.length,
      pv.offsetX, pv.offsetZ, depth, rand, props,
    );

    // Boss-mist fog wall (boss floors only). The boss vault declares
    // its threshold via vault.bossMist; we tint with the act's boss
    // mistColor and emit a boss-mist prop at the world position. The
    // builder picks up the kind and wires the cross trigger + seal.
    if (opts.isBossFloor && pv.vault.tags.includes('boss')
        && opts.bossMistColor !== undefined) {
      const dims = vaultDims(pv.vault);
      // Place at the real entrance (derived from how the corridor connected),
      // sized to the corridor it seals. Fall back to the authored bossMist
      // coord only if this vault somehow wasn't placed off a connection.
      if (pv.placeDir) {
        const g = bossGatePlacement(pv.offsetX, pv.offsetZ, dims, pv.placeDir);
        const conn = corridors.find((c) => c.toIdx === i);
        const alongZ = pv.placeDir === 'N' || pv.placeDir === 'S';
        const corridorWidth = conn
          ? (alongZ ? conn.rect.w : conn.rect.d)
          : 3.4;
        props.push({
          kind: 'boss-mist',
          x: g.x, z: g.z, rotY: g.rotY,
          color: opts.bossMistColor,
          width: corridorWidth,
        });
      } else if (pv.vault.bossMist) {
        const m = pv.vault.bossMist;
        props.push({
          kind: 'boss-mist',
          x: m.x + pv.offsetX, z: m.z + pv.offsetZ, rotY: m.rotY ?? 0,
          color: opts.bossMistColor,
        });
      }
    }

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
            const tp = translateProp(child, pv.offsetX, pv.offsetZ);
            if (tp.kind === 'model') tp._dbg = `group:${p.groupId}@${pv.vault.id}`;
            props.push(tp);
          }
        } else if (p.kind === 'spawn') {
          // Spawn-prop: route into the spawns list rather than props
          // (it's a mob instantiation, not a static mesh). World
          // coords = vault-local + the vault's placement offset.
          // Defaults the room id to the vault's room so room-clear
          // gating attributes the kill correctly.
          spawns.push({
            enemyId: p.enemyId,
            x: p.x + pv.offsetX,
            z: p.z + pv.offsetZ,
            roomId: p.roomId ?? pv.roomId,
          });
        } else {
          const tp = translateProp(p, pv.offsetX, pv.offsetZ);
          if (tp.kind === 'model') tp._dbg = `vault:${pv.vault.id}`;
          props.push(tp);
        }
      }
    }
    // Sophisticated torch placement — translate vault-local coords
    // to world via the placement offset. Stacks on top of any
    // T/t/</> chars in the ASCII map (those went through parseTileMap
    // and are already in sub.torches).
    if (pv.vault.torches) {
      for (const t of pv.vault.torches) {
        torches.push({ ...t, x: t.x + pv.offsetX, z: t.z + pv.offsetZ });
      }
    }
    // Cell-bound entities (Format C) — torches / spawns / props
    // keyed by ASCII cell, routed to their slots after world-coord
    // translation. See applyCellProps for the dispatch.
    applyCellProps(pv.vault, pv.offsetX, pv.offsetZ, pv.roomId, depth, rand, { spawns, torches, props });

    // resolvedPalette is declared above (passed into populateTemplate
    // for encounter/event gating — reused here for the carve/light/
    // decor passes so the cascade is consistent).

    // ── Carve pass — must run FIRST so lighting + decor see the
    // post-carve walkable region and skip cells the holes occupy.
    const carveOccupied = new Set<string>();
    for (const key of Object.keys(pv.vault.cellProps ?? {})) carveOccupied.add(key);
    const procVoids = carvePass(pv.vault, resolvedPalette, carveOccupied, rand);
    const W = pv.vault.map[0]?.length ?? 0;
    const D = pv.vault.map.length;
    const carvedCells = voidCellsCovered(procVoids, W, D);
    for (const v of procVoids) {
      voids.push({ x: v.x + pv.offsetX, z: v.z + pv.offsetZ, w: v.w, d: v.d });
    }

    // ── Lighting pass — wall torches by intent ────────────────────
    // Collect cells the author already lit + cells the carve pass
    // punched holes in. Reverse-map sub.torches (world coords with
    // WALL_OFFSET) back to (col, row) via rounding so corner-cell
    // *'s land in the same dedup set.
    const existingTorchCells = new Set<string>(carvedCells);
    for (const t of sub.torches) {
      // sub.torches are already in world coords with the WALL_OFFSET
      // applied; back out approximately to cell. Tolerance ±0.5 by
      // rounding (this picks up corner-cell *'s too).
      const localX = t.x - pv.offsetX;
      const localZ = t.z - pv.offsetZ;
      const col = Math.round(localX - 0.5 + W / 2);
      const row = Math.round(localZ - 0.5 + D / 2);
      existingTorchCells.add(`${col},${row}`);
    }
    // Cell-bound author torches (kind: 'torch' inside cellProps).
    for (const [key, entries] of Object.entries(pv.vault.cellProps ?? {})) {
      if (!entries) continue;
      if (entries.some((e) => e.kind === 'torch')) existingTorchCells.add(key);
    }
    const procTorches = lightingPass(pv.vault, resolvedPalette, existingTorchCells, rand);
    for (const t of procTorches) {
      torches.push({ ...t, x: t.x + pv.offsetX, z: t.z + pv.offsetZ });
    }

    // ── Decor pass — pillars / debris / etc by intent ────────────
    // Builds occupiedCells from the union of: every cellProps key
    // (anything author-placed in a cell), every author torch cell,
    // every procedural torch cell. Then runs the decor pass over
    // wall-edge candidates and rejects collisions.
    const occupiedCells = new Set<string>(existingTorchCells);
    for (const key of Object.keys(pv.vault.cellProps ?? {})) occupiedCells.add(key);
    for (const t of procTorches) {
      const col = Math.round(t.x - 0.5 + W / 2);
      const row = Math.round(t.z - 0.5 + D / 2);
      occupiedCells.add(`${col},${row}`);
    }
    const procDecor = decorPass(pv.vault, resolvedPalette, occupiedCells, rand);
    for (const p of procDecor) {
      props.push(translateProp(p, pv.offsetX, pv.offsetZ));
    }

    if (pv.vault.tags.includes('start')) startPos = sub.startPos;
    // Chasm voids → world coords (vault-local + the vault's offset).
    if (pv.vault.voids) {
      for (const v of pv.vault.voids) {
        voids.push({ x: v.x + pv.offsetX, z: v.z + pv.offsetZ, w: v.w, d: v.d });
      }
    }
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

  // Build the intermediate LevelSpec — props / torches will be
  // mutated by the decoration pipeline below.
  const result: LevelSpec = {
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
    voids,
    navGates,
    roomVaults,
  };

  // ── DECORATION PIPELINE ────────────────────────────────────────
  // Three clearly delineated phases:
  //
  //   Phase 0: Manifest reconciliation — apply per-floor caps so two
  //            fountain-bearing vaults can't double up the heal supply.
  //            Runs FIRST so downstream phases never see the stripped
  //            props (no orphan facings to resolve, no orphan clutter
  //            to anchor around them).
  //   Phase A: Facing resolution — walk every prop with a
  //            declarative `facing` directive (wall-away,
  //            wall-toward, point-away, point-toward) and
  //            replace it with a concrete rotY. Runs first so
  //            all downstream stages see final orientations.
  //   Phase B: Geometry warp — archways with column collision,
  //            buttresses + ruined columns with collision,
  //            corner mounds + wall piles for visual mass,
  //            torch reconciliation against final wall set.
  //   Phase C: Surface decoration — debris, cracks, wall damage.
  const manifest = rollManifest(depth, rand);
  reconcileManifest(result, manifest, rand);
  resolveAllFacings(result);
  applyGeometryWarp(result, rand);
  applySurfaceClutter(result, rand);
  // PROGRESSION GUARANTEE — two-phase safety net.
  //
  //  Phase 1 (preferred): nudge every collision-bearing prop out of
  //  passage zones (corridor rects + door clearance bubbles). Most
  //  cases resolve here — the chest just slides against the nearest
  //  wall, reads as "intentional placement," and player can both
  //  open the chest AND continue down the corridor.
  //
  //  Phase 2 (fallback): the chest-specific noCollision path stays
  //  as a last resort for cases Phase 1 can't resolve (prop AABB
  //  larger than the available wall offset). Chest is preserved
  //  visible + interactable; the player walks through it.
  //
  // A reachability check sits over the top: BFS from spawn through
  // a coarse walkability grid (rooms + corridors minus prop AABBs).
  // Any stair not reachable from spawn means a non-corridor block
  // (e.g. chest in a doorway between two sub-rooms). Walk the path
  // and disable collision on whichever prop is the bottleneck.
  nudgePropsOutOfPassages(result);
  clearChestsBlockingCorridors(result);
  ensureStairsReachable(result);

  return result;
}

// ── Passage clearance ────────────────────────────────────────────────

/** Build the set of "passage zones" — areas the player MUST be able
 *  to walk through to advance. Corridors are the obvious case;
 *  doors get a small clearance bubble around them so a chest sitting
 *  right at the doorway gets nudged too. */
function buildPassageAabbs(spec: LevelSpec): PropAABB[] {
  const out: PropAABB[] = [];
  // Corridor rects.
  for (const c of spec.corridors ?? []) {
    out.push({
      minX: c.rect.x - c.rect.w / 2,
      maxX: c.rect.x + c.rect.w / 2,
      minZ: c.rect.z - c.rect.d / 2,
      maxZ: c.rect.z + c.rect.d / 2,
    });
  }
  // Door clearance bubbles — ±0.55m around each door's midpoint.
  // Slightly larger than a 1m door so a prop hugging the door's edge
  // also gets nudged.
  const DOOR_HALF = 0.55;
  for (const d of spec.doors ?? []) {
    const cx = (d.ax + d.bx) / 2;
    const cz = (d.az + d.bz) / 2;
    out.push({
      minX: cx - DOOR_HALF, maxX: cx + DOOR_HALF,
      minZ: cz - DOOR_HALF, maxZ: cz + DOOR_HALF,
    });
  }
  return out;
}

function aabbsOverlap(a: PropAABB, b: PropAABB): boolean {
  return a.maxX > b.minX && a.minX < b.maxX &&
         a.maxZ > b.minZ && a.minZ < b.maxZ;
}

/** Try to nudge a prop out of every passage AABB it overlaps. Greedy:
 *  pick the smallest axis-aligned escape distance per overlap and
 *  apply it. Returns true if the prop is fully clear of passages
 *  afterward, false if a single overlap needs > MAX_NUDGE_M to escape. */
const MAX_NUDGE_M = 1.0;
function nudgePropsOutOfPassages(spec: LevelSpec): void {
  const passages = buildPassageAabbs(spec);
  if (passages.length === 0) return;
  for (const prop of spec.props) {
    if (!('x' in prop) || !('z' in prop)) continue;
    // GATE FRAMES ARE EXEMPT. Doorframes/archways BELONG on the passage
    // line — their collision is authored to flank the walk band (jambs/
    // columns at the gap edges, centre guaranteed passable). Nudging one
    // judges overlap by getPropAABB's FIRST collision shape (one jamb),
    // slides the whole frame until that jamb clears the corridor, and
    // swings the OTHER column into the middle of the gap — the "pillar
    // standing in the doorway" bug. They are placed exactly where they
    // must stand; leave them there.
    if (prop.kind === 'model' && (prop._dbg === 'doorframe' || prop._dbg === 'archway')) continue;
    // Best-effort loop: re-evaluate AABB each iteration since nudges
    // accumulate. Hard cap iterations so a prop pinned between two
    // passages can't loop forever.
    for (let iter = 0; iter < 6; iter++) {
      const aabb = getPropAABB(prop);
      if (!aabb) break;
      const overlap = passages.find((p) => aabbsOverlap(aabb, p));
      if (!overlap) break;
      // Compute the four axis-aligned escapes from this passage.
      const escapes: Array<{ dx: number; dz: number; cost: number }> = [
        { dx: overlap.maxX - aabb.minX + 0.02, dz: 0, cost: overlap.maxX - aabb.minX + 0.02 },
        { dx: -(aabb.maxX - overlap.minX + 0.02), dz: 0, cost: aabb.maxX - overlap.minX + 0.02 },
        { dx: 0, dz: overlap.maxZ - aabb.minZ + 0.02, cost: overlap.maxZ - aabb.minZ + 0.02 },
        { dx: 0, dz: -(aabb.maxZ - overlap.minZ + 0.02), cost: aabb.maxZ - overlap.minZ + 0.02 },
      ].sort((a, b) => a.cost - b.cost);
      const best = escapes[0];
      if (best.cost > MAX_NUDGE_M) break;  // can't nudge — leave to fallback
      (prop as { x: number; z: number }).x += best.dx;
      (prop as { x: number; z: number }).z += best.dz;
    }
  }
}

/** Final-resort chest fallback: any chest still overlapping a
 *  corridor after the nudge pass loses its collision. The nudge
 *  pass usually resolves this; this catches the few cases where the
 *  nearest wall is > MAX_NUDGE_M away (very narrow vaults, props in
 *  the middle of a corridor cell). */
function clearChestsBlockingCorridors(result: LevelSpec): void {
  if (!result.corridors || result.corridors.length === 0) return;
  const corridorAabbs = result.corridors.map((c) => ({
    minX: c.rect.x - c.rect.w / 2,
    maxX: c.rect.x + c.rect.w / 2,
    minZ: c.rect.z - c.rect.d / 2,
    maxZ: c.rect.z + c.rect.d / 2,
  }));
  for (const prop of result.props) {
    if (prop.kind !== 'chest') continue;
    const aabb = getPropAABB(prop);
    if (!aabb) continue;
    if (corridorAabbs.some((c) => aabbsOverlap(aabb, c))) {
      prop.noCollision = true;
    }
  }
}

// ── Reachability safety net ─────────────────────────────────────────

/** BFS-based reachability check from the player's spawn to every
 *  stair. If a stair is unreachable, scan the props blocking the
 *  shortest path-by-bbox-overlap and disable collision on the first
 *  CHEST in the way (the only kind we know carries noCollision today).
 *  Catches blocks that aren't corridor-related: a chest pinned
 *  between two sub-rooms in a multi-room vault, an altar dropped in
 *  the only doorway, etc.
 *
 *  Cell-grid resolution is 0.5m — coarse enough to be cheap (a 30×30m
 *  floor is 60×60 cells = 3600 cells) and fine enough to catch
 *  prop-sized obstructions. */
const REACH_CELL_M = 0.5;

function ensureStairsReachable(spec: LevelSpec): void {
  const stairs = spec.stairs ?? [];
  if (stairs.length === 0) return;
  // Build walkable cell grid covering the floor's bbox.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of [...spec.rooms, ...spec.corridors]) {
    minX = Math.min(minX, r.rect.x - r.rect.w / 2);
    maxX = Math.max(maxX, r.rect.x + r.rect.w / 2);
    minZ = Math.min(minZ, r.rect.z - r.rect.d / 2);
    maxZ = Math.max(maxZ, r.rect.z + r.rect.d / 2);
  }
  if (!isFinite(minX)) return;
  const cellsX = Math.ceil((maxX - minX) / REACH_CELL_M);
  const cellsZ = Math.ceil((maxZ - minZ) / REACH_CELL_M);
  const cellWalkable = new Uint8Array(cellsX * cellsZ);
  const idx = (cx: number, cz: number) => cz * cellsX + cx;
  // Mark cells inside any room/corridor as walkable.
  for (const r of [...spec.rooms, ...spec.corridors]) {
    const rMinX = r.rect.x - r.rect.w / 2;
    const rMaxX = r.rect.x + r.rect.w / 2;
    const rMinZ = r.rect.z - r.rect.d / 2;
    const rMaxZ = r.rect.z + r.rect.d / 2;
    const c0x = Math.max(0, Math.floor((rMinX - minX) / REACH_CELL_M));
    const c1x = Math.min(cellsX - 1, Math.floor((rMaxX - minX) / REACH_CELL_M));
    const c0z = Math.max(0, Math.floor((rMinZ - minZ) / REACH_CELL_M));
    const c1z = Math.min(cellsZ - 1, Math.floor((rMaxZ - minZ) / REACH_CELL_M));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        cellWalkable[idx(cx, cz)] = 1;
      }
    }
  }
  // Map of cell → blocking prop (the first prop that marked it
  // unwalkable). Lets the rescue step undo a specific blocker.
  const cellBlocker = new Map<number, PropSpec>();
  for (const prop of spec.props) {
    // Chests can be rescued by setting noCollision; other kinds
    // can't be (no flag on their type), so we skip recording them
    // as rescuable. They still block reachability, just irrecoverably.
    if (prop.kind !== 'chest') continue;
    if (prop.noCollision) continue;
    const aabb = getPropAABB(prop);
    if (!aabb) continue;
    const c0x = Math.max(0, Math.floor((aabb.minX - minX) / REACH_CELL_M));
    const c1x = Math.min(cellsX - 1, Math.floor((aabb.maxX - minX) / REACH_CELL_M));
    const c0z = Math.max(0, Math.floor((aabb.minZ - minZ) / REACH_CELL_M));
    const c1z = Math.min(cellsZ - 1, Math.floor((aabb.maxZ - minZ) / REACH_CELL_M));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const i = idx(cx, cz);
        if (cellWalkable[i]) {
          cellWalkable[i] = 0;
          cellBlocker.set(i, prop);
        }
      }
    }
  }
  // Chasm voids block reachability (you must route via the bridge). Zero
  // their cells so the BFS can't path across the abyss; if no bridge
  // connects, the stairs come back unreachable and surface the bad layout.
  for (const v of spec.voids ?? []) {
    const c0x = Math.max(0, Math.floor((v.x - v.w / 2 - minX) / REACH_CELL_M));
    const c1x = Math.min(cellsX - 1, Math.floor((v.x + v.w / 2 - minX) / REACH_CELL_M));
    const c0z = Math.max(0, Math.floor((v.z - v.d / 2 - minZ) / REACH_CELL_M));
    const c1z = Math.min(cellsZ - 1, Math.floor((v.z + v.d / 2 - minZ) / REACH_CELL_M));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) cellWalkable[idx(cx, cz)] = 0;
    }
  }

  // BFS from spawn.
  const sx = Math.floor((spec.startPos.x - minX) / REACH_CELL_M);
  const sz = Math.floor((spec.startPos.z - minZ) / REACH_CELL_M);
  if (sx < 0 || sx >= cellsX || sz < 0 || sz >= cellsZ) return;
  const reached = new Uint8Array(cellsX * cellsZ);
  const parent = new Int32Array(cellsX * cellsZ);
  parent.fill(-1);
  const queue: number[] = [];
  const startIdx = idx(sx, sz);
  if (cellWalkable[startIdx]) {
    reached[startIdx] = 1;
    queue.push(startIdx);
  }
  // Standard BFS, 4-connected.
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const cx = cur % cellsX;
    const cz = Math.floor(cur / cellsX);
    const neighbours: Array<[number, number]> = [
      [cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1],
    ];
    for (const [nx, nz] of neighbours) {
      if (nx < 0 || nx >= cellsX || nz < 0 || nz >= cellsZ) continue;
      const ni = idx(nx, nz);
      if (reached[ni] || !cellWalkable[ni]) continue;
      reached[ni] = 1;
      parent[ni] = cur;
      queue.push(ni);
    }
  }
  // Rescue any stair that's unreachable. Strategy: re-run BFS
  // ignoring cellWalkable for the blocker map's cells, walk the
  // resulting path from spawn to stair, find the first cell on the
  // path that had a rescuable blocker, disable that prop's collision,
  // re-mark its cells walkable, retry. Cap rescues per call so a
  // pathological floor can't loop.
  for (const st of stairs) {
    const tx = Math.floor((st.x - minX) / REACH_CELL_M);
    const tz = Math.floor((st.z - minZ) / REACH_CELL_M);
    if (tx < 0 || tx >= cellsX || tz < 0 || tz >= cellsZ) continue;
    let attempts = 0;
    while (!reached[idx(tx, tz)] && attempts < 8) {
      attempts++;
      const rescued = rescueOneBlocker(
        cellWalkable, cellBlocker, reached, parent,
        cellsX, cellsZ, startIdx, idx(tx, tz),
      );
      if (!rescued) break;
    }
  }
}

/** Find the first rescuable blocker on a hypothetical path from
 *  start to goal, mark its cells walkable, then re-run BFS to update
 *  reached/parent. Returns true if a rescue was applied. */
function rescueOneBlocker(
  walkable: Uint8Array,
  blockers: Map<number, PropSpec>,
  reached: Uint8Array,
  parent: Int32Array,
  cellsX: number,
  cellsZ: number,
  startIdx: number,
  goalIdx: number,
): boolean {
  // Second BFS that traverses blocker cells too — gives us a path
  // even when blockers stand between spawn and goal.
  const reached2 = new Uint8Array(walkable.length);
  const parent2 = new Int32Array(walkable.length);
  parent2.fill(-1);
  const queue: number[] = [];
  reached2[startIdx] = 1;
  queue.push(startIdx);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === goalIdx) break;
    const cx = cur % cellsX;
    const cz = Math.floor(cur / cellsX);
    const neighbours: Array<[number, number]> = [
      [cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1],
    ];
    for (const [nx, nz] of neighbours) {
      if (nx < 0 || nx >= cellsX || nz < 0 || nz >= cellsZ) continue;
      const ni = nz * cellsX + nx;
      if (reached2[ni]) continue;
      // Permeable to blocker cells but NOT to "no room at all" cells
      // (a cell that's not in any rect AND not a blocker — outside the
      // floor entirely). Detect outside-floor by: not walkable AND no
      // blocker entry.
      if (!walkable[ni] && !blockers.has(ni)) continue;
      reached2[ni] = 1;
      parent2[ni] = cur;
      queue.push(ni);
    }
  }
  if (!reached2[goalIdx]) return false;
  // Walk the path from goal back to start, find first blocker cell.
  let firstBlocker: PropSpec | null = null;
  for (let cur = goalIdx; cur !== -1; cur = parent2[cur]) {
    const b = blockers.get(cur);
    if (b) { firstBlocker = b; break; }
  }
  if (!firstBlocker) return false;
  // Disable its collision (chest only — that's all we record).
  if (firstBlocker.kind === 'chest') {
    firstBlocker.noCollision = true;
  } else {
    return false;
  }
  // Re-mark every cell that this prop blocked as walkable.
  for (const [cell, p] of blockers.entries()) {
    if (p === firstBlocker) {
      walkable[cell] = 1;
      blockers.delete(cell);
    }
  }
  // Re-do the main BFS so the next iteration sees the updated map.
  reached.fill(0);
  parent.fill(-1);
  const queue2: number[] = [];
  reached[startIdx] = 1;
  queue2.push(startIdx);
  while (queue2.length > 0) {
    const cur = queue2.shift()!;
    const cx = cur % cellsX;
    const cz = Math.floor(cur / cellsX);
    const neighbours: Array<[number, number]> = [
      [cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1],
    ];
    for (const [nx, nz] of neighbours) {
      if (nx < 0 || nx >= cellsX || nz < 0 || nz >= cellsZ) continue;
      const ni = nz * cellsX + nx;
      if (reached[ni] || !walkable[ni]) continue;
      reached[ni] = 1;
      parent[ni] = cur;
      queue2.push(ni);
    }
  }
  return true;
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

/**
 * Walk a vault's cellProps dict and route each entry into the right
 * output slot. The cell key `${col},${row}` gives the ASCII cell;
 * the helper computes vault-local coords from the grid dims, applies
 * the optional sub-cell offset, then translates to world coords via
 * the vault's placement offset. Torches go to `torches`, spawns to
 * `spawns`, every other PropSpec kind to `props`.
 *
 * Out-of-bounds cell keys throw — better a loud failure at compose
 * time than a prop silently landing in a wall.
 */
function applyCellProps(
  vault: Vault,
  offsetX: number,
  offsetZ: number,
  roomId: string,
  depth: number,
  rand: () => number,
  out: { spawns: EnemySpawnSpec[]; torches: TorchSpec[]; props: PropSpec[] },
): void {
  if (!vault.cellProps) return;
  const W = vault.map[0]?.length ?? 0;
  const D = vault.map.length;
  for (const [key, entries] of Object.entries(vault.cellProps)) {
    if (!entries) continue;
    // Parse `${col},${row}` — tolerate whitespace ("3, 1") since LLM
    // output occasionally adds it. Two integers required; everything
    // else is a hard error so the author can spot a typo.
    const parts = key.split(',').map((s) => Number(s.trim()));
    if (parts.length !== 2 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) {
      throw new Error(`Vault '${vault.id}' cellProps key '${key}' is not a valid \`col,row\` pair`);
    }
    const [col, row] = parts;
    if (col < 0 || col >= W || row < 0 || row >= D) {
      throw new Error(`Vault '${vault.id}' cellProps key '${key}' is out of bounds (grid is ${W}×${D})`);
    }
    const cellLocalX = col + 0.5 - W / 2;
    const cellLocalZ = row + 0.5 - D / 2;
    for (const entity of entries as CellBoundEntity[]) {
      const off = entity.offset ?? [0, 0];
      const x = cellLocalX + off[0] + offsetX;
      const z = cellLocalZ + off[1] + offsetZ;
      if (entity.kind === 'torch') {
        // Strip cellProps-only fields and stamp the world coords.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { offset: _o, kind: _k, ...torch } = entity;
        out.torches.push({ ...torch, x, z });
      } else if (entity.kind === 'spawn') {
        out.spawns.push({
          enemyId: entity.enemyId,
          x, z,
          roomId: entity.roomId ?? roomId,
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { offset: _o, ...rest } = entity;
        // Chests + corpses get procgen defaults filled (depth-rolled
        // tier/mimic/loot for chests; note/rotY for corpses) so a
        // bare `{ kind: 'chest' }` cellProps entry behaves the same
        // as the legacy 'c' tile char did.
        const propSpec = applyProcgenDefaults({ ...rest, x, z } as PropSpec, depth, rand);
        out.props.push(propSpec);
      }
    }
  }
}

/**
 * Route procgen $/? FEATURE rolls (chest / fountain / altar from
 * populateTemplate) into world-coord props. Same cell→world math and
 * applyProcgenDefaults pass as authored cellProps — so a rolled chest
 * gets its depth-tier + loot — just sourced from the slot roll instead
 * of the vault dict. Keeps decor OUT of the populated map string (a raw
 * decor char there has no parser case and stands up a wall cross).
 */
function routeFeatures(
  features: FeatureCell[],
  W: number,
  D: number,
  offsetX: number,
  offsetZ: number,
  depth: number,
  rand: () => number,
  props: PropSpec[],
): void {
  for (const f of features) {
    const x = f.col + 0.5 - W / 2 + offsetX;
    const z = f.row + 0.5 - D / 2 + offsetZ;
    props.push(applyProcgenDefaults({ ...f.prop, x, z } as PropSpec, depth, rand));
  }
}

function translateProp(p: PropSpec, dx: number, dz: number): PropSpec {
  // Every PropSpec variant has x + z at top level. Some have a y for
  // 'model' which we leave alone.
  const result = { ...p, x: p.x + dx, z: p.z + dz } as PropSpec;
  // If the prop carries a point-* facing directive, the world
  // point also needs the same offset applied.
  if ('facing' in p && p.facing) {
    const f = p.facing;
    if (f.kind === 'point-away' || f.kind === 'point-toward') {
      (result as { facing?: typeof f }).facing = {
        kind: f.kind,
        x: f.x + dx,
        z: f.z + dz,
      };
    }
  }
  return result;
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
  // If the child carries a `facing` directive that references a
  // world point (point-away / point-toward), the referenced
  // point also needs the group's rotate + translate applied so
  // it lands in the same world space as the prop. Other facing
  // kinds (fixed / wall-*) are coordinate-free; pass through.
  if ('facing' in child.prop && child.prop.facing) {
    const f = child.prop.facing;
    if (f.kind === 'point-away' || f.kind === 'point-toward') {
      const px = f.x * cosA - f.z * sinA;
      const pz = f.x * sinA + f.z * cosA;
      (result as { facing?: typeof f }).facing = {
        kind: f.kind,
        x: gx + px,
        z: gz + pz,
      };
    }
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
