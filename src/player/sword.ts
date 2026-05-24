import * as THREE from 'three';
import { CONFIG } from '../config';

// First-person held sword. Built from primitives, parented to the camera so it
// renders in screen-relative space (always at the bottom-right of view).
//
// Three-phase swing animation on attack:
//   1. windup  — sword raises above frame
//   2. strike  — chops down through the center of view (HIT WINDOW is here)
//   3. recover — returns to idle; input is locked
//
// Materials have fog disabled so the sword stays crisp even in the dense fog
// (otherwise it'd fade into the void at the camera near-plane distance).

export interface Sword {
  group: THREE.Group;
  /** True only during the strike phase of the current swing — use to gate raycasts. */
  isStriking: boolean;
  /** True from windup-start through recover-end — use to gate new attack inputs. */
  isSwinging: boolean;
  /** Trigger a new swing if not already swinging. Returns whether it started one. */
  startSwing(): boolean;
  update(dt: number): void;
}

export function createSword(camera: THREE.Camera): Sword {
  const group = new THREE.Group();

  // Materials — fog disabled so the sword stays visible against dark fog.
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x9a978f,
    roughness: 0.4,
    metalness: 0.85,
    fog: false,
  });
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0x3a2f22,
    roughness: 0.7,
    metalness: 0.6,
    fog: false,
  });
  const hiltMat = new THREE.MeshStandardMaterial({
    color: 0x1a1410,
    roughness: 0.9,
    metalness: 0.1,
    fog: false,
  });
  const pommelMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a26,
    roughness: 0.6,
    metalness: 0.7,
    fog: false,
  });

  // Blade — flat box, long and narrow
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.01), bladeMat);
  blade.position.y = 0.35;
  group.add(blade);

  // Cross-guard — short horizontal box
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.04), guardMat);
  guard.position.y = 0.04;
  group.add(guard);

  // Hilt grip — vertical cylinder
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), hiltMat);
  hilt.position.y = -0.04;
  group.add(hilt);

  // Pommel — small sphere at the bottom
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), pommelMat);
  pommel.position.y = -0.12;
  group.add(pommel);

  const [ix, iy, iz] = CONFIG.SWORD_IDLE_POS;
  const [rx, ry, rz] = CONFIG.SWORD_IDLE_ROT;

  group.position.set(ix, iy, iz);
  group.rotation.set(rx, ry, rz);

  // Parent the sword to the camera so it follows view automatically.
  // (The camera must be added to the scene for child meshes to render.)
  camera.add(group);

  // --- Swing state machine ---
  let phase: 'idle' | 'windup' | 'strike' | 'recover' = 'idle';
  let phaseTimer = 0;

  function startSwing(): boolean {
    if (phase !== 'idle') return false;
    phase = 'windup';
    phaseTimer = 0;
    return true;
  }

  function update(dt: number) {
    if (phase === 'idle') {
      group.position.set(ix, iy, iz);
      group.rotation.set(rx, ry, rz);
      return;
    }

    phaseTimer += dt;

    if (phase === 'windup') {
      const t = Math.min(1, phaseTimer / CONFIG.SWORD_SWING_WINDUP);
      // Raise sword: pull back and up
      group.position.set(ix, iy + 0.15 * t, iz + 0.05 * t);
      group.rotation.set(rx - 0.9 * t, ry, rz);
      if (phaseTimer >= CONFIG.SWORD_SWING_WINDUP) {
        phase = 'strike';
        phaseTimer = 0;
      }
      return;
    }

    if (phase === 'strike') {
      const t = Math.min(1, phaseTimer / CONFIG.SWORD_SWING_STRIKE);
      // Chop down: sword arcs forward and down
      const ease = 1 - (1 - t) * (1 - t); // ease-out quad
      group.position.set(ix - 0.15 * ease, iy + 0.15 - 0.4 * ease, iz - 0.1 * ease);
      group.rotation.set(rx - 0.9 + 1.6 * ease, ry, rz + 0.3 * ease);
      if (phaseTimer >= CONFIG.SWORD_SWING_STRIKE) {
        phase = 'recover';
        phaseTimer = 0;
      }
      return;
    }

    if (phase === 'recover') {
      const t = Math.min(1, phaseTimer / CONFIG.SWORD_SWING_RECOVER);
      // Lerp back to idle position
      const e = 1 - (1 - t) * (1 - t);
      const fromPos = new THREE.Vector3(ix - 0.15, iy - 0.25, iz - 0.1);
      const toPos = new THREE.Vector3(ix, iy, iz);
      group.position.lerpVectors(fromPos, toPos, e);
      group.rotation.set(
        THREE.MathUtils.lerp(rx + 0.7, rx, e),
        ry,
        THREE.MathUtils.lerp(rz + 0.3, rz, e),
      );
      if (phaseTimer >= CONFIG.SWORD_SWING_RECOVER) {
        phase = 'idle';
        phaseTimer = 0;
      }
    }
  }

  return {
    group,
    get isStriking() {
      return phase === 'strike';
    },
    get isSwinging() {
      return phase !== 'idle';
    },
    startSwing,
    update,
  };
}
