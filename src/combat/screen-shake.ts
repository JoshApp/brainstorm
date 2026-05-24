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
 * Advances shake state by dt and writes the current offset into outOffset.
 * Returns true if there's still a non-zero shake.
 */
export function tickShake(dt: number, outOffset: THREE.Vector3): boolean {
  if (durationLeft <= 0) {
    outOffset.set(0, 0, 0);
    return false;
  }

  durationLeft -= dt;
  if (durationLeft <= 0) {
    durationLeft = 0;
    amplitude = 0;
    outOffset.set(0, 0, 0);
    return false;
  }

  const t = durationLeft / baseDuration; // 1 → 0
  const currentAmp = amplitude * t * t;  // ease-out quad for natural decay

  tmpOffset.set(
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 2,
  );
  tmpOffset.normalize().multiplyScalar(currentAmp);
  outOffset.copy(tmpOffset);
  return true;
}
