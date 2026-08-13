import * as THREE from 'three';
import { CONFIG } from '../config';
import { getArrivalHeightOffset, isArrivalActive } from '../player/arrival';
import { getWindedMoveMul, isDashingOver, resolveDashOverLanding, dashHeightOffset, isLeapingOverBody, pendingLeapLanding, clearBodyLeap } from '../combat/dash';
import { livingBodies, type BodyCircle } from '../player/body-path';
import { isDodging } from '../combat/dash';
import { shatterAlongDodge } from '../combat/dodge-shatter';
import type { Destructible } from '../level/destructibles';
import { isRunHeld } from './run-input';
import { tickMomentum, momentumSpeedMul, momentumFovOffset } from '../player/momentum';
import { setFovOffset, setBaseFov } from '../effects/camera-fov';
import { tryVaultStep, isVaulting, vaultPosition, vaultHeightOffset, tickVaultPresentation } from '../player/vault-step';
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
// The live mobs as blocker discs, for the walk-vault's "is a body in the way"
// probe (player/body-path.ts). Refilled where it's used; ours alone, so the
// dodge's own copy in engine/systems.ts can't overwrite it mid-answer.
const VAULT_BODIES: BodyCircle[] = [];

let yaw = 0;
let pitch = 0;
let distanceSinceStep = 0;

export function createFirstPersonCamera(): THREE.PerspectiveCamera {
  // Declare the resting FOV to the one thing that owns the property, so an
  // effect's offset is always relative to the SETTING rather than to whatever
  // the camera happened to be showing when that effect first ran.
  setBaseFov(CONFIG.FOV);
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
  /** Live breakables, so a ROLL through a shelf of pottery shatters it. Optional
   *  so a caller with none to hand (tests, the title scene) is unchanged. */
  destructibles: readonly Destructible[] = [],
) {
  // Stash for off-camera consumers (directional damage indicator).
  camGroundX = camera.position.x;
  camGroundZ = camera.position.z;
  // Where this frame STARTED, for the dodge's shatter sweep at the end of it —
  // captured before knockback, input, the vault and the leap have all had their
  // turn, so the sweep covers whatever actually moved the player.
  const frameStartX = camera.position.x;
  const frameStartZ = camera.position.z;
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
  // Metres actually travelled this frame, filled in by the move block below and
  // read by the momentum tick after it. Declared out here because a frame with
  // NO input still has to tick momentum — with zero travel, so it decays.
  let movedThisFrame = 0;
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
      // SPRINT rides the same multiplier chain as everything else, so being winded,
      // drinking or slowed still means what it meant — a run does not outrank a
      // penalty, it stacks with one.
      // MOMENTUM, not a sprint flag. Holding the run button no longer hands
      // you a multiplier the instant you press it — it fills momentum faster,
      // and momentum is what you move at (player/momentum.ts). Rides the same
      // multiplicative chain as everything else, so being winded, drinking or
      // slowed still means what it meant: having run does not outrank a
      // penalty, it stacks with one.
      const speed = CONFIG.MOVE_SPEED * momentumSpeedMul() * getPlayerMoveScale() * getMoveMul() * getWindedMoveMul() * getDrinkMoveMul() * getPlayerMoveSpeedMult() * dt;
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
      //
      // A validated LEAP is the one exception: that roll was checked against a
      // body and a landing past it, so being inside the body is the intended
      // mid-air state, and sliding off it would strand the player at the front of
      // the thing they committed to clearing.
      let finalPos: { x: number; z: number };
      if (isLeapingOverBody()) {
        SLIDE_SCRATCH.x = resolved.x; SLIDE_SCRATCH.z = resolved.z;
        finalPos = SLIDE_SCRATCH;
      } else {
        finalPos = slideAroundEnemies(
          camera.position.x, camera.position.z,
          resolved.x, resolved.z,
          enemies,
        );
      }
      const stepDx = finalPos.x - camera.position.x;
      const stepDz = finalPos.z - camera.position.z;

      // THE VAULT STEP (player/vault-step.ts). The honest trigger is a walk
      // that got BLOCKED: the player pushed into something and the world said
      // no. If the thing in the way is one the DODGE could clear, and there's
      // floor beyond it, step over instead of standing there. Never in combat,
      // never mid-dodge — the dodge always wins.
      //
      // A living body blocks a walk exactly the way a fallen pillar does, which
      // is why this trigger used to hand the player a free stroll over an enemy.
      // The mobs go in as blockers so the probe can refuse; a dodge at the same
      // mob leaps it instead, which is where that move belongs.
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
          livingBodies(enemies, VAULT_BODIES),
        );
      }

      camera.position.x = finalPos.x;
      camera.position.z = finalPos.z;

      // MOMENTUM BUILDS FROM GROUND COVERED, not from stick intent — so it is
      // fed here, at the end of the move, with what the collision actually let
      // us have. Grinding along a wall covers little and therefore earns
      // little, which is what makes picking a clean line the skill.
      movedThisFrame = Math.hypot(stepDx, stepDz);

      // Footstep accumulator — fires once per STEP_DISTANCE actually moved
      // (so colliding with a wall doesn't trigger footsteps in place).
      distanceSinceStep += movedThisFrame;
      if (distanceSinceStep >= STEP_DISTANCE) {
        distanceSinceStep -= STEP_DISTANCE;
        playFootstep();
      }
    }
  }

  // --- Momentum ---
  // Unconditional: a frame with no input still ticks, with zero travel, so the
  // number falls. Holding run only makes it FILL faster (see momentum.ts).
  tickMomentum(dt, movedThisFrame, isRunHeld());
  tickVaultPresentation();
  setFovOffset('momentum', momentumFovOffset());

  // --- Depenetration ---
  // The slide passes above only PREVENT entering an enemy; once we're already
  // INSIDE one (we dashed into it, it dashed/leapt onto us, or a mimic spawned
  // on top of us) every exit direction also reads as "inside", so the slide
  // wedges us stuck. This pushes the player back OUT along the overlap normal
  // each frame until clear — the one thing the prevent-only model can't do.
  // Runs unconditionally (even with no input) so an enemy landing on a still
  // player still ejects us. Clamped against walls so we never push into stone.
  //
  // OFF DURING A VALIDATED LEAP. Its whole job is to shove the player out of a
  // body along the shortest normal — which, halfway over a mob you deliberately
  // dodged into, points back the way you came. That is precisely the "you land in
  // them" outcome the leap exists to replace, so a leap suspends it and the
  // completion below finishes the arc instead.
  if (!isLeapingOverBody()) {
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

  // --- Leap completion (over a BODY) ---
  //
  // The stone version above rescues a dash-over that died inside a fallen pillar.
  // This is its twin for flesh, and it is not the edge case — it is the normal
  // one. The lunge is ~1.3m of decaying knockback; a mob a metre away with a
  // half-metre body needs closer to 1.8m, so a leap that isn't finished here
  // simply doesn't clear. The landing was validated as real floor BEFORE the
  // dodge fired, so this is a short correction to a known-good place, clamped
  // against the level on the way — never a teleport, and never through stone.
  //
  // Only when we're actually still in someone: a leap the knockback already
  // carried clean past is done, and dragging it to the nominal landing would
  // undo a better outcome than the one we planned.
  {
    const land = pendingLeapLanding();
    if (land) {
      if (collidesWithEnemy(camera.position.x, camera.position.z, enemies)) {
        const out = walkable.clampMoveInto(
          CLAMP_SCRATCH,
          camera.position.x, camera.position.z,
          land.x, land.z,
          PLAYER_RADIUS,
          { ignoreDashable: true },
        );
        camera.position.x = out.x;
        camera.position.z = out.z;
      }
      clearBodyLeap();
    }
  }

  // --- A roll through pottery breaks it ---
  //
  // Swept over the ground THIS FRAME covered, not sampled at the ends: a dodge
  // crosses ~1.3m in a handful of frames and a point test would roll clean
  // through anything in the middle. Reads the frame's real start and end, so it
  // accounts for the knockback, the joystick and the leap completion alike —
  // whatever actually moved the player is what the sweep sees.
  //
  // Only while dodging: walking past a vase must not break it, or a room of
  // clay is gone before the first fight. See combat/dodge-shatter.ts for why
  // this goes through takeDamage rather than a bespoke destroy.
  if (isDodging() && destructibles.length) {
    shatterAlongDodge(frameStartX, frameStartZ, camera.position.x, camera.position.z, destructibles);
  }

  // Eye height locked above the GROUND at our feet (plus the floor-arrival
  // rise from the bonfire seat). groundYAt is 0 on flat floors; on floors
  // with elevation it follows room plateaus + corridor ramps, so walking a
  // sloped corridor raises/lowers the eye continuously.
  camera.position.y = CONFIG.PLAYER_HEIGHT
    + groundYAt(camera.position.x, camera.position.z)
    + getArrivalHeightOffset()
    + vaultHeightOffset()    // the arc over a knee-high obstacle
    + dashHeightOffset();    // and the same arc when a DODGE is what cleared it

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
