import * as THREE from 'three';
import { CONFIG } from '../config';
import { getArrivalHeightOffset, isArrivalActive } from '../player/arrival';
import { getWindedMoveMul } from '../combat/dash';
import { groundYAt } from '../level/elevation';
import type { InputState } from './input';
import { consumeKnockback } from '../player/knockback';
import { getPlayerMoveScale } from '../player/inside-aura';
import { getMoveMul, getTurnMul } from '../combat/swing-agency';
import { getExhaustionHeave } from '../combat/exhaustion-feedback';
import { getStumbleOffset } from '../combat/camera-stumble';
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
    CONFIG.CAMERA_FAR,
  );
}

export function setCameraYaw(y: number) {
  yaw = y;
}

// Last-known camera yaw + ground position, stashed each updateCamera tick so
// non-camera systems (e.g. the directional damage indicator) can place a hit
// relative to where the player is looking without threading the camera object
// through the event bus.
let camGroundX = 0;
let camGroundZ = 0;
export function getCameraYaw(): number { return yaw; }
export function getCameraGroundPos(): { x: number; z: number } { return { x: camGroundX, z: camGroundZ }; }

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
  // Stash for off-camera consumers (directional damage indicator).
  camGroundX = camera.position.x;
  camGroundZ = camera.position.z;
  // --- Look ---
  // Turn rate is scaled by attack commitment — mid-swing you can't whip-aim
  // (weight-scaled; idle = 1.0). This clamps the camera AND, since the swing
  // cone reads camera-forward, how much you can adjust where the hit lands.
  const sensitivity = getSettings().lookSensitivity * getTurnMul();
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
  if ((input.moveX !== 0 || input.moveY !== 0) && !isArrivalActive()) {
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));

    const move = new THREE.Vector3()
      .addScaledVector(forward, -input.moveY)
      .addScaledVector(right, input.moveX);

    if (move.lengthSq() > 0) {
      // Aura-driven slow (e.g. inside the boiling king's body) × attack
      // commitment (mid-swing you root/slow, weight-scaled; idle = 1.0). Both
      // multiplicative so they compose uniformly on MOVE_SPEED.
      move.normalize().multiplyScalar(CONFIG.MOVE_SPEED * getPlayerMoveScale() * getMoveMul() * getWindedMoveMul() * dt);
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

  // --- Depenetration ---
  // The slide passes above only PREVENT entering an enemy; once we're already
  // INSIDE one (we dashed into it, it dashed/leapt onto us, or a mimic spawned
  // on top of us) every exit direction also reads as "inside", so the slide
  // wedges us stuck. This pushes the player back OUT along the overlap normal
  // each frame until clear — the one thing the prevent-only model can't do.
  // Runs unconditionally (even with no input) so an enemy landing on a still
  // player still ejects us. Clamped against walls so we never push into stone.
  {
    let pushX = 0, pushZ = 0;
    for (const e of enemies) {
      if (!e.alive || e.noPlayerCollision) continue;
      const dx = camera.position.x - e.group.position.x;
      const dz = camera.position.z - e.group.position.z;
      const minDist = PLAYER_RADIUS + e.collisionRadius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;             // not overlapping
      if (d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const overlap = minDist - d + 0.02;              // + small margin so we clear
        pushX += (dx / d) * overlap;
        pushZ += (dz / d) * overlap;
      } else {
        // Concentric (e.g. spawned dead-on) — no normal to push along, so pick
        // a stable direction off the look yaw to break the tie.
        pushX += Math.sin(yaw) * minDist;
        pushZ += Math.cos(yaw) * minDist;
      }
    }
    if (pushX !== 0 || pushZ !== 0) {
      const out = walkable.clampMove(
        camera.position.x, camera.position.z,
        camera.position.x + pushX, camera.position.z + pushZ,
        PLAYER_RADIUS,
      );
      camera.position.x = out.x;
      camera.position.z = out.z;
    }
  }

  // Eye height locked above the GROUND at our feet (plus the floor-arrival
  // rise from the bonfire seat). groundYAt is 0 on flat floors; on floors
  // with elevation it follows room plateaus + corridor ramps, so walking a
  // sloped corridor raises/lowers the eye continuously.
  camera.position.y = CONFIG.PLAYER_HEIGHT
    + groundYAt(camera.position.x, camera.position.z)
    + getArrivalHeightOffset();

  // Exhaustion chest-heave — a subtle breath-driven bob + pitch when winded, so
  // "out of breath" is FELT in the view, not read off a bar. 0 when rested; the
  // sine is shared with the breathing audio so the heave and the puff agree.
  const heave = getExhaustionHeave();
  // Stumble lurch — a one-off roll/pitch/drop on an empty-bar dodge (off-balance).
  const st = getStumbleOffset();
  camera.position.y += heave * CONFIG.EXHAUSTION.HEAVE_Y + st.dip;
  camera.rotation.x += heave * CONFIG.EXHAUSTION.HEAVE_PITCH + st.pitch;
  camera.rotation.z = st.roll;   // roll is otherwise unused — set, don't accumulate
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
