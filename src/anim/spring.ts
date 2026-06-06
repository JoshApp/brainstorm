// Frame-rate-independent smoothing + springs — the single highest feel-per-line
// technique for a primitive rig (weapon sway/lag, follow-through, recoil
// settle, camera ease, telegraph weight). All driven by YOUR dt, so hit-pause
// / slow-mo / replay stay correct. No dependency beyond three's Vector3/
// Quaternion for the vector helpers; the scalar core is pure.
//
// Refs: Daniel Holden "Spring-It-On" (theorangeduck.com/page/spring-roll-call),
// Ryan Juckett "Damped Springs". `damp` is the exact exponential decay, which
// composes EXACTLY across substeps (true frame-rate independence). `spring` is
// a second-order oscillator (gives lag + overshoot) integrated semi-implicitly
// — stable at game dt, deterministic given the same dt sequence.

import type { Vector3, Quaternion } from 'three';

/** First-order smoothing toward `target`. `halfLife` = seconds to close half
 *  the remaining gap; frame-rate independent (exact exponential). */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0 || dt <= 0) return halfLife <= 0 ? target : current;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** Per-component damp of a Vector3 toward `target`, in place. Returns `current`. */
export function dampVec3(current: Vector3, target: Vector3, halfLife: number, dt: number): Vector3 {
  current.x = damp(current.x, target.x, halfLife, dt);
  current.y = damp(current.y, target.y, halfLife, dt);
  current.z = damp(current.z, target.z, halfLife, dt);
  return current;
}

/** Slerp a quaternion toward `target` with frame-rate-independent rate, in place. */
export function dampQuat(current: Quaternion, target: Quaternion, halfLife: number, dt: number): Quaternion {
  if (halfLife <= 0) return current.copy(target);
  if (dt <= 0) return current;
  return current.slerp(target, 1 - Math.pow(2, -dt / halfLife));
}

/** A second-order spring's state: position + velocity. */
export interface Spring1 {
  value: number;
  vel: number;
}

export function makeSpring(value = 0): Spring1 {
  return { value, vel: 0 };
}

/**
 * Advance a spring toward `target`. `freq` ≈ oscillations/sec (stiffness),
 * `damping` is the ratio: 1 = critically damped (fastest, no overshoot), <1 =
 * under-damped (overshoot + ring = follow-through/lag juice), >1 = over-damped
 * (sluggish). Semi-implicit Euler — stable for game-rate dt; clamps dt so a
 * frame spike can't explode a stiff spring.
 */
export function spring(s: Spring1, target: number, freq: number, damping: number, dt: number): number {
  if (dt <= 0) return s.value;
  const step = Math.min(dt, 1 / 30);   // guard: never integrate a >33ms gap in one go
  const omega = 2 * Math.PI * freq;
  const k = omega * omega;             // stiffness
  const c = 2 * damping * omega;       // damping coefficient
  const accel = k * (target - s.value) - c * s.vel;
  s.vel += accel * step;
  s.value += s.vel * step;
  return s.value;
}
