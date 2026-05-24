import * as THREE from 'three';
import { CONFIG } from '../config';
import type { InputState } from './input';

// Simple first-person camera with yaw/pitch and walking movement.
// Movement is in the camera's horizontal facing direction.
// Collision is *not* implemented — Phase 1 has a single open room.
// Add collision when we get to Phase 3 (multiple rooms with walls/doors).

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

export function updateCamera(camera: THREE.PerspectiveCamera, input: InputState, dt: number) {
  // --- Look ---
  yaw -= input.lookDx * CONFIG.LOOK_SENSITIVITY;
  pitch -= input.lookDy * CONFIG.LOOK_SENSITIVITY;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));

  input.lookDx = 0;
  input.lookDy = 0;

  // Apply rotation via Euler (YXZ order: yaw, then pitch)
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // --- Move ---
  // Project input direction onto camera's horizontal plane.
  if (input.moveX !== 0 || input.moveY !== 0) {
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));

    const move = new THREE.Vector3()
      .addScaledVector(forward, -input.moveY) // joystick up = forward
      .addScaledVector(right, input.moveX);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(CONFIG.MOVE_SPEED * dt);
      camera.position.add(move);

      // Clamp to room bounds (Phase 1 hack until proper collision)
      const half = CONFIG.ROOM_WIDTH / 2 - 0.4;
      const halfD = CONFIG.ROOM_DEPTH / 2 - 0.4;
      camera.position.x = Math.max(-half, Math.min(half, camera.position.x));
      camera.position.z = Math.max(-halfD, Math.min(halfD, camera.position.z));
    }
  }

  // Eye height locked
  camera.position.y = CONFIG.PLAYER_HEIGHT;
}
