import * as THREE from 'three';
import type { LevelSpec, RoomSpec, TorchSpec } from './types';
import { WalkableRegion, type WallSegment, type Obstacle } from './walkable';
import { CONFIG } from '../config';
import type { StyleMaterials } from '../style/materials';
import { createTorchlight, type Torch } from '../scene/torchlight';
import { createEnemy, type Enemy } from '../mobs/enemy';
import { ENEMIES } from '../content/enemies';
import { buildModel } from '../ecs/build-model';
import { spawnChest } from '../interactables/chest';
import { spawnDoor } from '../interactables/door';
import { spawnStairs } from '../interactables/stairs';
import { spawnCorpse } from '../interactables/corpse';
import { spawnSpikeTrap } from '../interactables/spike-trap';
import { spawnFountain } from '../interactables/fountain';
import { registerLight, clearLightPool } from '../scene/light-pool';
import { decorateFloor } from './decorate';

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
  torches: Torch[];
  enemies: Enemy[];
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

function makeJitteredPlane(width: number, height: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(
    width,
    height,
    CONFIG.WALL_SUBDIVISIONS_X,
    CONFIG.WALL_SUBDIVISIONS_Y,
  );
  const pos = geo.attributes.position;
  const jitter = CONFIG.WALL_VERTEX_JITTER;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const onEdgeX = Math.abs(Math.abs(x) - width / 2) < 1e-4;
    const onEdgeY = Math.abs(Math.abs(y) - height / 2) < 1e-4;
    if (onEdgeX || onEdgeY) continue;
    pos.setZ(i, (Math.random() - 0.5) * 2 * jitter);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Per-vertex color tint jitter: each vertex gets an RGB multiplier in
  // [0.7, 1.0]. The material multiplies this against its base color, so
  // walls + floor get subtle dark/light splotches instead of one flat tone.
  // Each channel is randomized slightly independently for color drift too.
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const base = 0.7 + Math.random() * 0.3;     // overall darkness per vertex
    const tintR = base * (0.94 + Math.random() * 0.06);
    const tintG = base * (0.94 + Math.random() * 0.06);
    const tintB = base * (0.94 + Math.random() * 0.06);
    colors[i * 3 + 0] = tintR;
    colors[i * 3 + 1] = tintG;
    colors[i * 3 + 2] = tintB;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return geo;
}

function buildRoomShell(scene: THREE.Object3D, room: RoomSpec, allRects: RoomSpec[], materials: StyleMaterials, wallSegmentsOut: WallSegment[]) {
  const { rect, height: H } = room;
  const W = rect.w;
  const D = rect.d;

  // Floor
  const floor = new THREE.Mesh(makeJitteredPlane(W, D), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(rect.x, 0, rect.z);
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), materials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(rect.x, H, rect.z);
  ceiling.receiveShadow = true;
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

  for (const we of wallEdges) {
    const openings = findOpenings(we, allRects, room);
    const segments = subtractRanges(we.wallStart, we.wallEnd, openings);
    for (const seg of segments) {
      const segLen = seg.end - seg.start;
      if (segLen < 0.01) continue;
      buildWallSegment(scene, we, seg.start, seg.end, H, materials);
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
}

function buildWallSegment(
  scene: THREE.Object3D,
  we: { side: 'N' | 'S' | 'E' | 'W'; perpAxis: 'x' | 'z'; perpCoord: number },
  segStart: number,
  segEnd: number,
  height: number,
  materials: StyleMaterials,
) {
  const segLen = segEnd - segStart;
  const segMid = (segStart + segEnd) / 2;
  const mesh = new THREE.Mesh(makeJitteredPlane(segLen, height), materials.wall);
  mesh.receiveShadow = true;

  // Position + facing based on which side of the room this wall is.
  if (we.side === 'N') {
    // North wall: at z = perpCoord (= rect.z - halfD), facing inward (+Z)
    mesh.position.set(segMid, height / 2, we.perpCoord);
    mesh.rotation.y = 0;
  } else if (we.side === 'S') {
    mesh.position.set(segMid, height / 2, we.perpCoord);
    mesh.rotation.y = Math.PI;
  } else if (we.side === 'W') {
    mesh.position.set(we.perpCoord, height / 2, segMid);
    mesh.rotation.y = Math.PI / 2;
  } else { // E
    mesh.position.set(we.perpCoord, height / 2, segMid);
    mesh.rotation.y = -Math.PI / 2;
  }
  scene.add(mesh);
}

// Find segments where another rect's edge coincides with this wall edge.
// "Coincides" = on the same line (same perpendicular coord) AND overlapping
// in the running-axis direction.
function findOpenings(
  we: { perpAxis: 'x' | 'z'; perpCoord: number; wallStart: number; wallEnd: number },
  allRects: RoomSpec[],
  selfRoom: RoomSpec,
): Array<{ start: number; end: number }> {
  const EPS = 0.01;
  const openings: Array<{ start: number; end: number }> = [];
  for (const other of allRects) {
    if (other === selfRoom) continue;
    const o = other.rect;
    if (we.perpAxis === 'z') {
      // wall runs along X; coincide if any of other's Z-edges == we.perpCoord
      const oSouth = o.z + o.d / 2;
      const oNorth = o.z - o.d / 2;
      const coincides = Math.abs(oSouth - we.perpCoord) < EPS || Math.abs(oNorth - we.perpCoord) < EPS;
      if (!coincides) continue;
      const a = Math.max(we.wallStart, o.x - o.w / 2);
      const b = Math.min(we.wallEnd, o.x + o.w / 2);
      if (b > a + EPS) openings.push({ start: a, end: b });
    } else {
      // wall runs along Z; coincide if any of other's X-edges == we.perpCoord
      const oEast = o.x + o.w / 2;
      const oWest = o.x - o.w / 2;
      const coincides = Math.abs(oEast - we.perpCoord) < EPS || Math.abs(oWest - we.perpCoord) < EPS;
      if (!coincides) continue;
      const a = Math.max(we.wallStart, o.z - o.d / 2);
      const b = Math.min(we.wallEnd, o.z + o.d / 2);
      if (b > a + EPS) openings.push({ start: a, end: b });
    }
  }
  return openings;
}

// Subtract a set of [start, end] openings from a [start, end] range.
function subtractRanges(start: number, end: number, openings: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = [...openings].sort((a, b) => a.start - b.start);
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const op of sorted) {
    if (op.start > cursor) segments.push({ start: cursor, end: Math.min(op.start, end) });
    cursor = Math.max(cursor, op.end);
    if (cursor >= end) break;
  }
  if (cursor < end) segments.push({ start: cursor, end });
  return segments;
}

function torchYawForWall(wall: 'N' | 'S' | 'E' | 'W'): number {
  switch (wall) {
    case 'N': return 0;
    case 'S': return Math.PI;
    case 'E': return -Math.PI / 2;
    case 'W': return Math.PI / 2;
  }
}

export function buildLevel(
  scene: THREE.Scene,
  spec: LevelSpec,
  materials: StyleMaterials,
  onDescend?: (targetLevel: string) => void,
): LiveLevel {
  // Per-level lights start fresh. Persistent sources (the camera-
  // attached lantern) survive — see light-pool.clearLightPool.
  clearLightPool();

  // Everything goes into this root group rather than directly into the
  // scene — teardown is a single scene.remove(root). Geometry/material
  // disposal walks root's tree.
  const root = new THREE.Group();
  root.name = `level-${spec.id}`;
  scene.add(root);

  // --- Geometry: rooms + corridors ---
  const allRects: RoomSpec[] = [...spec.rooms, ...spec.corridors];
  const wallSegments: WallSegment[] = [];
  for (const r of allRects) buildRoomShell(root, r, allRects, materials, wallSegments);

  // --- Props (visual meshes) + collect obstacles for collision ---
  const obstacles: Obstacle[] = [];

  for (const prop of spec.props) {
    if (prop.kind === 'pillar') {
      const size = prop.size ?? PILLAR_DEFAULT_SIZE;
      const H = spec.rooms[0]?.height ?? 3.2;
      const geo = new THREE.BoxGeometry(size, H, size);
      const pillar = new THREE.Mesh(geo, materials.wall);
      pillar.position.set(prop.x, H / 2, prop.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      root.add(pillar);
      const halfSz = size / 2;
      obstacles.push({
        kind: 'aabb',
        minX: prop.x - halfSz, maxX: prop.x + halfSz,
        minZ: prop.z - halfSz, maxZ: prop.z + halfSz,
      });
    } else if (prop.kind === 'altar') {
      const altarGeo = new THREE.BoxGeometry(0.9, 0.55, 0.6);
      const altar = new THREE.Mesh(altarGeo, materials.wall);
      altar.position.set(prop.x, 0.275, prop.z);
      altar.castShadow = true;
      altar.receiveShadow = true;
      root.add(altar);

      const baseGeo = new THREE.BoxGeometry(1.2, 0.1, 0.9);
      const altarBase = new THREE.Mesh(baseGeo, materials.floor);
      altarBase.position.set(prop.x, 0.05, prop.z);
      altarBase.receiveShadow = true;
      root.add(altarBase);

      obstacles.push({
        kind: 'aabb',
        minX: prop.x - 0.6, maxX: prop.x + 0.6,
        minZ: prop.z - 0.45, maxZ: prop.z + 0.45,
      });
    } else if (prop.kind === 'model') {
      const built = buildModel(prop.model);
      built.group.position.set(prop.x, prop.y, prop.z);
      if (prop.rotX) built.group.rotation.x = prop.rotX;
      if (prop.rotY) built.group.rotation.y = prop.rotY;
      if (prop.rotZ) built.group.rotation.z = prop.rotZ;
      root.add(built.group);
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
          color: lp.color,
          intensity: lp.intensity,
          distance: lp.distance,
          decay: lp.decay,
        });
      }
    } else if (prop.kind === 'chest') {
      spawnChest(root, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0, prop.loot);
      obstacles.push({
        kind: 'aabb',
        minX: prop.x - 0.28, maxX: prop.x + 0.28,
        minZ: prop.z - 0.23, maxZ: prop.z + 0.23,
      });
    } else if (prop.kind === 'corpse') {
      spawnCorpse(root, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0, prop.note);
      // No collision — player can step over the body. Walking right up
      // to READ it shouldn't be blocked.
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
      spawnFountain(root, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0);
      // Cylindrical collision — approximate the pedestal/bowl footprint.
      obstacles.push({
        kind: 'circle', x: prop.x, z: prop.z, r: 0.45,
      });
    }
  }

  // --- Extra walls (from tile-map parsing — interior walls inside the
  //     bounding room rect). Render them as wall meshes + add to
  //     collision so the player can't walk through them.
  if (spec.extraWalls) {
    const defaultH = spec.rooms[0]?.height ?? 3.0;
    for (const w of spec.extraWalls) {
      const H = w.height ?? defaultH;
      const dx = w.bx - w.ax;
      const dz = w.bz - w.az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const mesh = new THREE.Mesh(makeJitteredPlane(len, H), materials.wall);
      mesh.position.set((w.ax + w.bx) / 2, H / 2, (w.az + w.bz) / 2);
      // Orient: horizontal wall (running along X) faces ±Z; vertical
      // (running along Z) faces ±X. Single-sided is fine since the
      // wall is between two cells (one walkable, one solid) and the
      // mesh is double-rendered as MeshStandardMaterial side='front'
      // — but we use the wall material as-is.
      if (Math.abs(dz) < Math.abs(dx)) {
        // X-running wall — rotate so its normal is ±Z.
        mesh.rotation.y = 0;
      } else {
        // Z-running wall — rotate normal to ±X.
        mesh.rotation.y = Math.PI / 2;
      }
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      root.add(mesh);
      wallSegments.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz });
    }
  }

  // --- Torches ---
  const torches: Torch[] = [];
  for (const t of spec.torches) {
    torches.push(
      createTorchlight(
        root,
        new THREE.Vector3(t.x, t.height, t.z),
        torchYawForWall(t.wall),
        t.colorTint,
        t.intensityMul,
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
  // hit 30+ PointLights and lagged hard. New budget: ~1 per 60 m², max
  // 3 per rect. Floor 1 chamber gets 1, procgen rooms get 2-3 — still
  // enough to vary the ambient without crushing the GPU.
  const fillColor = spec.fogColor !== undefined
    ? mixColors(spec.fogColor, 0x553322, 0.5)
    : 0x2a1a10;
  for (const r of allRects) {
    const area = r.rect.w * r.rect.d;
    const count = Math.min(3, Math.max(1, Math.floor(area / 60)));
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
    decorateFloor(d.grid, spec, rngFromSeed(d.seed), d.tint, root);
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

  // --- Enemies + room-membership tracking ----------------------------
  // Each enemy faces the player spawn at level start so the very first frame
  // is correctly oriented.
  //
  // Room membership: an enemy belongs to the first rect whose AABB contains
  // its spawn (x,z). Used to know when a room is "cleared" for door gating.
  const enemyRoom = new Map<Enemy, string | null>();
  const aliveByRoom = new Map<string, number>();
  const enemies: Enemy[] = [];
  for (const s of spec.spawns) {
    const enemySpec = ENEMIES[s.enemyId];
    if (!enemySpec) {
      // eslint-disable-next-line no-console
      console.warn(`Unknown enemyId in spawn: ${s.enemyId}`);
      continue;
    }
    const enemy = createEnemy(root, new THREE.Vector3(s.x, 0, s.z), enemySpec);
    enemy.faceWorld(spec.startPos.x, spec.startPos.z);
    enemies.push(enemy);
    const roomId = s.roomId ?? findRoomContaining(s.x, s.z, spec.rooms);
    enemyRoom.set(enemy, roomId);
    if (roomId) aliveByRoom.set(roomId, (aliveByRoom.get(roomId) ?? 0) + 1);
  }

  // --- Doors ---------------------------------------------------------
  // Doors close gaps in the wall layout. They start sealed if their unlock
  // condition isn't met (defaults: cleared rooms). They listen for
  // room:cleared events to flip to closed (interactable).
  const doorTeardowns: Array<() => void> = [];
  for (const d of spec.doors ?? []) {
    const h = spawnDoor(root, d, walkable, materials, () => aliveByRoom);
    doorTeardowns.push(h.teardown);
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
        if (enemyRoom.get(enemy) === roomId && enemy.alive) stillAlive++;
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
    // Wipe the interactables list — pickups + doors + stairs + chests all
    // get reset. The pickup light pool persists; it's scene-wide.
    clearInteractables();
    // Yank the root from the scene. Geometry/material disposal walks the
    // subtree so GPU memory isn't held.
    scene.remove(root);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        // Only dispose geometries unique to this level. Shared materials
        // (the StyleMaterials set) are reused across levels — don't dispose.
        mesh.geometry?.dispose();
      }
    });
  }

  emit({ type: 'level:loaded', levelId: spec.id });

  return {
    spec,
    walkable,
    torches,
    enemies,
    playerSpawn: spec.startPos,
    root,
    teardown,
    // Stash on the object via casting; main.ts pulls this out via a typed
    // wrapper if needed. For now expose directly.
    ...({ checkRoomClear } as object),
  } as LiveLevel & { checkRoomClear: () => void };
}

/** Linear mix between two hex colors. t=0 returns a, t=1 returns b. */
function mixColors(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Which room rect contains (x, z)? First match wins. Null if outside all. */
function findRoomContaining(x: number, z: number, rooms: RoomSpec[]): string | null {
  for (const r of rooms) {
    const hw = r.rect.w / 2;
    const hd = r.rect.d / 2;
    if (x >= r.rect.x - hw && x <= r.rect.x + hw && z >= r.rect.z - hd && z <= r.rect.z + hd) {
      return r.id;
    }
  }
  return null;
}
