import * as THREE from 'three';

// Souls-style fog-gate entry. When the player commits at the gate, control
// is taken for a short FORCED walk through the mist into the arena, then
// handed back. No teleport, no hard cut — a continuous first-person dolly
// reads as "you stepped through the gate", and it carries the player far
// enough in that the boss is unambiguously in the fight (and in aggro
// range) by the time control returns.
//
// The player is made invulnerable for the crossing by the caller, so the
// waking boss can't bomb them mid-walk.

let camera: THREE.Camera | null = null;
let active = false;
let t = 0;
let duration = 1.4;
const startPos = new THREE.Vector3();
const endPos = new THREE.Vector3();
let onArrive: (() => void) | null = null;

export function initFogWalkthrough(cam: THREE.Camera): void {
  camera = cam;
}

/** True while the forced walk is playing — input/camera control is suspended. */
export function isFogWalkthroughActive(): boolean {
  return active;
}

/**
 * Begin the forced walk. `through` is the world point to end at (a spot
 * inside the arena). Eye height + yaw are preserved — only the XZ position
 * is driven, so the player keeps looking where they were (at the gate, i.e.
 * into the arena).
 */
export function startFogWalkthrough(through: THREE.Vector3, seconds = 1.4, onArriveCb?: () => void): void {
  if (!camera || active) return;
  active = true;
  t = 0;
  duration = seconds;
  startPos.copy(camera.position);
  endPos.set(through.x, camera.position.y, through.z);
  onArrive = onArriveCb ?? null;
}

/** Drive the walk. Call once per frame with real (un-slowed) dt. */
export function tickFogWalkthrough(dt: number): void {
  if (!active || !camera) return;
  t += dt;
  const u = Math.min(1, t / duration);
  // easeInOutSine — a measured step that eases in and settles, no lurch.
  const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
  camera.position.set(
    startPos.x + (endPos.x - startPos.x) * e,
    startPos.y,
    startPos.z + (endPos.z - startPos.z) * e,
  );
  if (u >= 1) {
    active = false;
    const cb = onArrive;
    onArrive = null;
    cb?.();
  }
}

/** Abort (level teardown / death during the rare overlap). */
export function cancelFogWalkthrough(): void {
  active = false;
  onArrive = null;
}
