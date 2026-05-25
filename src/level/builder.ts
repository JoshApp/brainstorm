import * as THREE from 'three';
import type { LevelSpec, RoomSpec, ObstacleCircle, TorchSpec } from './types';
import { WalkableRegion } from './walkable';
import { CONFIG } from '../config';
import type { StyleMaterials } from '../style/materials';
import { createTorchlight, type Torch } from '../scene/torchlight';
import { createEnemy, type Enemy } from '../mobs/enemy';
import { ENEMIES } from '../content/enemies';

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
  return geo;
}

function buildRoomShell(scene: THREE.Scene, room: RoomSpec, materials: StyleMaterials) {
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

  // Four walls, inward-facing
  const halfW = W / 2;
  const halfD = D / 2;
  const walls = [
    // north (-Z): plane facing +Z
    { pos: [rect.x, H / 2, rect.z - halfD], rot: [0, 0, 0], size: [W, H] },
    // south (+Z): plane facing -Z
    { pos: [rect.x, H / 2, rect.z + halfD], rot: [0, Math.PI, 0], size: [W, H] },
    // west (-X): plane facing +X
    { pos: [rect.x - halfW, H / 2, rect.z], rot: [0, Math.PI / 2, 0], size: [D, H] },
    // east (+X): plane facing -X
    { pos: [rect.x + halfW, H / 2, rect.z], rot: [0, -Math.PI / 2, 0], size: [D, H] },
  ];

  for (const w of walls) {
    const mesh = new THREE.Mesh(makeJitteredPlane(w.size[0], w.size[1]), materials.wall);
    mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    mesh.rotation.set(w.rot[0], w.rot[1], w.rot[2]);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
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
  for (const room of spec.rooms) buildRoomShell(scene, room, materials);
  for (const corridor of spec.corridors) buildRoomShell(scene, corridor, materials);

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
    }
  }

  // --- Torches ---
  const torches: Torch[] = [];
  for (const t of spec.torches) {
    torches.push(
      createTorchlight(
        scene,
        new THREE.Vector3(t.x, t.height, t.z),
        materials,
        torchYawForWall(t.wall),
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
  );

  return {
    spec,
    walkable,
    torches,
    enemies,
    playerSpawn: spec.startPos,
  };
}
