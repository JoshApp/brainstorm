import * as THREE from 'three';
import { CONFIG } from '../config';
import { getArrivalHeightOffset, isArrivalActive } from '../player/arrival';
import { getWindedMoveMul, isDashingOver, resolveDashOverLanding } from '../combat/dash';
import { tryVaultStep, isVaulting, vaultPosition, vaultHeightOffset } from '../player/vault-step';
import { groundYAt } from '../level/elevation';
import type { InputState } from './input';
import { consumeKnockback } from '../player/knockback';
import { getPlayerMoveScale } from '../player/inside-aura';
import { getMoveMul, getTurnMul } from '../combat/swing-agency';
import { getPlayerMoveSpeedMult } from '../combat/modifiers';
import { getDrinkMoveMul } from '../player/flask-drink';
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

// Per-frame scratch (updateCamera runs every frame — no allocations here).
// CLAMP_SCRATCH holds a clampMoveInto result; SLIDE_SCRATCH the enemy-slide
// result. Separate because the slide reads the clamp's output.
const CLAMP_SCRATCH = { x: 0, z: 0 };
const SLIDE_SCRATCH = { x: 0, z: 0 };

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
export function getCameraPitch(): number { return pitch; }
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
    // A validated dash-over vaults DASHABLE obstacles (fallen pillars / 1-wide
    // gaps) — the knockback IS the dash, so ignore them here while it's active.
    const resolved = walkable.clampMoveInto(
      CLAMP_SCRATCH,
      camera.position.x, camera.position.z,
      newX, newZ,
      PLAYER_RADIUS,
      { ignoreDashable: isDashingOver() },
    );
    camera.position.x = resolved.x;
    camera.position.z = resolved.z;
  }

  // --- Move ---
  if ((input.moveX !== 0 || input.moveY !== 0) && !isArrivalActive()) {
    // 2D move basis straight from yaw — forward is (0,0,-1) and right is
    // (1,0,0) rotated about Y; y stays 0 throughout, so no Vector3/Euler
    // objects (this runs every moving frame).
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    let moveX = sinY * input.moveY + cosY * input.moveX;
    let moveZ = cosY * input.moveY - sinY * input.moveX;
    const lenSq = moveX * moveX + moveZ * moveZ;

    if (lenSq > 0) {
      // Aura-driven slow (e.g. inside the boiling king's body) × attack
      // commitment (mid-swing you root/slow, weight-scaled; idle = 1.0) ×
      // BUILD move-speed (swift vestments / relics / cards / haste buffs). All
      // multiplicative so they compose uniformly on MOVE_SPEED.
      const speed = CONFIG.MOVE_SPEED * getPlayerMoveScale() * getMoveMul() * getWindedMoveMul() * getDrinkMoveMul() * getPlayerMoveSpeedMult() * dt;
      const scale = speed / Math.sqrt(lenSq);
      moveX *= scale;
      moveZ *= scale;
      const newX = camera.position.x + moveX;
      const newZ = camera.position.z + moveZ;
      // First pass: static collision (walls, pillars, altar, chest). A validated
      // dash-over also lets joystick movement clear dashable obstacles this roll.
      const resolved = walkable.clampMoveInto(
        CLAMP_SCRATCH,
        camera.position.x, camera.position.z,
        newX, newZ,
        PLAYER_RADIUS,
        { ignoreDashable: isDashingOver() },
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

      // THE VAULT STEP (player/vault-step.ts). The honest trigger is a walk
      // that got BLOCKED: the player pushed into something and the world said
      // no. If the thing in the way is one the DODGE could clear, and there's
      // floor beyond it, step over instead of standing there. Never in combat,
      // never mid-dodge — the dodge always wins.
      const wantedDist = Math.hypot(moveX, moveZ);
      const gotDist = Math.hypot(stepDx, stepDz);
      // 0.65, not 0.4: colliding with an obstacle SLIDES you along it, so a
      // player walking into a fallen column at any angle still covers real
      // ground. Only a head-on stop registers under 0.4, which is the one
      // approach angle a player is least likely to have.
      if (!isVaulting() && wantedDist > 1e-4 && gotDist < wantedDist * 0.65) {
        tryVaultStep(
          camera.position.x, camera.position.z,
          moveX, moveZ, PLAYER_RADIUS, walkable,
        );
      }

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
      const out = walkable.clampMoveInto(
        CLAMP_SCRATCH,
        camera.position.x, camera.position.z,
        camera.position.x + pushX, camera.position.z + pushZ,
        PLAYER_RADIUS,
      );
      camera.position.x = out.x;
      camera.position.z = out.z;
    }
  }

  // --- The vault step carries the player ---
  // A vault owns position for its short duration: it's a committed stride over
  // something, so the arc must not be fought by the joystick mid-flight.
  {
    const vp = vaultPosition();
    if (vp) { camera.position.x = vp.x; camera.position.z = vp.z; }
  }

  // --- Dash-over undershoot rescue ---
  // A validated vault normally overshoots the 1m obstacle, but a no-input dash
  // can die inside it. Once the vault window closes, if we're still standing in
  // the dashable obstacle, complete the vault forward onto the floor we were
  // cleared to land on — bounded, never a teleport, no-op in the common case.
  {
    const land = resolveDashOverLanding(camera.position.x, camera.position.z, PLAYER_RADIUS, walkable);
    if (land) { camera.position.x = land.x; camera.position.z = land.z; }
  }

  // Eye height locked above the GROUND at our feet (plus the floor-arrival
  // rise from the bonfire seat). groundYAt is 0 on flat floors; on floors
  // with elevation it follows room plateaus + corridor ramps, so walking a
  // sloped corridor raises/lowers the eye continuously.
  camera.position.y = CONFIG.PLAYER_HEIGHT
    + groundYAt(camera.position.x, camera.position.z)
    + getArrivalHeightOffset()
    + vaultHeightOffset();   // the arc over a knee-high obstacle

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
  SLIDE_SCRATCH.x = cx;
  SLIDE_SCRATCH.z = cz;
  return SLIDE_SCRATCH;   // per-frame scratch — consumed immediately by the caller
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
