import * as THREE from 'three';
import type { StairsSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';

// Stairs = a visible descent into the floor + an interactable that requests
// a level transition. The actual loadLevel call lives in main.ts (it owns
// the scene + the player); stairs delegate via a callback passed in at
// spawn time. That keeps this module dependency-light and lets stairs sit
// inside the interactables tree like everything else.

const STEP_COUNT = 6;
const STEP_DEPTH = 0.34;      // m along the descent direction
const STEP_HEIGHT = 0.18;     // m vertical drop per step
const STEP_WIDTH = 1.8;       // m wide

export function spawnStairs(
  parent: THREE.Object3D,
  spec: StairsSpec,
  materials: StyleMaterials,
  onDescend: (targetLevel: string) => void,
) {
  // The staircase group sits at (x,z) with rotY around vertical. Builds
  // steps marching in the local +Z direction, descending into negative Y.
  const group = new THREE.Group();
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.rotY ?? 0;
  parent.add(group);

  // Steps — front-facing rises + horizontal treads. Stack them so the
  // top tread is at y=0 (floor level), each subsequent step recedes and
  // drops.
  for (let i = 0; i < STEP_COUNT; i++) {
    const yTop = -i * STEP_HEIGHT;
    const zFront = i * STEP_DEPTH;
    // Tread (the horizontal you step on)
    const treadGeo = new THREE.BoxGeometry(STEP_WIDTH, 0.04, STEP_DEPTH);
    const tread = new THREE.Mesh(treadGeo, materials.floor);
    tread.position.set(0, yTop - 0.02, zFront + STEP_DEPTH / 2);
    tread.receiveShadow = true;
    group.add(tread);
    // Riser (the vertical you don't step on)
    const riserGeo = new THREE.BoxGeometry(STEP_WIDTH, STEP_HEIGHT, 0.04);
    const riser = new THREE.Mesh(riserGeo, materials.wall);
    riser.position.set(0, yTop - STEP_HEIGHT / 2, zFront);
    riser.receiveShadow = true;
    group.add(riser);
  }

  // Side walls flanking the descent — visually frames the stairwell so it
  // doesn't look like a hole in the floor.
  const totalDepth = STEP_COUNT * STEP_DEPTH;
  const totalDrop = STEP_COUNT * STEP_HEIGHT;
  for (const side of [-1, 1]) {
    const wallGeo = new THREE.BoxGeometry(0.1, totalDrop + 0.6, totalDepth);
    const wall = new THREE.Mesh(wallGeo, materials.wall);
    wall.position.set(side * (STEP_WIDTH / 2 + 0.05), -totalDrop / 2 + 0.3, totalDepth / 2);
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Darkness at the bottom — a black plane facing the player so the bottom
  // of the stairwell reads as "into the dark, deeper" rather than ending.
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const black = new THREE.Mesh(new THREE.PlaneGeometry(STEP_WIDTH, totalDrop), blackMat);
  black.position.set(0, -totalDrop / 2, totalDepth);
  group.add(black);

  // Subtle cool glow at the bottom — implies something is down there. Pulls
  // from materials' palette accent if we want, but a simple cyan PointLight
  // is fine and reads as "the next floor is different."
  const glow = new THREE.PointLight(0x88aaff, 0.6, 2.5, 1.8);
  glow.position.set(0, -totalDrop + 0.2, totalDepth - 0.4);
  group.add(glow);

  const interactable = {
    id: generateEntityId(`stairs-${spec.id ?? spec.targetLevel}`),
    // World-space center of the top tread.
    position: new THREE.Vector3(spec.x, 0, spec.z).add(
      new THREE.Vector3(0, 0, STEP_DEPTH / 2).applyEuler(new THREE.Euler(0, spec.rotY ?? 0, 0)),
    ),
    radius: 1.6,
    promptLabel: 'DESCEND',
    onUse() {
      // Lock so multi-tap doesn't trigger N loads.
      if (interactable.promptLabel === '') return;
      interactable.promptLabel = '';
      onDescend(spec.targetLevel);
    },
    destroyed: false,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
  };
  registerInteractable(interactable);
}
