import { CONFIG } from '../config';
import type { WeaponClass } from '../content/items';
import type { SwordPhase } from './sword';

// Per-class viewmodel pose curves. Each function takes the current
// phase + a normalised phase progress (0..1) and returns the local
// pose to apply on top of the idle rest pose.
//
// Pose units:
//   pos       metres, camera-local. +X right, +Y up, -Z forward.
//   rot       radians, applied in camera-local Euler.
//
// All three classes share the SAME idle pose (CONFIG.SWORD_IDLE_POS /
// _ROT) so weapon swaps don't snap-rotate the held item. The walking
// bob (getSwordOffset in sword.ts) layers on top of idle as before.

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

/** Pose for the current swing phase. Caller passes the phase + the
 *  PROGRESS within that phase (0..1). Returns a shared scratch
 *  object — read it, don't retain. */
export function computeWeaponPose(cls: WeaponClass, phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'idle') {
    // Idle = rest pose. The bob system already mutates X/Y/rotZ on
    // top of these values, so we just return the baseline.
    scratch.x = ix; scratch.y = iy; scratch.z = iz;
    scratch.rotX = rx; scratch.rotY = ry; scratch.rotZ = rz;
    return scratch;
  }
  switch (cls) {
    case 'dagger': return daggerPose(phase, t);
    case 'hammer': return hammerPose(phase, t);
    case 'sword':
    default:       return swordPose(phase, t);
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

// ── Dagger (forward stab) ─────────────────────────────────────────
// Minimal shoulder draw, then a fast push of the viewmodel forward
// along the camera's -Z axis. The blade barely rotates — it's a
// thrust, not a swing. Reads as quick + precise.
function daggerPose(phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    // Tiny pull-back: blade slips a hair toward the camera + tilts
    // forward (bringing the tip in line with the camera forward).
    scratch.x = ix - 0.04 * t;
    scratch.y = iy + 0.03 * t;
    scratch.z = iz + 0.07 * t;          // closer to the eye = bigger thrust visually
    scratch.rotX = rx + 0.20 * t;       // tip drops to point forward
    scratch.rotY = ry - 0.20 * t;
    scratch.rotZ = rz;
    return scratch;
  }
  if (phase === 'strike') {
    // Push forward fast. Slight inward (centre-line) translation so
    // the strike comes through the centre of the view rather than
    // staying out to the right.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = (ix - 0.04) + (- 0.10) * ease;
    scratch.y = (iy + 0.03) + (- 0.02) * ease;
    scratch.z = (iz + 0.07) + (-0.40) * ease;   // hard push forward
    scratch.rotX = (rx + 0.20) + (-0.10) * ease;
    scratch.rotY = (ry - 0.20) + (-0.25) * ease;
    scratch.rotZ = rz;
    return scratch;
  }
  // recover — snap back to idle.
  const e = 1 - (1 - t) * (1 - t);
  const fromX = ix - 0.14, fromY = iy + 0.01, fromZ = iz - 0.33;
  const fromRx = rx + 0.10, fromRy = ry - 0.45, fromRz = rz;
  scratch.x = fromX + (ix - fromX) * e;
  scratch.y = fromY + (iy - fromY) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = fromRx + (rx - fromRx) * e;
  scratch.rotY = fromRy + (ry - fromRy) * e;
  scratch.rotZ = fromRz + (rz - fromRz) * e;
  return scratch;
}

// ── Hammer (overhead smash) ───────────────────────────────────────
// Big wind-up: viewmodel rises high above the camera and tilts back.
// Strike drops straight DOWN + forward — gravity carries it. Slow
// recovery so missing is genuinely punishing.
function hammerPose(phase: SwordPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    // Heave it up + back. Big Y, big backward pitch.
    scratch.x = ix - 0.10 * t;
    scratch.y = iy + 0.55 * t;            // up high
    scratch.z = iz + 0.08 * t;
    scratch.rotX = rx - 1.40 * t;         // strong backward pitch
    scratch.rotY = ry;
    scratch.rotZ = rz - 0.20 * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Drop it. Y crashes down faster than it goes forward.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = (ix - 0.10) + 0.10 * ease;
    scratch.y = (iy + 0.55) + (-0.85) * ease;   // overshoots idle floorward
    scratch.z = (iz + 0.08) + (-0.20) * ease;
    scratch.rotX = (rx - 1.40) + 1.95 * ease;   // whole arc forward
    scratch.rotY = ry;
    scratch.rotZ = (rz - 0.20) + 0.45 * ease;
    return scratch;
  }
  // recover — slow lift back to idle from low-and-forward.
  const e = 1 - (1 - t) * (1 - t);
  const fromX = ix,        fromY = iy - 0.30, fromZ = iz - 0.12;
  const fromRx = rx + 0.55, fromRy = ry,       fromRz = rz + 0.25;
  scratch.x = fromX + (ix - fromX) * e;
  scratch.y = fromY + (iy - fromY) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = fromRx + (rx - fromRx) * e;
  scratch.rotY = fromRy + (ry - fromRy) * e;
  scratch.rotZ = fromRz + (rz - fromRz) * e;
  return scratch;
}
