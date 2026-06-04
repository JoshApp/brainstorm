import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelSpec, RoomSpec, TorchSpec, PropSpec, OpeningSpec } from './types';
import { WalkableRegion, type WallSegment, type Obstacle } from './walkable';
import { NavGrid } from './nav-grid';
import { CONFIG } from '../config';
import { buildAltarPillar, buildAltarBlock } from './altar-pillar-builders';
import { spawnVase, spawnVaseCluster, disposeDestructible, type Destructible } from './destructibles';
import type { StyleMaterials } from '../style/materials';
import { createTorchlight, type Torch } from '../scene/torchlight';
import { wallFixtureModel } from './lit-fixture-pool';
import { createEnemy, disposeEnemy, type Enemy } from '../mobs/enemy';
import { kickShake } from '../combat/screen-shake';
import { registerBossMember, advanceBossPhase } from '../mobs/boss-encounter';
import { ENEMIES, type EnemySpec } from '../content/enemies';
import { scaleEnemySpec } from '../content/modifiers';
import { buildModel } from '../ecs/build-model';
import { isPooledGeometry } from '../scene/geometry-pool';
import { spawnChest } from '../interactables/chest';
import { spawnStashChest } from '../interactables/stash-chest';
import { spawnStarterAltar } from '../interactables/starter-altar';
import { spawnBloodAltar } from '../interactables/blood-altar';
import { spawnChallengeOffering } from '../interactables/challenge-offering';
import { ITEMS } from '../content/items';
import { spawnTutorialHint } from '../effects/tutorial-hints';
import {
  spawnStairs,
  STAIRWELL_TOTAL_DEPTH,
  STAIRWELL_HALF_WIDTH,
} from '../interactables/stairs';
import { spawnCorpse } from '../interactables/corpse';
import { spawnFitting } from '../interactables/fitting';
import { createArenaController, arenaEncounterId, type WaveSpec } from './arena-waves';
import { registerEncounter, activateEncounter, clearEncounters, roomClearEncounterId, type EncounterHandle } from '../encounters/registry';
import { spawnSpikeTrap } from '../interactables/spike-trap';
import { spawnFountain } from '../interactables/fountain';
import { registerLight, clearLightPool } from '../scene/light-pool';
import { decorateFloor } from './decorate';
import { seedBuildRng, hashStringToSeed } from '../engine/rng';
import { spawnThresholdDraft, registerArchwayGlow } from '../scene/threshold-draft';

// Local Mulberry32 seeded RNG — kept here to avoid importing procgen.ts
// (would create a cyclic dependency between builder and procgen).
function rngFromSeed(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Module-level counter for unique source ids across all level builds.
// Resets to a deterministic-enough range per build via the per-call
// declaration below. Could be per-level seeded but cross-level
// uniqueness is enough for our use.
let lightSerial = 0;
import { clearInteractables } from '../interactables/system';
import { emit } from '../broadcast/event-bus';

// Consumes a LevelSpec and produces the live scene + collision data. This is
// the seam where declarative data becomes Three.js objects + game entities.
//
// Returns:
//   - walkable: the collision region (queried by player and enemy each frame)
//   - torches: array of torch handles (light + flame, ticked each frame)
//   - enemies: array of enemy handles (state machine, ticked each frame)
//   - playerSpawn: where to put the camera + initial yaw

const PILLAR_DEFAULT_SIZE = 0.5;

export interface LiveLevel {
  spec: LevelSpec;
  walkable: WalkableRegion;
  /** Pathfinding grid for physical mobs (respects walls + obstacles). */
  nav: NavGrid;
  /** Phasing pathfinding grid for ghost mobs (respects walls only —
   *  obstacles are passable). Same dimensions as `nav`. */
  navPhasing: NavGrid;
  torches: Torch[];
  enemies: Enemy[];
  destructibles: Destructible[];
  playerSpawn: { x: number; z: number; yaw: number };
  /**
   * Single Three.js group containing EVERYTHING the level added to the
   * scene — rooms, props, torches, enemies, doors, stairs. Teardown just
   * removes this from the scene + disposes meshes inside it.
   */
  root: THREE.Group;
  /**
   * Call to dispose this level: removes root from its parent, disposes
   * geometries/materials inside, clears interactables, destroys enemy
   * entities. Idempotent.
   */
  teardown: () => void;
}

// Procedural geometry factories (floor-with-holes, jittered planes, arched
// ceilings, mine bracing, chasm drops) live in geometry-prims.ts — pure,
// no game-state coupling. builder.ts composes the level from them.
import {
  makeFloorWithHoles,
  makeJitteredPlane,
  archCeilingMaterial,
  makeArchedCeilingGeometry,
  makeBracedFramesGeometry,
  makeChasmDropGeometry,
} from './geometry-prims';

function buildRoomShell(
  scene: THREE.Object3D,
  room: RoomSpec,
  allRects: RoomSpec[],
  materials: StyleMaterials,
  wallSegmentsOut: WallSegment[],
  floorHoles: Array<Array<[number, number]>> = [],
) {
  const { rect, height: H } = room;
  const W = rect.w;
  const D = rect.d;

  // Floor — with rectangular holes for stairwells in this room. Holes
  // path takes precedence over the jittered plane; without holes the
  // legacy subdivided + Z-jittered plane is used (visually richer
  // surface variation).
  const floorGeo: THREE.BufferGeometry = floorHoles.length > 0
    ? makeFloorWithHoles(W, D, floorHoles)
    : makeJitteredPlane(W, D, { flat: true });
  const floor = new THREE.Mesh(floorGeo, materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(rect.x, 0, rect.z);
  floor.receiveShadow = true;
  floor.name = 'floor';
  floor.userData.dbgKind = 'floor';
  floor.userData.dbgSource = `floor · ${room.id} @(${rect.x.toFixed(1)},${rect.z.toFixed(1)})`;
  scene.add(floor);

  // Ceiling — flat plane by default; barrel/pitched build a custom arch that
  // springs from the wall-top (H) and rises to H+rise. Verticality without a
  // draw-call increase (still one ceiling mesh per room).
  const ceilStyle = room.ceilingStyle ?? 'flat';
  let ceiling: THREE.Mesh;
  if (ceilStyle === 'flat') {
    ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), materials.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(rect.x, H, rect.z);
  } else {
    const rise = room.ceilingRise ?? (ceilStyle === 'barrel' ? 1.3 : 1.0);
    ceiling = new THREE.Mesh(
      makeArchedCeilingGeometry(W, D, H, rise, ceilStyle),
      archCeilingMaterial(materials.ceiling),
    );
    ceiling.position.set(rect.x, 0, rect.z);   // geometry already in world-Y
  }
  ceiling.receiveShadow = true;
  ceiling.name = 'ceiling';
  ceiling.userData.dbgKind = 'ceiling';
  ceiling.userData.dbgSource = `ceiling · ${room.id} (${ceilStyle}) @(${rect.x.toFixed(1)},${rect.z.toFixed(1)}) y${H.toFixed(1)}`;
  scene.add(ceiling);

  // Walls with openings where another rect butts up. Each of the four wall
  // edges is broken into segments that skip the overlap with adjacent rects
  // (so corridors connect to rooms via gaps in the wall, not via teleport).
  const halfW = W / 2;
  const halfD = D / 2;
  // Each wall edge: which line it runs along + which end coords define its extent.
  const wallEdges: Array<{
    side: 'N' | 'S' | 'E' | 'W';
    perpAxis: 'x' | 'z';   // axis perpendicular to the wall line (the wall is AT this coord)
    perpCoord: number;
    wallStart: number;     // along the wall's running axis
    wallEnd: number;
  }> = [
    { side: 'N', perpAxis: 'z', perpCoord: rect.z - halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
    { side: 'S', perpAxis: 'z', perpCoord: rect.z + halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
    { side: 'W', perpAxis: 'x', perpCoord: rect.x - halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
    { side: 'E', perpAxis: 'x', perpCoord: rect.x + halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
  ];

  // Wall segments are BAKED to world space + merged into ONE mesh for this
  // room (one draw call instead of one per segment — a floor had ~50-100
  // wall draw calls). Per-room (not per-floor) so each room's wall set still
  // frustum-culls as a unit. Collision is recorded per segment as before.
  const wallGeos: THREE.BufferGeometry[] = [];
  for (const we of wallEdges) {
    const openings = findOpenings(we, allRects, room);
    const segments = subtractRanges(we.wallStart, we.wallEnd, openings);
    for (const seg of segments) {
      const segLen = seg.end - seg.start;
      if (segLen < 0.01) continue;
      wallGeos.push(bakeWallSegmentGeometry(we, seg.start, seg.end, H));
      // Record the segment as collision data. The XZ endpoints describe a
      // line in the floor plane along which the player cannot pass.
      if (we.perpAxis === 'z') {
        // wall runs along X at z = we.perpCoord
        wallSegmentsOut.push({ ax: seg.start, az: we.perpCoord, bx: seg.end, bz: we.perpCoord });
      } else {
        // wall runs along Z at x = we.perpCoord
        wallSegmentsOut.push({ ax: we.perpCoord, az: seg.start, bx: we.perpCoord, bz: seg.end });
      }
    }
  }
  if (wallGeos.length > 0) {
    const merged = mergeGeometries(wallGeos, false);
    for (const g of wallGeos) g.dispose();
    if (merged) {
      const walls = new THREE.Mesh(merged, materials.wall);
      walls.receiveShadow = true;
      walls.name = 'walls-merged';
      walls.userData.dbgKind = 'wall';
      walls.userData.dbgSource = `walls · ${room.id}`;
      scene.add(walls);
    }
  }

  // Mine-shaft timber bracing (one merged mesh — see makeBracedFramesGeometry).
  if (room.wallVariant === 'braced') {
    const frames = makeBracedFramesGeometry(rect, H);
    if (frames) {
      const braces = new THREE.Mesh(frames, materials.timber);
      braces.castShadow = true;
      braces.receiveShadow = true;
      braces.name = 'braces';
      braces.userData.dbgKind = 'wall';
      braces.userData.dbgSource = `braces · ${room.id}`;
      scene.add(braces);
    }
  }
}

// Bake one wall-segment plane into a WORLD-SPACE geometry (so a room's
// segments can be merged into a single mesh — see buildRoomShell). Position
// + facing depend on which edge it's on; the jittered-plane normal faces
// into the room (materials.wall is double-sided anyway, so the back is safe).
function bakeWallSegmentGeometry(
  we: { side: 'N' | 'S' | 'E' | 'W'; perpAxis: 'x' | 'z'; perpCoord: number },
  segStart: number,
  segEnd: number,
  height: number,
): THREE.BufferGeometry {
  const segLen = segEnd - segStart;
  const segMid = (segStart + segEnd) / 2;
  const geo = makeJitteredPlane(segLen, height, { wavy: true });
  let yaw = 0, px = 0, pz = 0;
  if (we.side === 'N') { yaw = 0; px = segMid; pz = we.perpCoord; }
  else if (we.side === 'S') { yaw = Math.PI; px = segMid; pz = we.perpCoord; }
  else if (we.side === 'W') { yaw = Math.PI / 2; px = we.perpCoord; pz = segMid; }
  else { yaw = -Math.PI / 2; px = we.perpCoord; pz = segMid; }
  const m4 = new THREE.Matrix4().makeRotationY(yaw);
  m4.setPosition(px, height / 2, pz);
  geo.applyMatrix4(m4);
  return geo;
}

// Place a dust draft at each OPEN archway — a room wall opening (where a
// corridor / adjacent room connects) that has no door. Reuses findOpenings to
// locate the gaps; dedups shared thresholds; skips any opening near a door
// (those already signal). Onward passages get a diegetic dust/haze cue without
// rimming the architecture.
function placeThresholdDrafts(root: THREE.Object3D, spec: LevelSpec, allRects: RoomSpec[]) {
  const doors = spec.doors ?? [];
  const seen = new Set<string>();
  for (const room of spec.rooms) {
    if (room.logicalOnly) continue;
    const rect = room.rect;
    const halfW = rect.w / 2;
    const halfD = rect.d / 2;
    const edges = [
      { perpAxis: 'z' as const, perpCoord: rect.z - halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
      { perpAxis: 'z' as const, perpCoord: rect.z + halfD, wallStart: rect.x - halfW, wallEnd: rect.x + halfW },
      { perpAxis: 'x' as const, perpCoord: rect.x - halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
      { perpAxis: 'x' as const, perpCoord: rect.x + halfW, wallStart: rect.z - halfD, wallEnd: rect.z + halfD },
    ];
    for (const we of edges) {
      for (const op of findOpenings(we, allRects, room)) {
        const mid = (op.start + op.end) / 2;
        const x = we.perpAxis === 'z' ? mid : we.perpCoord;
        const z = we.perpAxis === 'z' ? we.perpCoord : mid;
        // Dedup thresholds shared by two rects (rounded to 0.5m).
        const key = `${Math.round(x * 2)}:${Math.round(z * 2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Skip doored passages — the door already signals.
        let doored = false;
        for (const d of doors) {
          const dmx = (d.ax + d.bx) / 2;
          const dmz = (d.az + d.bz) / 2;
          if (Math.hypot(dmx - x, dmz - z) < 1.2) { doored = true; break; }
        }
        if (doored) continue;
        // The passage runs along the wall's perpendicular axis; the opening
        // span (op) is the doorway width.
        spawnThresholdDraft(root, x, z, we.perpAxis, op.end - op.start);
      }
    }
  }
}

// Wall-opening range math (findOpenings / subtractRanges) + torchYawForWall
// live in wall-openings.ts. Mood-tint colour math lives in mood-tint.ts.
import { findOpenings, subtractRanges, torchYawForWall } from './wall-openings';
import { mixColors, moodTintForPosition, applyMoodTint, averageTorchTintInRect } from './mood-tint';

export function buildLevel(
  scene: THREE.Scene,
  spec: LevelSpec,
  materials: StyleMaterials,
  onDescend?: (targetLevel: string) => void,
): LiveLevel {
  // Seed the build stream from the floor seed so geometry jitter + prop /
  // loot placement are reproducible for a given seed. Procgen stamps
  // spec.seed; hand-authored floors fall back to a stable hash of their id.
  seedBuildRng(spec.seed ?? hashStringToSeed(spec.id));

  // Per-level lights start fresh. Persistent sources (the camera-
  // attached lantern) survive — see light-pool.clearLightPool.
  clearLightPool();
  // Drop the previous floor's encounters before this one registers its own
  // (the registry is module-global).
  clearEncounters();

  // Everything goes into this root group rather than directly into the
  // scene — teardown is a single scene.remove(root). Geometry/material
  // disposal walks root's tree.
  const root = new THREE.Group();
  root.name = `level-${spec.id}`;
  scene.add(root);

  // --- Geometry: rooms + corridors ---
  const allRects: RoomSpec[] = [...spec.rooms, ...spec.corridors];
  const wallSegments: WallSegment[] = [];
  // Hoisted: stair-footprint AABBs push into this BEFORE the prop pass
  // populates the rest. WalkableRegion is constructed below with the
  // full list.
  const obstacles: Obstacle[] = [];
  // Destructibles — vases + future breakable props. Built
  // inline alongside the props loop, returned in LiveLevel.
  const destructibles: Destructible[] = [];
  // Parallel list of stair-footprint AABBs in world XZ — same shape as
  // the stair obstacles above. Passed to decorateFloor so the procgen
  // sigils/cracks/rubble decorator skips cells that sit on the cut-out
  // stairwell floor.
  const stairFootprintAabbs: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  // Pre-compute floor holes (one per stairwell) keyed by which room the
  // stairwell sits inside. Each hole is a 4-corner polygon in floor-mesh
  // shape coordinates (shape Y maps to world -Z after the -π/2 X rotation
  // of the floor mesh). The stairwell descends in stair-local +Z; we
  // rotate by stair.rotY to find its world footprint.
  const stairs = spec.stairs ?? [];
  for (const r of allRects) {
    const holes: Array<Array<[number, number]>> = [];
    for (const st of stairs) {
      const rx = r.rect.x;
      const rz = r.rect.z;
      const hw = r.rect.w / 2;
      const hd = r.rect.d / 2;
      if (st.x < rx - hw || st.x > rx + hw) continue;
      if (st.z < rz - hd || st.z > rz + hd) continue;
      // Slight outward margin on each edge so the hole's outline can't
      // peek past the parapet at oblique camera angles.
      const halfW = STAIRWELL_HALF_WIDTH + 0.04;
      const back = STAIRWELL_TOTAL_DEPTH + 0.04;
      const front = -0.04;
      const angle = st.rotY ?? 0;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const corners: Array<[number, number]> = [
        [-halfW, front],
        [ halfW, front],
        [ halfW, back],
        [-halfW, back],
      ];
      // World XZ of the four stair-footprint corners. The rotation
      // here MUST match Three.js's Y-rotation convention used by the
      // group containing the stair geometry (group.rotation.y =
      // spec.rotY). Three.js maps local (lx, ly, lz) under Y-rotation
      // θ to world (ca*lx + sa*lz, ly, -sa*lx + ca*lz). The earlier
      // formula used opposite-sign cross terms, which is rotation by
      // -θ — the hole + obstacle ended up MIRRORED ACROSS the cell
      // from the actual stair body for any non-axial rotY (most
      // notably the auto-rotated east/west boss + exit stairs).
      const worldCorners = corners.map(([lx, lz]) => {
        const wx = st.x + ca * lx + sa * lz;
        const wz = st.z - sa * lx + ca * lz;
        return [wx, wz] as [number, number];
      });
      // Clip to the ROOM's axis-aligned bounding box. The stair often
      // descends INTO the back wall (the footprint extends past the
      // room). Without clipping, the floor hole goes past the room rect
      // and ShapeGeometry triangulates unpredictably — manifests as
      // half-cut floors on small rooms. We axis-clamp the AABB of the
      // footprint to the room rect; for axis-aligned stair rotations
      // (0, ±π/2, π — all current cases) this preserves the rectangle.
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [wx, wz] of worldCorners) {
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz;
        if (wz > maxZ) maxZ = wz;
      }
      // Clamp the hole to sit STRICTLY INSIDE the floor contour by a
      // small inset on every side. A hole vertex that lands exactly on
      // (or, via float error, a hair past) the outer boundary makes
      // THREE's earcut triangulation silently DROP the hole — the floor
      // comes back as a solid 2-triangle slab with no stairwell opening.
      // This bites whenever a stairwell is shifted flush with its back
      // wall (the back edge then coincides with the room boundary): e.g.
      // exit-grand, where rz≈30.7227 made the back edge land at
      // y=-3.5000000000000036 vs the contour's -3.5. The leftover inset
      // sliver (≤2cm) sits under the wall / behind the stair parapet, so
      // it's never visible.
      const EDGE_INSET = 0.02;
      const cMinX = Math.max(minX, rx - hw + EDGE_INSET);
      const cMaxX = Math.min(maxX, rx + hw - EDGE_INSET);
      const cMinZ = Math.max(minZ, rz - hd + EDGE_INSET);
      const cMaxZ = Math.min(maxZ, rz + hd - EDGE_INSET);
      if (cMinX >= cMaxX || cMinZ >= cMaxZ) continue;  // clipped to nothing
      // Build hole in floor-shape coords (X = world_x - rect.x;
      // Y = -(world_z - rect.z) due to the floor's -π/2 X rotation).
      const hole: Array<[number, number]> = [
        [cMinX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMaxZ - rz)],
        [cMinX - rx, -(cMaxZ - rz)],
      ];
      holes.push(hole);
      // Stair footprint → AABB obstacle. The player can walk up to the
      // stair MOUTH (interactable range fires before contact) but can't
      // step onto the stairs themselves. Leave a small front-edge gap
      // so the prompt is reachable. The obstacle is computed in WORLD
      // space (matches the rest of the obstacle list).
      const FRONT_GAP = 0.15;
      // Re-build the FRONT-clipped local corners and project to world.
      const obsCorners = [
        [-halfW, front + FRONT_GAP],
        [ halfW, front + FRONT_GAP],
        [ halfW, back],
        [-halfW, back],
      ];
      let oMinX = Infinity, oMaxX = -Infinity, oMinZ = Infinity, oMaxZ = -Infinity;
      for (const [lx, lz] of obsCorners) {
        // Same Three.js Y-rotation convention as the hole corners above.
        const wx = st.x + ca * lx + sa * lz;
        const wz = st.z - sa * lx + ca * lz;
        if (wx < oMinX) oMinX = wx;
        if (wx > oMaxX) oMaxX = wx;
        if (wz < oMinZ) oMinZ = wz;
        if (wz > oMaxZ) oMaxZ = wz;
      }
      obstacles.push({ kind: 'aabb', minX: oMinX, maxX: oMaxX, minZ: oMinZ, maxZ: oMaxZ });
      // Decorator AABB uses the FULL (unclipped) footprint so cells
      // beyond the room rect can't sprout sigils either — even though
      // those cells fall outside the floor, the grid loop iterates them.
      stairFootprintAabbs.push({ minX, maxX, minZ, maxZ });
    }
    // Chasm voids inside this room → a floor hole (clamped just inside the
    // contour so earcut keeps it) + an edge-barrier obstacle covering the
    // FULL void (so the player can't step into the abyss). Drop geometry is
    // built once after this loop.
    for (const v of spec.voids ?? []) {
      const rx = r.rect.x, rz = r.rect.z, hw = r.rect.w / 2, hd = r.rect.d / 2;
      if (v.x < rx - hw || v.x > rx + hw || v.z < rz - hd || v.z > rz + hd) continue;
      const vMinX = v.x - v.w / 2, vMaxX = v.x + v.w / 2;
      const vMinZ = v.z - v.d / 2, vMaxZ = v.z + v.d / 2;
      const EDGE = 0.02;
      const cMinX = Math.max(vMinX, rx - hw + EDGE), cMaxX = Math.min(vMaxX, rx + hw - EDGE);
      const cMinZ = Math.max(vMinZ, rz - hd + EDGE), cMaxZ = Math.min(vMaxZ, rz + hd - EDGE);
      if (cMinX >= cMaxX || cMinZ >= cMaxZ) continue;
      holes.push([
        [cMinX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMinZ - rz)],
        [cMaxX - rx, -(cMaxZ - rz)],
        [cMinX - rx, -(cMaxZ - rz)],
      ]);
      obstacles.push({ kind: 'aabb', minX: vMinX, maxX: vMaxX, minZ: vMinZ, maxZ: vMaxZ });
    }
    // Logical-only sub-rooms (multi-room vault parsing) skip the shell
    // build — they exist only for mob-attribution and arena-door
    // trigger purposes. Their parent vault's main RoomSpec already
    // covers floor/ceiling/walls.
    if (!r.logicalOnly) {
      buildRoomShell(root, r, allRects, materials, wallSegments, holes);
    }
  }

  // --- Threshold drafts: drifting dust + a proximity haze at OPEN archways
  // (passages with no door), so an onward passage reads as a way through —
  // diffuse + in-motion, not a placed marker. Doored passages already signal.
  placeThresholdDrafts(root, spec, allRects);

  // --- Props (visual meshes) + collect obstacles for collision ---
  // `obstacles` was hoisted above so stair AABBs land in the same list.

  // Pillar geometry is BATCHED: each pillar's ~8 parts are baked to world
  // space and collected here, then merged into ONE mesh after the loop (see
  // below) — so a colonnade costs a single draw call instead of dozens. The
  // boss cathedral alone was ~48 pillar draw calls.
  const pillarGeos: THREE.BufferGeometry[] = [];

  // Boss-mist props need the WalkableRegion (for the seal obstacle)
  // which is constructed AFTER this loop. Collect them here, spawn
  // after the region exists.
  // Every wall-opening fitting — doors, portcullises, the boss fog-gate, and
  // cobwebs — is installed through ONE deferred drain (spawnFitting) after the
  // walkable region + room membership exist. Collected here from props +
  // spec.doors so they all flow through the same placement + seal path.
  const pendingFittings: OpeningSpec[] = [];
  // Rooms that hold a challenge offering → their arena gate becomes a
  // voluntary 'offering' trigger (set on the door spec below) instead of a
  // trap that slams on entry.
  const offeringRooms = new Set<string>();
  for (const prop of spec.props) {
    if (prop.kind === 'pillar') {
      const size = prop.size ?? PILLAR_DEFAULT_SIZE;
      const H = spec.rooms[0]?.height ?? 3.2;
      const { group: pillarGroup, obstacle } = buildAltarPillar(prop.x, prop.z, size, H, materials);
      // Bake each part's local transform into a world-space geometry clone
      // for the merge. (Merge, not InstancedMesh: pillars vary in height +
      // size, which one instanced geometry can't express without stretching
      // the cap/bead proportions.) The pooled source geometries are left
      // intact; the clones get disposed after the merge.
      pillarGroup.updateMatrixWorld(true);
      pillarGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          pillarGeos.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
        }
      });
      obstacles.push({ kind: 'aabb', ...obstacle });
    } else if (prop.kind === 'altar') {
      const { group: altarGroup, obstacle } = buildAltarBlock(prop.x, prop.z, materials);
      root.add(altarGroup);
      obstacles.push({ kind: 'aabb', ...obstacle, height: 0.9 });   // waist-high — shots fly over
    } else if (prop.kind === 'challenge-offering') {
      const rid = findRoomContaining(prop.x, prop.z, spec.rooms);
      spawnChallengeOffering(root, new THREE.Vector3(prop.x, 0, prop.z), rid ?? '', spec.depth ?? 1, materials);
      if (rid) offeringRooms.add(rid);
      // Coffer footprint blocks movement; waist-high so shots clear it.
      obstacles.push({
        kind: 'aabb',
        minX: prop.x - 0.36, maxX: prop.x + 0.36,
        minZ: prop.z - 0.28, maxZ: prop.z + 0.28,
        height: 0.7,
      });
    } else if (prop.kind === 'model') {
      const built = buildModel(prop.model);
      built.group.position.set(prop.x, prop.y, prop.z);
      if (prop.rotX) built.group.rotation.x = prop.rotX;
      if (prop.rotY) built.group.rotation.y = prop.rotY;
      if (prop.rotZ) built.group.rotation.z = prop.rotZ;
      if (prop.scale && prop.scale !== 1) built.group.scale.setScalar(prop.scale);
      // Proximity glow (archways): hand the 'glow' material to the threshold
      // system, which raises its emissive as the player nears.
      if (prop.proximityGlow) {
        const gm = built.materials.get('glow');
        if (gm) registerArchwayGlow(gm as THREE.MeshStandardMaterial, prop.x, prop.z);
      }
      // Debug provenance — stamp the generating system + a coarse model
      // hint onto the group so the debug capture's look-at/cone resolver
      // can report "this rubble = surface-clutter phase." No-op for
      // gameplay; only read by src/debug/capture.ts.
      built.group.userData.dbgSource = prop._dbg ?? 'authored';
      built.group.userData.dbgKind = 'prop';
      // Mood-tint pass: if the spec opts in (moodTintable), recolour
      // its flame material + every additive sprite particle + the
      // attached light to match the average torch tint of the room
      // the prop sits in. Cheap, instance-local. See FLOOR_CANDLE
      // for the canonical user.
      let lightColorOverride: number | undefined;
      if (prop.model.moodTintable) {
        const moodTint = moodTintForPosition(spec, prop.x, prop.z);
        if (moodTint !== null) {
          applyMoodTint(built, moodTint);
          lightColorOverride = moodTint;
        }
      }
      root.add(built.group);
      // Optional collision shape(s) — used by structural model
      // props (buttresses, ruined columns, archway columns). For
      // AABB the half-extents rotate with the prop's rotY; we
      // only support cardinal angles in practice so the rotated
      // AABB stays axis-aligned. Each shape may carry a local
      // offset (ox, oz) so one prop can express multiple
      // obstacles (e.g. an archway's TWO columns).
      if (prop.collision) {
        const shapes = Array.isArray(prop.collision) ? prop.collision : [prop.collision];
        const angle = prop.rotY ?? 0;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        for (const shape of shapes) {
          const ox = shape.ox ?? 0;
          const oz = shape.oz ?? 0;
          // Rotate local offset into world.
          const wox = ca * ox + sa * oz;
          const woz = -sa * ox + ca * oz;
          const cx = prop.x + wox;
          const cz = prop.z + woz;
          if (shape.kind === 'circle') {
            obstacles.push({ kind: 'circle', x: cx, z: cz, r: shape.r, height: shape.height });
          } else {
            // Swap halfW/halfD if rotation is perpendicular (±π/2).
            const swap = Math.abs(ca) < 0.5;
            const hw = swap ? shape.halfD : shape.halfW;
            const hd = swap ? shape.halfW : shape.halfD;
            obstacles.push({
              kind: 'aabb',
              minX: cx - hw, maxX: cx + hw,
              minZ: cz - hd, maxZ: cz + hd,
              height: shape.height,
            });
          }
        }
      }
      // If the model spec carries a light, register it with the global
      // light pool. The pool decides per-frame whether this source gets
      // a real slot. Light's local position is added to the prop's
      // world position; rotations are not currently applied to the
      // offset (most model lights sit on the prop's axis).
      if (prop.model.light) {
        const lp = prop.model.light;
        const lightPos = new THREE.Vector3(
          prop.x + (lp.pos?.[0] ?? 0),
          prop.y + (lp.pos?.[1] ?? 0),
          prop.z + (lp.pos?.[2] ?? 0),
        );
        registerLight({
          id: `model-light-${lightSerial++}`,
          category: 'environment',
          position: lightPos,
          color: lightColorOverride ?? lp.color,
          intensity: lp.intensity,
          distance: lp.distance,
          decay: lp.decay,
        });
      }
    } else if (prop.kind === 'chest') {
      // Mimic chests need a callback that spawns the mimic mob into
      // the right room when the lid slams open. spawnInto is defined
      // later in this function (hoisted as a function declaration);
      // the closure body only runs at interact-time so all the
      // by-then-initialised state is available.
      const chestRoomId = prop.mimic
        ? findRoomContaining(prop.x, prop.z, spec.rooms)
        : null;
      const onMimic = prop.mimic
        ? (worldPos: THREE.Vector3) => {
            spawnInto(ENEMIES.mimic, worldPos, chestRoomId);
          }
        : undefined;
      spawnChest(
        root,
        new THREE.Vector3(prop.x, 0, prop.z),
        prop.rotY ?? 0,
        prop.loot,
        prop.tier,
        prop.mimic ?? false,
        onMimic,
      );
      if (!prop.noCollision) {
        obstacles.push({
          kind: 'aabb',
          minX: prop.x - 0.28, maxX: prop.x + 0.28,
          minZ: prop.z - 0.23, maxZ: prop.z + 0.23,
          height: 0.7,   // chest-high — shots fly over
        });
      }
    } else if (prop.kind === 'stash-chest') {
      spawnStashChest(root, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0);
      obstacles.push({
        kind: 'aabb',
        minX: prop.x - 0.28, maxX: prop.x + 0.28,
        minZ: prop.z - 0.23, maxZ: prop.z + 0.23,
        height: 0.7,
      });
    } else if (prop.kind === 'corpse') {
      spawnCorpse(root, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0, prop.note ?? '');
      // No collision — player can step over the body. Walking right up
      // to READ it shouldn't be blocked.
    } else if (prop.kind === 'boss-mist') {
      // Soulslike fog wall. Spawn is DEFERRED until after the
      // walkable region is constructed (spawnBossMist takes a
      // WalkableRegion handle so it can add the seal obstacle on
      // cross). Collected here, processed below.
      pendingFittings.push({
        id: `fog-${Math.round(prop.x * 10)}-${Math.round(prop.z * 10)}`,
        kind: 'fog-gate',
        x: prop.x, z: prop.z, rotY: prop.rotY ?? 0,
        widthM: prop.width ?? 3.4, height: prop.height,
        color: prop.color,
      });
    } else if (prop.kind === 'vase') {
      // Push the obstacle FIRST, keep a reference, and pass a
      // splice callback to spawnVase so the obstacle goes away
      // when the vase shatters — otherwise the cell stays
      // blocked even after the vase mesh is gone.
      const vaseObs: Obstacle = { kind: 'circle', x: prop.x, z: prop.z, r: 0.18, height: 0.6 };
      obstacles.push(vaseObs);
      const vase = spawnVase(root, prop.x, prop.z, () => {
        const idx = obstacles.indexOf(vaseObs);
        if (idx >= 0) obstacles.splice(idx, 1);
      });
      destructibles.push(vase);
    } else if (prop.kind === 'cobweb') {
      // Destructible web curtain — installed as a unified fitting (wall-segment
      // seal spanning the gap; slashing removes it). Deferred to the drain
      // below so it shares the same path as doors + the fog-gate.
      pendingFittings.push({
        id: `cobweb-${Math.round(prop.x * 10)}-${Math.round(prop.z * 10)}`,
        kind: 'cobweb',
        x: prop.x, z: prop.z, rotY: prop.rotY ?? 0, widthM: prop.widthM ?? 1.9,
      });
    } else if (prop.kind === 'vase-cluster') {
      // Cluster of 2-4 vases jittered around (x, z). Each gets
      // its own destructible entry + its own collision circle.
      // Build an obstacle list parallel to the cluster's vase
      // list so the spliceOnDestroy callback can find the right
      // one by index when an individual cluster member breaks.
      const clusterObs: Obstacle[] = [];
      const cluster = spawnVaseCluster(root, prop.x, prop.z, (idx) => {
        const obs = clusterObs[idx];
        if (!obs) return;
        const j = obstacles.indexOf(obs);
        if (j >= 0) obstacles.splice(j, 1);
      });
      for (const v of cluster) {
        destructibles.push(v);
        const obs: Obstacle = { kind: 'circle', x: v.position.x, z: v.position.z, r: 0.18, height: 0.6 };
        clusterObs.push(obs);
        obstacles.push(obs);
      }
    } else if (prop.kind === 'spike-trap') {
      spawnSpikeTrap(
        root,
        new THREE.Vector3(prop.x, 0, prop.z),
        prop.damage ?? 2,
        prop.telegraphTime ?? 0.45,
      );
      // No collision — the plate is flat with the floor. The DAMAGE is
      // the trap. Walking through is the point.
    } else if (prop.kind === 'fountain') {
      spawnFountain(root, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0, prop.variant ?? 'gamble');
      // Cylindrical collision — approximate the pedestal/bowl footprint.
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.45, height: 0.85,
      });
    } else if (prop.kind === 'blood-altar') {
      const item = ITEMS[prop.itemId];
      if (item) {
        // Same AABB pattern as the starter altar — slightly wider
        // footprint matches the larger basin geometry. Stone block
        // stays a collider for the rest of the run.
        obstacles.push({
          kind: 'aabb',
          minX: prop.x - 0.44, maxX: prop.x + 0.44,
          minZ: prop.z - 0.36, maxZ: prop.z + 0.36,
          height: 0.9,
        });
        spawnBloodAltar(
          root,
          new THREE.Vector3(prop.x, 0, prop.z),
          prop.rotY ?? 0,
          item,
          materials,
          undefined,
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`blood-altar references unknown itemId: ${prop.itemId}`);
      }
    } else if (prop.kind === 'starter-altar') {
      const weapon = ITEMS[prop.weaponId];
      if (weapon) {
        // Push the obstacle FIRST, keep a reference, and pass a
        // splice callback to spawnStarterAltar — interactable.onDestroy
        // will fire it so the AABB doesn't outlive the visible stone.
        // (The stone monument REMAINS visible after the weapon is taken,
        // so the splice would normally NOT fire here; we leave the
        // collision in place because the player can still walk into the
        // remaining stone block. If we ever want walk-through-empty-
        // altar later, swap to splice unconditionally.)
        const altarObs: Obstacle = {
          kind: 'aabb',
          minX: prop.x - 0.40, maxX: prop.x + 0.40,
          minZ: prop.z - 0.32, maxZ: prop.z + 0.32,
          height: 1.0,
        };
        obstacles.push(altarObs);
        // onDestroy: no obstacle removal — stone block stays and
        // remains a collider. The hook is still wired in case future
        // iteration wants the empty altars to become walkable.
        spawnStarterAltar(
          root,
          new THREE.Vector3(prop.x, 0, prop.z),
          prop.rotY ?? 0,
          weapon,
          materials,
          undefined,
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`starter-altar references unknown weaponId: ${prop.weaponId}`);
      }
    } else if (prop.kind === 'hint') {
      // Diegetic tutorial hint — invisible trigger that fades a line of
      // italic text in over its world position as the player nears.
      // No collision, no model. The effect module owns its own DOM
      // element + per-frame tick (driven from main.ts).
      spawnTutorialHint({
        x: prop.x,
        z: prop.z,
        y: prop.y,
        text: prop.text,
        triggerRadius: prop.triggerRadius,
        lingerMs: prop.lingerMs,
        dismissOn: prop.dismissOn,
      });
    }
  }

  // Merge every pillar's baked parts into a SINGLE mesh — one draw call for
  // all pillars on the floor (they were ~8 meshes each). Non-pooled, so the
  // teardown traversal disposes it. mergeGeometries(…, false) → one material
  // group (all parts share materials.wall).
  if (pillarGeos.length > 0) {
    const merged = mergeGeometries(pillarGeos, false);
    for (const g of pillarGeos) g.dispose();
    if (merged) {
      const pillarsMesh = new THREE.Mesh(merged, materials.wall);
      pillarsMesh.castShadow = true;
      pillarsMesh.receiveShadow = true;
      pillarsMesh.name = 'pillars-merged';
      root.add(pillarsMesh);
    }
  }

  // Chasm drop geometry — one merged abyss mesh for all voids on the floor.
  // (The floor holes + edge barriers were added per-room above.)
  if (spec.voids && spec.voids.length > 0) {
    const dropGeo = makeChasmDropGeometry(spec.voids, 6);
    if (dropGeo) {
      const chasm = new THREE.Mesh(dropGeo, archCeilingMaterial(materials.ceiling));
      chasm.receiveShadow = true;
      chasm.name = 'chasm-drop';
      chasm.userData.dbgKind = 'wall';
      chasm.userData.dbgSource = 'chasm-drop';
      root.add(chasm);
    }
  }

  // --- Extra walls (from tile-map parsing — interior walls inside the
  //     bounding room rect). Render them as wall meshes + add to
  //     collision so the player can't walk through them.
  if (spec.extraWalls) {
    const defaultH = spec.rooms[0]?.height ?? 3.0;
    // Same per-floor merge as the shell walls — interior walls collapse to
    // one mesh. Collision still recorded per segment.
    const extraGeos: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4();
    for (const w of spec.extraWalls) {
      const H = w.height ?? defaultH;
      const baseY = w.baseY ?? 0;
      const dx = w.bx - w.ax;
      const dz = w.bz - w.az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const geo = makeJitteredPlane(len, H, { wavy: true });
      // X-running wall faces ±Z (yaw 0); Z-running faces ±X (yaw π/2).
      const yaw = Math.abs(dz) < Math.abs(dx) ? 0 : Math.PI / 2;
      m4.makeRotationY(yaw);
      m4.setPosition((w.ax + w.bx) / 2, baseY + H / 2, (w.az + w.bz) / 2);
      geo.applyMatrix4(m4);
      extraGeos.push(geo);
      // Elevated segments are lintels (doorway caps) — visual only. The gap
      // below them must stay walkable, so they get NO collision segment.
      if (baseY <= 0.01) wallSegments.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz });
    }
    if (extraGeos.length > 0) {
      const merged = mergeGeometries(extraGeos, false);
      for (const g of extraGeos) g.dispose();
      if (merged) {
        const mesh = new THREE.Mesh(merged, materials.wall);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.name = 'extra-walls-merged';
        mesh.userData.dbgKind = 'wall';
        mesh.userData.dbgSource = 'extra-walls (merged)';
        root.add(mesh);
      }
    }
  }

  // --- Torches / wall cressets ---
  // Each TorchSpec carries a fixtureKind set at emission time by
  // pickWallFixture (defaults to 'torch' for legacy specs). Resolve
  // the kind to the right ModelSpec and hand it to createTorchlight,
  // which is now model-agnostic.
  const torches: Torch[] = [];
  for (const t of spec.torches) {
    torches.push(
      createTorchlight(
        root,
        new THREE.Vector3(t.x, t.height, t.z),
        torchYawForWall(t.wall),
        t.colorTint,
        t.intensityMul,
        wallFixtureModel(t.fixtureKind),
      ),
    );
  }

  // --- Stationary fill lights ---
  // A few very-low-intensity, no-flicker PointLights per rect. Real-
  // world bounced light has uneven low-level fill; this approximates it
  // without flattening the spotlight contrast.
  //
  // PERF: each PointLight costs PER FRAGMENT × every material — count
  // dominates frame time on mobile. Earlier density (1 per 22 m²) put
  // ~16 fills on a single procgen room; combined with torches, candles,
  // floor-glow lights, pickup-pool lights + the player lantern, scenes
  // hit 30+ PointLights and lagged hard. Current budget: ~1 per 45 m²,
  // max 4 per rect (bumped from 60m² / 3 cap because the phone was
  // dark-cornering in larger procgen rooms).
  //
  // Color: averaged from the torches actually placed in the room so the
  // fill agrees with the room's mood — a blood-tinted chamber gets a
  // red-tinted ambient fill, a sickly-green chamber gets sickly-green,
  // not a generic warm wash regardless of palette. Falls back to a
  // fog-mixed warm default when the room has no torches.
  const defaultFillColor = spec.fogColor !== undefined
    ? mixColors(spec.fogColor, 0x553322, 0.5)
    : 0x2a1a10;
  for (const r of allRects) {
    // Sub-rooms (logical-only) already live inside their parent's
    // rect — adding fill lights for them double-illuminates the
    // same volume.
    if (r.logicalOnly) continue;
    const area = r.rect.w * r.rect.d;
    const count = Math.min(4, Math.max(1, Math.floor(area / 45)));
    // Average tint of torches inside this room's rect — what the
    // mood reads as. mixed with the default fill so the fill stays
    // dimmer/desaturated relative to the torches themselves.
    const fillColor = mixColors(
      averageTorchTintInRect(spec.torches, r.rect) ?? defaultFillColor,
      defaultFillColor,
      0.4,
    );
    for (let i = 0; i < count; i++) {
      const fx = r.rect.x + (((i * 1.6) % r.rect.w) - r.rect.w / 2 + r.rect.w / (count + 1));
      const fz = r.rect.z + (((i * 0.9) % r.rect.d) - r.rect.d / 2 + r.rect.d / (count + 1));
      registerLight({
        id: `fill-${lightSerial++}`,
        category: 'environment',
        position: new THREE.Vector3(fx, 1.4, fz),
        color: fillColor,
        intensity: 7,
        distance: 6.5,
        decay: 1.6,
      });
    }
  }

  // --- Procgen decoration pass (instanced) ---
  // procgenDecor is set by src/level/procgen.ts at generation time.
  // decorateFloor builds InstancedMesh batches of sigils + cracks +
  // rubble in a few draw calls instead of dozens of individual meshes.
  if (spec.procgenDecor) {
    const d = spec.procgenDecor;
    decorateFloor(d.grid, spec, rngFromSeed(d.seed), d.tint, root, stairFootprintAabbs);
  }

  // --- Per-floor fog tint ---
  // Atmospheric depth without flattening mood. The scene's Fog instance
  // gets a recolor per floor; the scene background tracks so the very-
  // distant horizon matches. Floor 2's blood crypt gets a faint red
  // tint, procgen depths get their template's torchTint, etc.
  if (spec.fogColor !== undefined && scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.color.setHex(spec.fogColor);
    if (scene.background && (scene.background as THREE.Color).isColor) {
      (scene.background as THREE.Color).setHex(spec.fogColor);
    }
  } else if (scene.fog && scene.fog instanceof THREE.Fog) {
    // Reset to the global default when a floor omits the field.
    scene.fog.color.setHex(CONFIG.FOG_COLOR);
    if (scene.background && (scene.background as THREE.Color).isColor) {
      (scene.background as THREE.Color).setHex(CONFIG.FOG_COLOR);
    }
  }

  // --- Walkable region (collision data; mutable so doors can add/remove) ---
  const walkable = new WalkableRegion(
    [...spec.rooms.map((r) => r.rect), ...spec.corridors.map((c) => c.rect)],
    obstacles,
    wallSegments,
  );

  // --- Pathfinding grids ---
  // Built once at level construction. Covers the bounding box of every
  // walkable rect; cells inside the box that aren't passable become
  // blocked. Two variants — standard (mobs avoid props) and phasing
  // (ghosts ignore props, walls only). Build cost is ~1ms at our cell
  // counts; query cost is sub-ms per chase.
  const navRects = allRects.map((r) => r.rect);
  const navBbox = {
    minX: Math.min(...navRects.map((r) => r.x - r.w / 2)),
    maxX: Math.max(...navRects.map((r) => r.x + r.w / 2)),
    minZ: Math.min(...navRects.map((r) => r.z - r.d / 2)),
    maxZ: Math.max(...navRects.map((r) => r.z + r.d / 2)),
  };
  const nav = new NavGrid(walkable, navBbox, false);
  const navPhasing = new NavGrid(walkable, navBbox, true);

  // --- Enemies + room-membership tracking ----------------------------
  // Each enemy faces the player spawn at level start so the very first frame
  // is correctly oriented.
  //
  // Room membership: an enemy belongs to the first rect whose AABB contains
  // its spawn (x,z). Used to know when a room is "cleared" for door gating.
  // Room membership keyed by the enemy's stable entityId (NOT the Enemy
  // object or its position) so the split-on-death callback can look up the
  // parent's room exactly — two enemies dying at the same spot used to
  // collide in a position-proximity scan.
  const roomByEntity = new Map<string, string | null>();
  const aliveByRoom = new Map<string, number>();
  const enemies: Enemy[] = [];
  const levelDepth = spec.depth ?? 1;

  // Single helper for spawning an enemy into the live level. Used by
  // both the initial spawn loop AND the split-on-death callback so the
  // bookkeeping (room membership, alive count) stays consistent across
  // both paths. Recursive: the spawned child receives `spawnInto`
  // again as its onDeath, so a child that itself has splitsInto will
  // also split correctly. Termination relies on the child spec NOT
  // carrying splitsInto (e.g. ooze-small has none — ooze cascades stop
  // after one generation).
  function spawnInto(baseSpec: EnemySpec, pos: THREE.Vector3, roomId: string | null): Enemy {
    const enemySpec = scaleEnemySpec(baseSpec, levelDepth, []);
    const resolved = walkable.resolveSpawn(pos.x, pos.z, enemySpec.collisionRadius);
    const e = createEnemy(
      root,
      new THREE.Vector3(resolved.x, 0, resolved.z),
      enemySpec,
      onEnemyDeath,
    );
    enemies.push(e);
    roomByEntity.set(e.entityId, roomId);
    if (roomId) aliveByRoom.set(roomId, (aliveByRoom.get(roomId) ?? 0) + 1);
    // Every boss body (the king + each split child) joins the one boss
    // encounter, so "boss done" means ALL of them are dead.
    if (e.isBoss) registerBossMember(e);
    return e;
  }

  // Fired right after an enemy dies in enemy.ts:takeDamage. Handles
  // splitsInto — spawns N children scattered in a small ring around
  // the death position. Roomid comes from where the PARENT was
  // tracked so split children stay attributed to the same room for
  // door-clear bookkeeping (kill the parent → kids spawn in the same
  // sealed combat room → you have to kill them too).
  const onEnemyDeath = (deadSpec: EnemySpec, deathPos: THREE.Vector3, deadEntityId: string) => {
    const split = deadSpec.splitsInto;
    if (!split) return;
    const childBase = ENEMIES[split.enemyId];
    if (!childBase) return;
    const radius = split.radius ?? 0.4;
    // The parent's room, looked up EXACTLY by its entityId (set at spawn).
    // Children inherit it so they stay attributed to the same sealed combat
    // room for door-clear bookkeeping.
    const parentRoom = roomByEntity.get(deadEntityId) ?? null;
    // A splitting "spit" — the parent bursts and flings the spawns
    // outward (a screen-shake thud + an outward knockback impulse on each
    // so they scatter dynamically, then settle), rather than just popping
    // into place. The parent's own death dissolve provides the goo.
    const bigSplit = split.count >= 3;
    if (bigSplit) kickShake(0.3, 0.4);
    // A BOSS splitting is a phase transition (king → its spawns = phase 2).
    if (deadSpec.isBoss) advanceBossPhase();
    for (let i = 0; i < split.count; i++) {
      const angle = (i / split.count) * Math.PI * 2 + Math.random() * 0.3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const childPos = new THREE.Vector3(
        deathPos.x + cos * radius,
        0,
        deathPos.z + sin * radius,
      );
      const child = spawnInto(childBase, childPos, parentRoom);
      // Fling it outward from the burst point.
      child.applyKnockback(cos, sin, bigSplit ? 6.0 : 3.5);
    }
  };

  for (const s of spec.spawns) {
    const baseSpec = ENEMIES[s.enemyId];
    if (!baseSpec) {
      // eslint-disable-next-line no-console
      console.warn(`Unknown enemyId in spawn: ${s.enemyId}`);
      continue;
    }
    // Difficulty pipeline — apply depth scaling + any modifier tags on
    // the spawn entry. Returns an instance-ready spec (the registry
    // entry is never mutated).
    const enemySpec = scaleEnemySpec(baseSpec, levelDepth, s.modifiers);
    // Resolve the spawn against the walkable region — if the authored
    // (or procgen-rolled) cell lands on a fountain / altar / pillar /
    // wall, scan outward for the nearest free spot. Without this, mobs
    // can spawn stuck inside a prop and never move.
    const resolved = walkable.resolveSpawn(s.x, s.z, enemySpec.collisionRadius);
    const enemy = createEnemy(
      root,
      new THREE.Vector3(resolved.x, 0, resolved.z),
      enemySpec,
      onEnemyDeath,
      { dormant: s.dormant },
    );
    enemy.faceWorld(spec.startPos.x, spec.startPos.z);
    enemies.push(enemy);
    // Room membership uses the resolved position so a mob nudged across
    // a doorway is attributed to the room it actually ended up in.
    const roomId = s.roomId ?? findRoomContaining(resolved.x, resolved.z, spec.rooms);
    roomByEntity.set(enemy.entityId, roomId);
    if (roomId) aliveByRoom.set(roomId, (aliveByRoom.get(roomId) ?? 0) + 1);
    // Authored boss spawns (the king) MUST join the encounter container too
    // — without this they're never a `liveBossMember`, so the boss bar never
    // engages and a dormant boss stays asleep forever. (The split helper
    // registers spawned children; this is the missing initial-spawn case.)
    if (enemy.isBoss) registerBossMember(enemy);
  }

  // --- Doors ---------------------------------------------------------
  // Doors close gaps in the wall layout. They start sealed if their unlock
  // condition isn't met (defaults: cleared rooms). They listen for
  // room:cleared events to flip to closed (interactable). Arena doors
  // are now driven by cross-axis trigger in door.ts; no level-side
  // lookup needed.
  // Fold the legacy DoorSpec list into the unified opening list — a door is
  // just a fitting in a wall opening. Centre + wall-line rotY + span come
  // straight off the segment; endpoints carried through so the door builder's
  // hinge math is byte-identical.
  for (const d of spec.doors ?? []) {
    pendingFittings.push({
      id: d.id,
      kind: d.unlock?.kind === 'cleared' ? 'gate-cleared'
          : d.unlock?.kind === 'arena'   ? 'gate-arena'
          : 'door-hinged',
      x: (d.ax + d.bx) / 2, z: (d.az + d.bz) / 2,
      rotY: Math.atan2(d.bz - d.az, d.bx - d.ax),
      widthM: Math.hypot(d.bx - d.ax, d.bz - d.az),
      height: d.height,
      ax: d.ax, az: d.az, bx: d.bx, bz: d.bz,
      hinge: d.hinge, swingDir: d.swingDir,
      // An arena gate whose room holds a challenge offering becomes a
      // voluntary 'offering' trigger — it won't slam on entry; the offering
      // starts the trial. Otherwise it's the default trap (slam on cross).
      unlock: d.unlock?.kind === 'arena' && d.unlock.roomIds.some((r) => offeringRooms.has(r))
        ? { ...d.unlock, trigger: 'offering' as const }
        : d.unlock,
    });
  }
  // Drain — install every fitting at its opening. Per-opening room height so a
  // door/gate/fog lintel fills to the right ceiling.
  const doorTeardowns: Array<() => void> = [];
  for (const o of pendingFittings) {
    const r = spawnFitting(root, o, walkable, {
      materials,
      enemyRoomMembership: () => aliveByRoom,
      roomHeight: roomHeightAt(spec.rooms, o.x, o.z),
      addDestructible: (d) => destructibles.push(d),
    });
    if (r.teardown) doorTeardowns.push(r.teardown);
  }

  // --- Arenas --------------------------------------------------------
  // A room sealed by an ARENA gate becomes a wave-gauntlet ENCOUNTER. The
  // gate's slam activates it; it summons escalating waves and resolves only
  // once the LAST wave is dead — which is what lets the gate finally rise.
  // The gate gates on the encounter's completion (not the momentary room-empty
  // count), so it stays down at slam and through the inter-wave lulls. This is
  // the first user of the Encounter layer (see encounters/registry.ts); ticks
  // run globally via tickEncounters in the system loop.
  const seenArenaRooms = new Set<string>();
  for (const d of spec.doors ?? []) {
    if (d.unlock?.kind !== 'arena') continue;
    for (const roomId of d.unlock.roomIds) {
      if (seenArenaRooms.has(roomId)) continue;
      seenArenaRooms.add(roomId);
      const room = spec.rooms.find((r) => r.id === roomId);
      if (!room) continue;
      // Escalating gauntlet; per-mob difficulty is depth-scaled inside
      // spawnInto. Ends on ranged pressure so the last wave isn't a pushover.
      const waves: WaveSpec[] = [
        { spawns: [{ enemyId: 'ghoul', count: 2 }] },
        { spawns: [{ enemyId: 'ghoul', count: 2 }, { enemyId: 'skeleton', count: 1 }] },
        { spawns: [{ enemyId: 'skeleton', count: 2 }, { enemyId: 'acid-spitter', count: 1 }] },
      ];
      let handle: EncounterHandle;
      const controller = createArenaController({
        roomId,
        scene: root,
        rect: room.rect,
        waves,
        tint: 0xc01818,
        walkable,
        spawn: (enemyId, pos) => {
          const base = ENEMIES[enemyId];
          return base ? spawnInto(base, pos, roomId) : null;
        },
        onComplete: () => handle.complete(),
      });
      handle = registerEncounter(arenaEncounterId(roomId), {
        onActivate: () => controller.start(),
        tick: (dt, pos) => controller.tick(dt, pos),
      });
    }
  }

  // Plain room-clear gates ('cleared') become the degenerate encounter:
  // active from the start, resolves the frame the room is empty. Folds the
  // old aliveByRoom gate check into the same lifecycle as everything else —
  // a room with no mobs completes on its first tick (so the gate isn't stuck).
  const seenClearRooms = new Set<string>();
  for (const d of spec.doors ?? []) {
    if (d.unlock?.kind !== 'cleared') continue;
    for (const roomId of d.unlock.roomIds) {
      if (seenClearRooms.has(roomId)) continue;
      seenClearRooms.add(roomId);
      let handle: EncounterHandle;
      handle = registerEncounter(roomClearEncounterId(roomId), {
        tick: () => {
          let alive = 0;
          for (const en of enemies) {
            if (roomByEntity.get(en.entityId) === roomId && en.alive) alive++;
          }
          if (alive === 0) handle.complete();
        },
      });
      activateEncounter(roomClearEncounterId(roomId));
    }
  }

  // --- Stairs --------------------------------------------------------
  for (const st of spec.stairs ?? []) {
    spawnStairs(root, st, materials, (target) => onDescend?.(target));
  }

  // Per-frame check (tucked into a separate driver below) wires room-clear
  // detection: walk enemies, recompute aliveByRoom, emit room:cleared when
  // a count flips from >0 to 0.
  //
  // Done lazily so we don't have to plumb a tick callback. main.ts ticks
  // enemies anyway; we hook into that via a Proxy isn't worth it. Instead,
  // expose tickRoomClearTracker — called from main.ts after enemy updates.

  // We attach tickRoomClearTracker to the LiveLevel for now via the
  // teardown closure (alternative would be a separate property; keep
  // interface lean — main.ts can read it off level.checkRoomClear).
  function checkRoomClear() {
    for (const [roomId, count] of aliveByRoom) {
      let stillAlive = 0;
      for (const enemy of enemies) {
        if (roomByEntity.get(enemy.entityId) === roomId && enemy.alive) stillAlive++;
      }
      if (stillAlive === 0 && count > 0) {
        aliveByRoom.set(roomId, 0);
        emit({ type: 'room:cleared', roomId });
      }
    }
  }

  let torndown = false;
  function teardown() {
    if (torndown) return;
    torndown = true;
    // Detach event-bus listeners owned by the level (door listeners).
    for (const td of doorTeardowns) td();
    // Release ECS entities for anything the player left behind on this floor
    // so they don't leak into the world map across descents (killed mobs +
    // smashed vases already clean up on death). Idempotent.
    for (const d of destructibles) disposeDestructible(d);
    for (const e of enemies) disposeEnemy(e);
    // Wipe the interactables list — pickups + doors + stairs + chests all
    // get reset. The pickup light pool persists; it's scene-wide.
    clearInteractables();
    // Yank the root from the scene. Geometry/material disposal walks the
    // subtree so GPU memory isn't held.
    scene.remove(root);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        // Only dispose geometries unique to this level. POOLED geometries
        // (see scene/geometry-pool.ts) are shared across levels — disposing
        // them would yank vertex buffers out from under meshes in the
        // NEXT level. Shared materials (the StyleMaterials set) follow
        // the same rule and are skipped by virtue of never being walked
        // here (materials aren't disposed in this loop).
        if (!isPooledGeometry(mesh.geometry)) mesh.geometry.dispose();
      }
    });
  }

  emit({ type: 'level:loaded', levelId: spec.id });

  return {
    spec,
    walkable,
    nav,
    navPhasing,
    torches,
    enemies,
    destructibles,
    playerSpawn: spec.startPos,
    root,
    teardown,
    // Stash on the object via casting; main.ts pulls this out via a typed
    // wrapper if needed. For now expose directly.
    ...({ checkRoomClear } as object),
  } as LiveLevel & { checkRoomClear: () => void };
}

/** Which room rect contains (x, z)? Prefers logical-only sub-rooms over
 *  their parent vault rect — they're the finer-grained attribution
 *  emitted by multi-room vault parsing. Null if outside all. */
/** Room ceiling height at (x,z) — for sizing a fitting's lintel fill. A
 *  fitting sits on a wall edge; a small margin lets a boundary point still
 *  resolve to its room. Falls back to the first room's height. */
function roomHeightAt(rooms: RoomSpec[], x: number, z: number): number {
  for (const r of rooms) {
    const hw = r.rect.w / 2, hd = r.rect.d / 2;
    if (x >= r.rect.x - hw - 0.05 && x <= r.rect.x + hw + 0.05 &&
        z >= r.rect.z - hd - 0.05 && z <= r.rect.z + hd + 0.05) {
      return r.height;
    }
  }
  return rooms[0]?.height ?? 3.2;
}

function findRoomContaining(x: number, z: number, rooms: RoomSpec[]): string | null {
  const containsHere = (r: RoomSpec): boolean => {
    const hw = r.rect.w / 2;
    const hd = r.rect.d / 2;
    return x >= r.rect.x - hw && x <= r.rect.x + hw && z >= r.rect.z - hd && z <= r.rect.z + hd;
  };
  // Sub-rooms first (more specific).
  for (const r of rooms) {
    if (!r.logicalOnly) continue;
    if (containsHere(r)) return r.id;
  }
  // Fall back to main rooms.
  for (const r of rooms) {
    if (r.logicalOnly) continue;
    if (containsHere(r)) return r.id;
  }
  return null;
}
