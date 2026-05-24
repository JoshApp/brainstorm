import * as THREE from 'three';
import { CONFIG } from '../config';

// Builds the Phase 1 single dungeon room.
// All geometry is primitive — no asset files, no textures.
// The "stone" feel comes from lighting + slight surface variation.

export function buildDungeonRoom(scene: THREE.Scene) {
  const { ROOM_WIDTH: W, ROOM_DEPTH: D, ROOM_HEIGHT: H } = CONFIG;

  const wallMat = new THREE.MeshStandardMaterial({
    color: CONFIG.WALL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: CONFIG.FLOOR_COLOR,
    roughness: 1.0,
    metalness: 0.0,
  });

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: CONFIG.CEILING_COLOR,
    roughness: 1.0,
    metalness: 0.0,
  });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // Walls — four planes facing inward
  const walls = [
    { pos: [0, H / 2, -D / 2], rot: [0, 0, 0], size: [W, H] },        // north
    { pos: [0, H / 2, D / 2], rot: [0, Math.PI, 0], size: [W, H] },   // south
    { pos: [-W / 2, H / 2, 0], rot: [0, Math.PI / 2, 0], size: [D, H] }, // west
    { pos: [W / 2, H / 2, 0], rot: [0, -Math.PI / 2, 0], size: [D, H] }, // east
  ];

  for (const w of walls) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.size[0], w.size[1]), wallMat);
    mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    mesh.rotation.set(w.rot[0], w.rot[1], w.rot[2]);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    scene.add(mesh);
  }
}
