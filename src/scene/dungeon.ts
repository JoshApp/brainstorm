import * as THREE from 'three';
import { CONFIG } from '../config';
import type { StyleMaterials } from '../style/materials';

// Builds the Phase 1 single dungeon room.
// Materials are supplied externally by the style library so the room can be
// re-skinned (ps1/flat/stone) without touching the geometry pipeline.

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

export function buildDungeonRoom(scene: THREE.Scene, materials: StyleMaterials) {
  const { ROOM_WIDTH: W, ROOM_DEPTH: D, ROOM_HEIGHT: H } = CONFIG;

  // Floor — also jittered, so the player sees underfoot variation
  const floor = new THREE.Mesh(makeJitteredPlane(W, D), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling — kept flat
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), materials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // Walls — four planes facing inward, with vertex jitter for stone surface
  const walls = [
    { pos: [0, H / 2, -D / 2], rot: [0, 0, 0], size: [W, H] },        // north
    { pos: [0, H / 2, D / 2], rot: [0, Math.PI, 0], size: [W, H] },   // south
    { pos: [-W / 2, H / 2, 0], rot: [0, Math.PI / 2, 0], size: [D, H] }, // west
    { pos: [W / 2, H / 2, 0], rot: [0, -Math.PI / 2, 0], size: [D, H] }, // east
  ];

  for (const w of walls) {
    const mesh = new THREE.Mesh(makeJitteredPlane(w.size[0], w.size[1]), materials.wall);
    mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    mesh.rotation.set(w.rot[0], w.rot[1], w.rot[2]);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    scene.add(mesh);
  }

  // --- Four stone pillars: square columns at x=±1.8, z=±1.5 ---
  // The player spawns inside the rectangle they form. Pillars cast shadows
  // from the torch toward the corners, creating depth and tactical hiding
  // positions for future combat scenarios.
  const pillarGeo = new THREE.BoxGeometry(0.5, H, 0.5);
  // Pulled to z=±2.2 (was ±1.5) so the player spawns LOOKING DOWN A
  // COLONNADE rather than boxed in by columns directly beside them.
  const pillarPositions: Array<[number, number, number]> = [
    [-1.8, H / 2, -2.2],
    [1.8, H / 2, -2.2],
    [-1.8, H / 2, 2.2],
    [1.8, H / 2, 2.2],
  ];
  for (const [px, py, pz] of pillarPositions) {
    const pillar = new THREE.Mesh(pillarGeo, materials.wall);
    pillar.position.set(px, py, pz);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
  }

  // --- Altar at the back of the room ---
  // Low stone block centered behind where the enemy spawns, in front of the
  // north torch. Visual focal point + foreshadows future loot/rune spawns.
  const altarGeo = new THREE.BoxGeometry(0.9, 0.55, 0.6);
  const altar = new THREE.Mesh(altarGeo, materials.wall);
  altar.position.set(0, 0.275, -2.8);
  altar.castShadow = true;
  altar.receiveShadow = true;
  scene.add(altar);

  // --- Altar base — slightly wider stone slab underneath ---
  const baseGeo = new THREE.BoxGeometry(1.2, 0.1, 0.9);
  const altarBase = new THREE.Mesh(baseGeo, materials.floor);
  altarBase.position.set(0, 0.05, -2.8);
  altarBase.castShadow = false;
  altarBase.receiveShadow = true;
  scene.add(altarBase);
}
