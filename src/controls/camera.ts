import * as THREE from 'three';
import { CONFIG } from '../config';
import type { InputState } from './input';
import type { WalkableRegion } from '../level/walkable';

// Simple first-person camera with yaw/pitch and walking movement.
// Movement is constrained by a WalkableRegion (rooms + corridors minus
// obstacle circles), supplied each frame so the level system owns the
// authoritative collision data.

const PLAYER_RADIUS = 0.3;

let yaw = 0;
let pitch = 0;

export function createFirstPersonCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(
    CONFIG.FOV,
    window.innerWidth / window.innerHeight,
    0.05,
    50,
  );
}

export function setCameraYaw(y: number) {
  yaw = y;
}

export function updateCamera(
  camera: THREE.PerspectiveCamera,
  input: InputState,
  dt: number,
  walkable: WalkableRegion,
) {
  // --- Look ---
  yaw -= input.lookDx * CONFIG.LOOK_SENSITIVITY;
  pitch -= input.lookDy * CONFIG.LOOK_SENSITIVITY;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));

  input.lookDx = 0;
  input.lookDy = 0;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // --- Move ---
  if (input.moveX !== 0 || input.moveY !== 0) {
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));

    const move = new THREE.Vector3()
      .addScaledVector(forward, -input.moveY)
      .addScaledVector(right, input.moveX);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(CONFIG.MOVE_SPEED * dt);
      const newX = camera.position.x + move.x;
      const newZ = camera.position.z + move.z;
      const resolved = walkable.clampMove(
        camera.position.x, camera.position.z,
        newX, newZ,
        PLAYER_RADIUS,
      );
      camera.position.x = resolved.x;
      camera.position.z = resolved.z;
    }
  }

  // Eye height locked
  camera.position.y = CONFIG.PLAYER_HEIGHT;
}
