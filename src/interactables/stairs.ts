import * as THREE from 'three';
import type { StairsSpec } from '../level/types';
import type { StyleMaterials } from '../style/materials';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { registerLight } from '../scene/light-pool';
import { getTexture } from '../style/procedural-textures';

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

  // Cool glow at the bottom — implies something is down there + reads
  // as "the next floor is different." Bright enough to be the destination
  // anchor visible from across the room, so the player sees the stairs
  // call even when standing in a dark corner. Registers with the light
  // pool — Three.js only ever sees N total slot lights, so the stairs
  // glow's cost is fully amortized.
  const glowLocal = new THREE.Vector3(0, -totalDrop + 0.4, totalDepth - 0.4);
  const glowWorld = new THREE.Vector3()
    .copy(glowLocal)
    .applyEuler(new THREE.Euler(0, spec.rotY ?? 0, 0))
    .add(new THREE.Vector3(spec.x, 0, spec.z));
  registerLight({
    id: `stairs-${spec.id ?? spec.targetLevel}-glow`,
    category: 'environment',
    position: glowWorld,
    color: 0x88aaff,
    intensity: 4.5,
    distance: 5.5,
    decay: 1.6,
  });

  // ── MOONBEAM ──────────────────────────────────────────────────────
  // The stairwell is read at-a-distance via a SHAFT of pale light
  // rising from the mouth, not a flat blue rectangle. Three additive
  // layers stack into a moonbeam:
  //   1. Floor halo — soft radial pool at the top tread (fire-wisp
  //      texture gives the gradient, so it's a circle not a square).
  //   2. Outer column — wide, dim, slow-falloff sprite (the haze).
  //   3. Inner core — narrow, bright sprite up the centre (the shaft).
  // Together they read as god-ray pouring out of the floor.

  // 1. Floor halo — soft radial alpha via fire-wisp.
  const haloMat = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'),
    color: 0x6688cc,
    transparent: true,
    opacity: 0.7,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(0, 0.02, STEP_DEPTH * 0.5);
  group.add(halo);

  // 2. Outer haze column — tall + wide, sets the silhouette of the
  // beam visible from across the room.
  const outerBeamMat = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'),
    color: 0x88a8e8,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  });
  const outerBeam = new THREE.Sprite(outerBeamMat);
  outerBeam.scale.set(1.8, 3.6, 1);
  outerBeam.position.set(0, 1.6, STEP_DEPTH * 0.5);
  group.add(outerBeam);

  // 3. Inner core — narrow, brighter, slightly cooler-white to read
  // as the "bright centre" of the moonbeam.
  const coreBeamMat = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'),
    color: 0xd8e4ff,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  });
  const coreBeam = new THREE.Sprite(coreBeamMat);
  coreBeam.scale.set(0.55, 3.3, 1);
  coreBeam.position.set(0, 1.5, STEP_DEPTH * 0.5);
  group.add(coreBeam);

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
