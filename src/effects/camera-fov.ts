import type * as THREE from 'three';

// ── ONE OWNER FOR camera.fov ─────────────────────────────────────────────────
//
// Field of view now has more than one thing with an opinion about it — the
// slow-mo zoom on a kill, and momentum opening the view as you get moving — and
// two systems writing the same property is how you get a camera that snaps back
// to the wrong number the instant one of them stops caring.
//
// The pre-existing version of that bug was already latent: slowmo-presentation
// cached `baseFov` the first time it ran and wrote `camera.fov = baseFov +
// kick`, then restored `baseFov` on the way out. Its own comment noted it
// avoided touching the camera at rest specifically so it wouldn't "fight the
// resize handler". That is the shape of a property with no owner.
//
// So: contributors declare a NAMED offset in degrees, this module sums them
// onto the base, and it is the only thing that assigns `camera.fov`. Adding a
// third contributor later is one call, and removing one cannot strand the
// camera at somebody else's number.
//
// Baseline system, so it gets the small proper version rather than a patch
// (CLAUDE.md: "a shortcut here bites repeatedly and gets redone five times").

/** The FOV with nothing applied — whatever the camera was created with, or
 *  whatever a settings/resize path last declared. */
let base = 0;
const offsets = new Map<string, number>();
/** What we last wrote, so a frame that changes nothing costs no matrix rebuild. */
let applied = -1;

/**
 * Declare the resting FOV. Call on camera creation and from anywhere that
 * changes FOV as a SETTING rather than as an effect.
 */
export function setBaseFov(deg: number): void { base = deg; }

/** The resting FOV, for anything that needs to reason in absolute degrees. */
export function baseFov(): number { return base; }

/**
 * Contribute (or clear, with 0) a named offset in degrees.
 *
 * Named rather than additive-anonymous so a contributor can be idempotent: a
 * system calls this every frame with its current value and never has to
 * remember to subtract what it added last time.
 */
export function setFovOffset(name: string, deg: number): void {
  if (deg === 0) offsets.delete(name);
  else offsets.set(name, deg);
}

/** Push the summed result onto the camera. Called once per frame, after every
 *  contributor has had its say. */
export function applyFov(camera: THREE.PerspectiveCamera): void {
  if (base === 0) base = camera.fov;      // first frame — adopt what we found
  let sum = base;
  for (const v of offsets.values()) sum += v;
  if (Math.abs(sum - applied) < 0.01) return;
  applied = sum;
  camera.fov = sum;
  camera.updateProjectionMatrix();
}

/** Floor load, death, menu — drop every effect offset and return to base. The
 *  base itself survives, because it is a setting and not an effect. */
export function resetFovOffsets(camera?: THREE.PerspectiveCamera): void {
  offsets.clear();
  if (camera) applyFov(camera);
}
