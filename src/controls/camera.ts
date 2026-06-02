import * as THREE from 'three';
import { CONFIG } from '../config';
import type { InputState } from './input';
import { consumeKnockback } from '../player/knockback';
import type { WalkableRegion } from '../level/walkable';
import type { Enemy } from '../mobs/enemy';
import { getSettings } from '../settings/settings';
import { playFootstep } from '../audio/sfx';

// Simple first-person camera with yaw/pitch and walking movement.
// Movement is constrained by a WalkableRegion (rooms + corridors minus
// obstacles) AND by live enemies (the player can't walk through them).
// Both are supplied each frame so the level + mob systems own the
// authoritative collision data.

const PLAYER_RADIUS = 0.3;
// Distance between footsteps in meters. Tuned so a normal walking pace
// hits ~1.5 steps/sec at MOVE_SPEED (feels right at the listening ear).
const STEP_DISTANCE = 1.05;

let yaw = 0;
let pitch = 0;
let distanceSinceStep = 0;

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

/** Direct pitch setter — used by dev-snapshot restore so the camera
 *  resumes at the same up/down angle after a hot reload. The input
 *  drag system reads from this module-level `pitch` each frame, so
 *  setting camera.rotation.x alone wouldn't stick. */
export function setCameraPitch(p: number) {
  pitch = p;
}

export function updateCamera(
  camera: THREE.PerspectiveCamera,
  input: InputState,
  dt: number,
  walkable: WalkableRegion,
  enemies: readonly Enemy[],
) {
  // --- Look ---
  const sensitivity = getSettings().lookSensitivity;
  yaw -= input.lookDx * sensitivity;
  pitch -= input.lookDy * sensitivity;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));

  input.lookDx = 0;
  input.lookDy = 0;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // --- Knockback impulse (consumed BEFORE input so a hit + immediate
  //     joystick push land in the same frame's clampMove). ---
  const kb = consumeKnockback(dt);
  if (kb.dx !== 0 || kb.dz !== 0) {
    const newX = camera.position.x + kb.dx;
    const newZ = camera.position.z + kb.dz;
    const resolved = walkable.clampMove(
      camera.position.x, camera.position.z,
      newX, newZ,
      PLAYER_RADIUS,
    );
    camera.position.x = resolved.x;
    camera.position.z = resolved.z;
  }

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
      // First pass: static collision (walls, pillars, altar, chest).
      const resolved = walkable.clampMove(
        camera.position.x, camera.position.z,
        newX, newZ,
        PLAYER_RADIUS,
      );
      // Second pass: dynamic collision against live enemies. Same axis-
      // decomposed slide so the player slides around an enemy instead of
      // sticking. Dead enemies have aliveLocal=false and are skipped.
      const finalPos = slideAroundEnemies(
        camera.position.x, camera.position.z,
        resolved.x, resolved.z,
        enemies,
      );
      const stepDx = finalPos.x - camera.position.x;
      const stepDz = finalPos.z - camera.position.z;
      camera.position.x = finalPos.x;
      camera.position.z = finalPos.z;

      // Footstep accumulator — fires once per STEP_DISTANCE actually moved
      // (so colliding with a wall doesn't trigger footsteps in place).
      distanceSinceStep += Math.hypot(stepDx, stepDz);
      if (distanceSinceStep >= STEP_DISTANCE) {
        distanceSinceStep -= STEP_DISTANCE;
        playFootstep();
      }
    }
  }

  // Eye height locked
  camera.position.y = CONFIG.PLAYER_HEIGHT;
}

// Axis-decomposed slide against the set of live enemies. Try the X-only
// move; if it collides with an enemy, revert X. Same for Z. Mirrors
// WalkableRegion.clampMove's slide behavior so the player can walk along
// an enemy's edge instead of sticking.
function slideAroundEnemies(oldX: number, oldZ: number, newX: number, newZ: number, enemies: readonly Enemy[]): { x: number; z: number } {
  let cx = newX;
  let cz = oldZ;
  if (collidesWithEnemy(cx, cz, enemies)) cx = oldX;
  cz = newZ;
  if (collidesWithEnemy(cx, cz, enemies)) cz = oldZ;
  return { x: cx, z: cz };
}

function collidesWithEnemy(x: number, z: number, enemies: readonly Enemy[]): boolean {
  for (const e of enemies) {
    if (!e.alive) continue;
    // Small / swarm mobs (rats, ooze offspring) are explicitly opted
    // out of player-collision so getting bodyblocked by a scurrying
    // critter doesn't kill momentum mid-fight. They still hit you.
    if (e.noPlayerCollision) continue;
    const ex = e.group.position.x;
    const ez = e.group.position.z;
    const minDist = PLAYER_RADIUS + e.collisionRadius;
    const dx = x - ex;
    const dz = z - ez;
    if (dx * dx + dz * dz < minDist * minDist) return true;
  }
  return false;
}
