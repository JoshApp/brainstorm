import { CONFIG } from '../config';
import type { PoseKey } from '../content/weapon-classes';
import type { SwordPhase } from './sword';

// Per-step viewmodel pose curves. Each function takes the current
// phase + a normalised phase progress (0..1) and returns the local
// pose to apply on top of the idle rest pose.
//
// Pose units:
//   pos       metres, camera-local. +X right, +Y up, -Z forward.
//   rot       radians, applied in camera-local Euler.
//
// All weapons share the SAME idle pose (CONFIG.SWORD_IDLE_POS /
// _ROT) so weapon swaps don't snap-rotate the held item. The walking
// bob (getSwordOffset in sword.ts) layers on top of idle as before.
//
// The caller (sword.ts) picks the pose KEY from the current combo
// step on the resolved weapon stats — pose key → curve here.

export interface WeaponPose {
  x: number; y: number; z: number;
  rotX: number; rotY: number; rotZ: number;
}

const ix = CONFIG.SWORD_IDLE_POS[0];
const iy = CONFIG.SWORD_IDLE_POS[1];
const iz = CONFIG.SWORD_IDLE_POS[2];
const rx = CONFIG.SWORD_IDLE_ROT[0];
const ry = CONFIG.SWORD_IDLE_ROT[1];
const rz = CONFIG.SWORD_IDLE_ROT[2];

const scratch: WeaponPose = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };

/** Pose for the current swing phase. Caller passes the pose key for
 *  the current combo step + the phase + the PROGRESS within that
 *  phase (0..1). Returns a shared scratch object — read it, don't
 *  retain. */
export function computeWeaponPose(pose: PoseKey, phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'idle') {
    // Idle = rest pose. The bob system already mutates X/Y/rotZ on
    // top of these values, so we just return the baseline.
    scratch.x = ix; scratch.y = iy; scratch.z = iz;
    scratch.rotX = rx; scratch.rotY = ry; scratch.rotZ = rz;
    return scratch;
  }
  switch (pose) {
    case 'dagger-stab':        return daggerStabPose(phase, t);
    case 'dagger-slash':       return daggerSlashPose(phase, t);
    case 'dagger-double-stab': return daggerDoubleStabPose(phase, t);
    case 'hammer-smash':       return hammerPose(phase, t);
    case 'sword-slash':
    default:                   return swordPose(phase, t);
  }
}

// ── Sword (existing diagonal slash) ───────────────────────────────
// The arc the rusted shortsword + scimitar + heartburn already use.
// Lifted out of sword.ts so the state machine can call it through
// the unified entrypoint above.
function swordPose(phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    // Pull up + back, pitch back.
    scratch.x = ix;
    scratch.y = iy + 0.15 * t;
    scratch.z = iz + 0.05 * t;
    scratch.rotX = rx - 0.9 * t;
    scratch.rotY = ry;
    scratch.rotZ = rz;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);   // ease-out quad
    scratch.x = ix - 0.15 * ease;
    scratch.y = iy + 0.15 - 0.4 * ease;
    scratch.z = iz - 0.1 * ease;
    scratch.rotX = rx - 0.9 + 1.6 * ease;
    scratch.rotY = ry;
    scratch.rotZ = rz + 0.3 * ease;
    return scratch;
  }
  // recover — lerp from end-of-strike back to idle.
  const e = 1 - (1 - t) * (1 - t);
  const fromX = ix - 0.15, fromY = iy - 0.25, fromZ = iz - 0.1;
  scratch.x = fromX + (ix - fromX) * e;
  scratch.y = fromY + (iy - fromY) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = (rx + 0.7) + (rx - (rx + 0.7)) * e;
  scratch.rotY = ry;
  scratch.rotZ = (rz + 0.3) + (rz - (rz + 0.3)) * e;
  return scratch;
}

// ── Dagger combo: stab → slash → stab-stab ───────────────────────
// Step 0: single forward thrust — quick, clean. Step 1: lateral cut
// across the view. Step 2: two-pulse "stab stab" finisher.
// All three share the same wound-up centre-line tilt so the combo
// reads as one continuous routine, not three unrelated swings.

// Shared stab-pose orientation: blade tip aimed at camera-forward.
// Dagger model has tip at +Y, so we rotate ~−π/2 around X to swing
// the tip toward camera-forward (−Z). The idle yaw/roll get cancelled
// out so the blade lines up with the crosshair instead of cutting
// across the body.
const DAGGER_STAB_RX = rx - 1.30;   // -0.2 - 1.30 = -1.50 → tip forward
const DAGGER_STAB_RY = ry + 0.15;   // cancel idle yaw  → ≈ 0
const DAGGER_STAB_RZ = rz - 0.40;   // cancel idle roll → ≈ 0

// Wound-up translation, shared by stab and double-stab.
const DAGGER_WOUND_X = ix - 0.06;   // pulled toward centre line
const DAGGER_WOUND_Y = iy + 0.05;   // up to eye-line
const DAGGER_WOUND_Z = iz + 0.10;   // drawn back toward camera

function daggerStabPose(phase: SwordPhase, t: number): WeaponPose {
  // Single forward thrust. Same wound-up pose as the finisher; just
  // one sine-pulse instead of two. Reads as the opener.
  const STAB_DEPTH = 0.32;
  if (phase === 'windup') {
    scratch.x = ix + (DAGGER_WOUND_X - ix) * t;
    scratch.y = iy + (DAGGER_WOUND_Y - iy) * t;
    scratch.z = iz + (DAGGER_WOUND_Z - iz) * t;
    scratch.rotX = rx + (DAGGER_STAB_RX - rx) * t;
    scratch.rotY = ry + (DAGGER_STAB_RY - ry) * t;
    scratch.rotZ = rz + (DAGGER_STAB_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Ease-out push forward. Holds at full extension at end of strike
    // so the blade visually peaks in the enemy.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = DAGGER_WOUND_X;
    scratch.y = DAGGER_WOUND_Y;
    scratch.z = DAGGER_WOUND_Z + (-STAB_DEPTH) * ease;
    scratch.rotX = DAGGER_STAB_RX;
    scratch.rotY = DAGGER_STAB_RY;
    scratch.rotZ = DAGGER_STAB_RZ;
    return scratch;
  }
  // recover — strike ends at full extension; lerp back to idle.
  const e = 1 - (1 - t) * (1 - t);
  const fromZ = DAGGER_WOUND_Z - STAB_DEPTH;
  scratch.x = DAGGER_WOUND_X + (ix - DAGGER_WOUND_X) * e;
  scratch.y = DAGGER_WOUND_Y + (iy - DAGGER_WOUND_Y) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = DAGGER_STAB_RX + (rx - DAGGER_STAB_RX) * e;
  scratch.rotY = DAGGER_STAB_RY + (ry - DAGGER_STAB_RY) * e;
  scratch.rotZ = DAGGER_STAB_RZ + (rz - DAGGER_STAB_RZ) * e;
  return scratch;
}

function daggerSlashPose(phase: SwordPhase, t: number): WeaponPose {
  // Lateral cut: pull the blade across to the LEFT in windup, then
  // sweep right across the view. Different rotation profile from the
  // stab — tip pitches less forward, more SIDEWAYS so the edge leads
  // the sweep instead of the point.
  const WOUND_X = ix - 0.22;          // pulled across to the left
  const WOUND_Y = iy + 0.06;
  const WOUND_Z = iz + 0.04;
  const WOUND_RX = rx - 0.40;
  const WOUND_RY = ry + 0.50;          // yaw tip rightward
  const WOUND_RZ = rz - 0.30;          // cancel idle diagonal roll
  const STRIKE_X = ix + 0.22;          // sweep through to the right
  const STRIKE_Y = iy + 0.02;
  const STRIKE_Z = iz - 0.06;
  const STRIKE_RX = rx - 0.20;
  const STRIKE_RY = ry - 0.50;
  const STRIKE_RZ = rz + 0.10;
  if (phase === 'windup') {
    scratch.x = ix + (WOUND_X - ix) * t;
    scratch.y = iy + (WOUND_Y - iy) * t;
    scratch.z = iz + (WOUND_Z - iz) * t;
    scratch.rotX = rx + (WOUND_RX - rx) * t;
    scratch.rotY = ry + (WOUND_RY - ry) * t;
    scratch.rotZ = rz + (WOUND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WOUND_X + (STRIKE_X - WOUND_X) * ease;
    scratch.y = WOUND_Y + (STRIKE_Y - WOUND_Y) * ease;
    scratch.z = WOUND_Z + (STRIKE_Z - WOUND_Z) * ease;
    scratch.rotX = WOUND_RX + (STRIKE_RX - WOUND_RX) * ease;
    scratch.rotY = WOUND_RY + (STRIKE_RY - WOUND_RY) * ease;
    scratch.rotZ = WOUND_RZ + (STRIKE_RZ - WOUND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = STRIKE_X + (ix - STRIKE_X) * e;
  scratch.y = STRIKE_Y + (iy - STRIKE_Y) * e;
  scratch.z = STRIKE_Z + (iz - STRIKE_Z) * e;
  scratch.rotX = STRIKE_RX + (rx - STRIKE_RX) * e;
  scratch.rotY = STRIKE_RY + (ry - STRIKE_RY) * e;
  scratch.rotZ = STRIKE_RZ + (rz - STRIKE_RZ) * e;
  return scratch;
}

// Per-stab forward push in metres along camera-local −Z for the
// double-stab finisher. Second stab goes deeper so the rhythm reads
// as "jab… JAB".
const STAB1_DEPTH = 0.30;
const STAB2_DEPTH = 0.42;

function daggerDoubleStabPose(phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    // Lerp idle → wound-up in one shot. Quick draw, no flourish.
    scratch.x = ix + (DAGGER_WOUND_X - ix) * t;
    scratch.y = iy + (DAGGER_WOUND_Y - iy) * t;
    scratch.z = iz + (DAGGER_WOUND_Z - iz) * t;
    scratch.rotX = rx + (DAGGER_STAB_RX - rx) * t;
    scratch.rotY = ry + (DAGGER_STAB_RY - ry) * t;
    scratch.rotZ = rz + (DAGGER_STAB_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Two sine pulses end-to-end. Each pulse: 0 → peak → 0 along the
    // forward axis. Blade rotation stays locked at the stab pose so
    // the tip leads each thrust cleanly.
    let fwd = 0;
    if (t < 0.5) {
      const u = t / 0.5;                       // 0..1 inside stab 1
      fwd = STAB1_DEPTH * Math.sin(Math.PI * u);
    } else {
      const u = (t - 0.5) / 0.5;               // 0..1 inside stab 2
      fwd = STAB2_DEPTH * Math.sin(Math.PI * u);
    }
    // Tiny inward sway scaled to the current thrust depth so the
    // blade tracks slightly toward centre as it extends.
    const swayScale = fwd / STAB2_DEPTH;
    scratch.x = DAGGER_WOUND_X + (-0.03) * swayScale;
    scratch.y = DAGGER_WOUND_Y + (-0.02) * swayScale;
    scratch.z = DAGGER_WOUND_Z + (-fwd);
    scratch.rotX = DAGGER_STAB_RX;
    scratch.rotY = DAGGER_STAB_RY;
    scratch.rotZ = DAGGER_STAB_RZ;
    return scratch;
  }
  // recover — strike ends back at the wound-up pose (sin(π)=0), so
  // we lerp from THAT back to idle in one ease.
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = DAGGER_WOUND_X + (ix - DAGGER_WOUND_X) * e;
  scratch.y = DAGGER_WOUND_Y + (iy - DAGGER_WOUND_Y) * e;
  scratch.z = DAGGER_WOUND_Z + (iz - DAGGER_WOUND_Z) * e;
  scratch.rotX = DAGGER_STAB_RX + (rx - DAGGER_STAB_RX) * e;
  scratch.rotY = DAGGER_STAB_RY + (ry - DAGGER_STAB_RY) * e;
  scratch.rotZ = DAGGER_STAB_RZ + (rz - DAGGER_STAB_RZ) * e;
  return scratch;
}

// ── Hammer (overhead smash) ───────────────────────────────────────
// Big wind-up: viewmodel rises high above the camera, the HEAD
// pitches back over the shoulder. Strike sweeps the head forward
// and down through the centre line — gravity-driven. Slow recovery
// so missing is genuinely punishing.
//
// Iron-maul model has the head at +Y (up). To swing the head BACK
// during windup we rotate POSITIVELY around X (head moves +Y → +Z,
// i.e. up-and-back). The strike then rotates NEGATIVELY through the
// arc so the head crashes from over-the-shoulder, through overhead,
// down to forward-and-low. The previous version inverted both — the
// head went forward during windup and BACKWARD during strike, so
// players were smashing things with the haft instead of the iron.

// Wound-up pose: hammer raised, head pitched back over the shoulder.
const HAMMER_WOUND_X = ix - 0.10;
const HAMMER_WOUND_Y = iy + 0.55;
const HAMMER_WOUND_Z = iz + 0.08;
const HAMMER_WOUND_RX = rx + 1.40;   // +X rot pulls the +Y head back to +Z
const HAMMER_WOUND_RZ = rz - 0.20;
// Strike-end pose: head down and forward.
const HAMMER_STRIKE_X = ix + 0.00;
const HAMMER_STRIKE_Y = iy - 0.30;
const HAMMER_STRIKE_Z = iz - 0.12;
const HAMMER_STRIKE_RX = rx - 1.10;  // sweep through +π/2 → head ends pointing down/-Z
const HAMMER_STRIKE_RZ = rz + 0.25;

function hammerPose(phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    scratch.x = ix + (HAMMER_WOUND_X - ix) * t;
    scratch.y = iy + (HAMMER_WOUND_Y - iy) * t;
    scratch.z = iz + (HAMMER_WOUND_Z - iz) * t;
    scratch.rotX = rx + (HAMMER_WOUND_RX - rx) * t;
    scratch.rotY = ry;
    scratch.rotZ = rz + (HAMMER_WOUND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Ease-out: head accelerates fast through the arc.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = HAMMER_WOUND_X + (HAMMER_STRIKE_X - HAMMER_WOUND_X) * ease;
    scratch.y = HAMMER_WOUND_Y + (HAMMER_STRIKE_Y - HAMMER_WOUND_Y) * ease;
    scratch.z = HAMMER_WOUND_Z + (HAMMER_STRIKE_Z - HAMMER_WOUND_Z) * ease;
    scratch.rotX = HAMMER_WOUND_RX + (HAMMER_STRIKE_RX - HAMMER_WOUND_RX) * ease;
    scratch.rotY = ry;
    scratch.rotZ = HAMMER_WOUND_RZ + (HAMMER_STRIKE_RZ - HAMMER_WOUND_RZ) * ease;
    return scratch;
  }
  // recover — slow lift back to idle from low-and-forward.
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = HAMMER_STRIKE_X + (ix - HAMMER_STRIKE_X) * e;
  scratch.y = HAMMER_STRIKE_Y + (iy - HAMMER_STRIKE_Y) * e;
  scratch.z = HAMMER_STRIKE_Z + (iz - HAMMER_STRIKE_Z) * e;
  scratch.rotX = HAMMER_STRIKE_RX + (rx - HAMMER_STRIKE_RX) * e;
  scratch.rotY = ry;
  scratch.rotZ = HAMMER_STRIKE_RZ + (rz - HAMMER_STRIKE_RZ) * e;
  return scratch;
}
