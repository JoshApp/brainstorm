import * as THREE from 'three';

// Viewmodel pull-back — the classic FPS trick for keeping the held
// weapon out of the wall when you press the camera into one. Each
// frame we cast a ray from the camera forward; when a wall sits
// closer than the pull threshold, we lerp a global "retract Z"
// toward the overlap distance. Each held viewmodel (sword/lamp/arm)
// adds this Z to its camera-local position, which retracts the
// whole assembly toward the camera. The arm IKs follow naturally
// because their hand/wrist targets move with the retracted weapon
// and lamp.
//
// We use the WalkableRegion's existing rayWallDistance (XZ plane)
// — it's the same wall topology player movement collides with, so
// the retraction matches what the player can physically approach.
//
// Cheap: one ray-vs-segments call per frame, no per-mesh checks.

const PULL_THRESHOLD = 0.75;   // start retracting when wall closer than this (metres)
const MAX_PULLBACK   = 0.45;   // never retract more than this (metres)
const PULL_RATE      = 14;     // 1/sec exponential lerp toward target

let pullback = 0;
const _forward  = new THREE.Vector3();
const _camWorld = new THREE.Vector3();

interface WalkableLike {
  rayWallDistance(ox: number, oz: number, dx: number, dz: number, maxDist: number): number;
}

/** Per-frame. Updates the global pullback Z (always ≥ 0). Pass the
 *  current level's walkable region; null disables retraction. */
export function tickViewmodelPullback(
  dt: number,
  camera: THREE.Camera,
  walkable: WalkableLike | null,
): void {
  if (!walkable) {
    pullback += (0 - pullback) * (1 - Math.exp(-PULL_RATE * dt));
    return;
  }
  camera.getWorldDirection(_forward);
  camera.getWorldPosition(_camWorld);
  const fxz = Math.hypot(_forward.x, _forward.z) || 1;
  const dx = _forward.x / fxz;   // normalise into XZ (rayWallDistance is 2D)
  const dz = _forward.z / fxz;
  const dist = walkable.rayWallDistance(_camWorld.x, _camWorld.z, dx, dz, PULL_THRESHOLD);
  const overlap = Math.max(0, PULL_THRESHOLD - dist);
  const target = Math.min(MAX_PULLBACK, overlap);
  const k = 1 - Math.exp(-PULL_RATE * dt);
  pullback += (target - pullback) * k;
}

/** Current pullback amount (≥ 0) — viewmodel modules ADD this to their
 *  camera-local Z so a positive value retracts the held thing toward
 *  the camera. */
export function getViewmodelPullback(): number {
  return pullback;
}

/** Current pullback as a 0..1 fraction of the maximum. Used by the lamp
 *  to slide its LIGHT source toward the camera as the body retracts —
 *  prevents the visible lantern from ending up on the wrong side of a
 *  wall the player has pressed against (the "phasing into pitch black"
 *  bug). 0 = no retraction (light at body); 1 = fully retracted. */
export function getViewmodelPullbackFrac(): number {
  return Math.max(0, Math.min(1, pullback / MAX_PULLBACK));
}
