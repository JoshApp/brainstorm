import * as THREE from 'three';
import type { LevelSpec, RoomSpec, ObstacleCircle, TorchSpec } from './types';
import { WalkableRegion, type WallSegment } from './walkable';
import { CONFIG } from '../config';
import type { StyleMaterials } from '../style/materials';
import { createTorchlight, type Torch } from '../scene/torchlight';
import { createEnemy, type Enemy } from '../mobs/enemy';
import { ENEMIES } from '../content/enemies';
import { buildModel } from '../ecs/build-model';
import { spawnChest } from '../interactables/chest';

// Consumes a LevelSpec and produces the live scene + collision data. This is
// the seam where declarative data becomes Three.js objects + game entities.
//
// Returns:
//   - walkable: the collision region (queried by player and enemy each frame)
//   - torches: array of torch handles (light + flame, ticked each frame)
//   - enemies: array of enemy handles (state machine, ticked each frame)
//   - playerSpawn: where to put the camera + initial yaw

const PILLAR_OBSTACLE_RADIUS = 0.4;
const ALTAR_OBSTACLE_RADIUS = 0.65;
const PILLAR_DEFAULT_SIZE = 0.5;

export interface LiveLevel {
  spec: LevelSpec;
  walkable: WalkableRegion;
  torches: Torch[];
  enemies: Enemy[];
  playerSpawn: { x: number; z: number; yaw: number };
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

function buildRoomShell(scene: THREE.Scene, room: RoomSpec, allRects: RoomSpec[], materials: StyleMaterials, wallSegmentsOut: WallSegment[]) {
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
  scene: THREE.Scene,
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
): LiveLevel {
  // --- Geometry: rooms + corridors ---
  // All rects are collected together so each shell can find its openings into
  // adjacent rects (corridors -> rooms; rooms -> rooms if directly adjacent).
  // The same wall-segmenter that builds geometry also emits collision data,
  // so doorways automatically have no wall to collide with.
  const allRects: RoomSpec[] = [...spec.rooms, ...spec.corridors];
  const wallSegments: WallSegment[] = [];
  for (const r of allRects) buildRoomShell(scene, r, allRects, materials, wallSegments);

  // --- Props (visual meshes) + collect obstacles for collision ---
  const obstacles: ObstacleCircle[] = [];

  for (const prop of spec.props) {
    if (prop.kind === 'pillar') {
      const size = prop.size ?? PILLAR_DEFAULT_SIZE;
      // Use the first room's height for pillar height — good enough until
      // we have variable ceiling heights per region.
      const H = spec.rooms[0]?.height ?? 3.2;
      const geo = new THREE.BoxGeometry(size, H, size);
      const pillar = new THREE.Mesh(geo, materials.wall);
      pillar.position.set(prop.x, H / 2, prop.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      scene.add(pillar);
      obstacles.push({ x: prop.x, z: prop.z, r: PILLAR_OBSTACLE_RADIUS });
    } else if (prop.kind === 'altar') {
      // Altar block on a slab
      const altarGeo = new THREE.BoxGeometry(0.9, 0.55, 0.6);
      const altar = new THREE.Mesh(altarGeo, materials.wall);
      altar.position.set(prop.x, 0.275, prop.z);
      altar.castShadow = true;
      altar.receiveShadow = true;
      scene.add(altar);

      const baseGeo = new THREE.BoxGeometry(1.2, 0.1, 0.9);
      const altarBase = new THREE.Mesh(baseGeo, materials.floor);
      altarBase.position.set(prop.x, 0.05, prop.z);
      altarBase.receiveShadow = true;
      scene.add(altarBase);

      obstacles.push({ x: prop.x, z: prop.z, r: ALTAR_OBSTACLE_RADIUS });
    } else if (prop.kind === 'model') {
      // Static decoration model — no collision, no behavior, just visuals.
      const built = buildModel(prop.model);
      built.group.position.set(prop.x, prop.y, prop.z);
      if (prop.rotX) built.group.rotation.x = prop.rotX;
      if (prop.rotY) built.group.rotation.y = prop.rotY;
      if (prop.rotZ) built.group.rotation.z = prop.rotZ;
      scene.add(built.group);
    } else if (prop.kind === 'chest') {
      spawnChest(scene, new THREE.Vector3(prop.x, 0, prop.z), prop.rotY ?? 0, prop.loot);
    }
  }

  // --- Torches ---
  const torches: Torch[] = [];
  for (const t of spec.torches) {
    torches.push(
      createTorchlight(
        scene,
        new THREE.Vector3(t.x, t.height, t.z),
        torchYawForWall(t.wall),
        t.colorTint,
        t.intensityMul,
      ),
    );
  }

  // --- Enemies ---
  const enemies: Enemy[] = [];
  for (const s of spec.spawns) {
    const enemySpec = ENEMIES[s.enemyId];
    if (!enemySpec) {
      // eslint-disable-next-line no-console
      console.warn(`Unknown enemyId in spawn: ${s.enemyId}`);
      continue;
    }
    enemies.push(createEnemy(scene, new THREE.Vector3(s.x, 0, s.z), enemySpec));
  }

  // --- Walkable region (collision data) ---
  const walkable = new WalkableRegion(
    [...spec.rooms.map((r) => r.rect), ...spec.corridors.map((c) => c.rect)],
    obstacles,
    wallSegments,
  );

  return {
    spec,
    walkable,
    torches,
    enemies,
    playerSpawn: spec.startPos,
  };
}
