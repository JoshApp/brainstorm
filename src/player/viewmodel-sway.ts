import * as THREE from 'three';

// View-sway — the held viewmodels (weapon, lamp, offhand) lag behind
// the camera when you turn, then ease back to centre. The lantern in
// particular reads as "a heavy thing hanging from a chain" when it
// continues swinging after a hard camera whip.
//
// How it works each frame:
//   1. Sample the camera's yaw + pitch.
//   2. Diff against last frame → angular velocity in rad/sec.
//   3. Accumulate the velocity into per-axis "sway" offsets, then
//      decay them exponentially toward 0. The result is a leaky
//      integrator that builds momentum on a fast turn and bleeds it
//      off when you settle.
//   4. Per-viewmodel helpers expose the relevant slice (weapon wants
//      yaw + pitch; lamp wants only yaw because it's a pendulum).
//
// All offsets are in RADIANS. Clamps stop the lamp from rotating past
// physical-looking arcs on a violent whip.

const YAW_GAIN = 0.18;       // how strongly camera yaw delta builds sway
const PITCH_GAIN = 0.12;
const DECAY_PER_SEC = 6.0;   // exponential 1/sec — higher = faster settle
const MAX_YAW_SWAY = 0.18;   // ≈ 10° cap
const MAX_PITCH_SWAY = 0.10; // ≈ 5.7° cap
const MAX_LAMP_SWING = 0.45; // ≈ 26° cap — pendulum has more room

let yawSway = 0;
let pitchSway = 0;
// Lamp gets a dedicated, slightly heavier-feeling sway so it reads as
// "weight on a chain" — bigger initial impulse, longer decay.
let lampSway = 0;
const LAMP_GAIN = 0.42;
const LAMP_DECAY_PER_SEC = 3.6;

let prevYaw = NaN;
let prevPitch = NaN;
const euler = new THREE.Euler();

/** Reset the integrator. Called on level loads / teleports so a long
 *  scene-transition camera move doesn't slingshot the lamp on respawn. */
export function resetViewSway(): void {
  yawSway = 0;
  pitchSway = 0;
  lampSway = 0;
  prevYaw = NaN;
  prevPitch = NaN;
}

/** Sample the camera and integrate one frame of sway. Call from the
 *  per-frame `unpaused` phase BEFORE the weapon / lamp / offhand
 *  systems so they read the same frame's values. */
export function updateViewSway(dt: number, camera: THREE.Camera): void {
  // Extract camera yaw + pitch from its world quaternion. YXZ order
  // gives us "yaw, pitch, roll" cleanly for a first-person look.
  euler.setFromQuaternion(camera.quaternion, 'YXZ');
  const yaw = euler.y;
  const pitch = euler.x;

  if (!isFinite(prevYaw)) {
    prevYaw = yaw;
    prevPitch = pitch;
    return;
  }

  // Yaw wraps at ±π; unwrap the delta so a crossing doesn't kick the
  // integrator with a 2π pulse.
  let dy = yaw - prevYaw;
  if (dy >  Math.PI) dy -= 2 * Math.PI;
  if (dy < -Math.PI) dy += 2 * Math.PI;
  const dp = pitch - prevPitch;
  prevYaw = yaw;
  prevPitch = pitch;

  // Inverse sign — the viewmodel LAGS, so it swings opposite the
  // camera's rotation (turn left → weapon trails to the right).
  yawSway   -= dy * YAW_GAIN;
  pitchSway -= dp * PITCH_GAIN;
  lampSway  -= dy * LAMP_GAIN;

  // Exponential decay toward 0 — leaky integrator.
  const kDefault = 1 - Math.exp(-DECAY_PER_SEC * dt);
  const kLamp    = 1 - Math.exp(-LAMP_DECAY_PER_SEC * dt);
  yawSway   *= 1 - kDefault;
  pitchSway *= 1 - kDefault;
  lampSway  *= 1 - kLamp;

  // Clamp so a deliberate spin doesn't fold the viewmodel into itself.
  yawSway   = Math.max(-MAX_YAW_SWAY,   Math.min(MAX_YAW_SWAY,   yawSway));
  pitchSway = Math.max(-MAX_PITCH_SWAY, Math.min(MAX_PITCH_SWAY, pitchSway));
  lampSway  = Math.max(-MAX_LAMP_SWING, Math.min(MAX_LAMP_SWING, lampSway));
}

/** Held-weapon sway — additive yaw + pitch (radians) layered on top of
 *  the weapon's pose. Read once per frame by the viewmodel repose. */
export function getWeaponSway(): { yaw: number; pitch: number } {
  return { yaw: yawSway, pitch: pitchSway };
}

/** Lantern sway — pendulum swing angle (radians) applied as the hinge's
 *  rotation.z. Higher gain + slower decay than the weapon so the lamp
 *  reads as a heavy weight on a chain. */
export function getLampSway(): number {
  return lampSway;
}

/** Offhand sway — same source as the weapon but lighter (a shield is
 *  braced, not swung), and yaw-only since a shield doesn't tilt with
 *  pitch the way a held weapon does. */
export function getOffhandSway(): number {
  return yawSway * 0.4;
}
