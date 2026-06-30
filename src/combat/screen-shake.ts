import * as THREE from 'three';

// Screen shake: a small camera-position offset that decays over a short duration.
// Owned globally (one shake at a time — multiple kicks just refresh the timer
// and amplitude). The main loop applies the offset to the camera before render
// and removes it after, so other systems see the unshaken position.
//
// Offset is random within a sphere of the current amplitude. Direction
// resamples each frame so it reads as "shake" not "drift."

let amplitude = 0;
let durationLeft = 0;
let baseDuration = 0;
const tmpOffset = new THREE.Vector3();

// Directional JOLT — a damped oscillation along a fixed axis, summed on top of
// the isotropic jitter above. Where kickShake reads as "rattle" (random each
// frame), a jolt reads as a heavy "boom": it punches the camera along one axis
// (e.g. straight down for a gate slamming into stone — the floor heaves) and
// rings out over a few decaying bounces. Used for events that have a direction
// and a weight, not just energy.
const joltDir = new THREE.Vector3();
let joltAmp = 0;
let joltLeft = 0;
let joltBase = 0;
let joltFreq = 8;

export function kickShake(magnitude: number, duration: number) {
  // Refresh — take max of current and new so a stronger hit overrides a weaker
  // one already decaying.
  if (magnitude > amplitude) amplitude = magnitude;
  if (duration > durationLeft) {
    durationLeft = duration;
    baseDuration = duration;
  }
}

/**
 * Fire a directional jolt: the camera punches `magnitude` metres along
 * (dx,dy,dz) and rings out over `duration` seconds at `freq` Hz. A jolt does
 * NOT stack with itself (last one wins — these are rare, deliberate events).
 * It sums with any active kickShake jitter.
 */
export function kickJolt(dx: number, dy: number, dz: number, magnitude: number, duration: number, freq = 8) {
  joltDir.set(dx, dy, dz);
  if (joltDir.lengthSq() > 0) joltDir.normalize();
  joltAmp = magnitude;
  joltLeft = duration;
  joltBase = duration;
  joltFreq = freq;
}

/**
 * Advances shake state by dt and writes the current offset into outOffset.
 * Returns true if there's still a non-zero shake (jitter OR jolt).
 */
export function tickShake(dt: number, outOffset: THREE.Vector3): boolean {
  outOffset.set(0, 0, 0);
  let active = false;

  // Isotropic jitter (kickShake) — random direction each frame, ease-out decay.
  if (durationLeft > 0) {
    durationLeft -= dt;
    if (durationLeft <= 0) {
      durationLeft = 0;
      amplitude = 0;
    } else {
      const t = durationLeft / baseDuration;  // 1 → 0
      const currentAmp = amplitude * t * t;   // ease-out quad for natural decay
      tmpOffset.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      );
      tmpOffset.normalize().multiplyScalar(currentAmp);
      outOffset.add(tmpOffset);
      active = true;
    }
  }

  // Directional jolt (kickJolt) — damped cosine along joltDir. Starts at full
  // deflection (cos 0 = 1 → an immediate punch), then oscillates and fades.
  if (joltLeft > 0) {
    joltLeft -= dt;
    if (joltLeft <= 0) {
      joltLeft = 0;
      joltAmp = 0;
    } else {
      const elapsed = joltBase - joltLeft;
      const t = joltLeft / joltBase;                       // 1 → 0
      const env = t * t;                                   // ease-out decay
      const osc = Math.cos(elapsed * joltFreq * Math.PI * 2.0);
      tmpOffset.copy(joltDir).multiplyScalar(joltAmp * env * osc);
      outOffset.add(tmpOffset);
      active = true;
    }
  }

  return active;
}

/** DEV trace: the live shake state, so we can tell "kick didn't set it" from "set but not ticked". */
export function shakeDebug(): { amplitude: number; durationLeft: number; joltLeft: number } {
  return { amplitude: +amplitude.toFixed(3), durationLeft: +durationLeft.toFixed(3), joltLeft: +joltLeft.toFixed(3) };
}
