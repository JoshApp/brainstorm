import * as THREE from 'three';

// Render interpolation for the fixed-step loop.
//
// The sim advances in fixed 1/60s quanta; the frame is DRAWN at the display
// rate. Anything that moves only in a kind:'sim' system (the camera, enemies)
// therefore steps in discrete 1/60 jumps. Because the sim clock and the display
// clock aren't phase-locked, the number of sim steps consumed per drawn frame
// isn't a clean 1,1,1,… — it beats between 1 and an occasional 0 or 2. A
// 0-step frame draws a duplicate; the next 2-step frame jumps double. That
// reads as a periodic micro-judder EVEN at a locked 60fps. (Gaffer, "Fix Your
// Timestep".)
//
// The fix keeps the sim authoritative + deterministic and only changes what we
// DRAW: render a pose interpolated between the two most-recent sim snapshots by
//   alpha = leftover-accumulator / FIXED_DT
// so on a 0-step frame the view still advances smoothly toward `curr` instead
// of freezing. This is presentation ONLY — combat/aim read the authoritative
// sim pose DURING the sim step (interp never runs then), and the replay tape is
// byte-identical. Cost: render is ~1 tick (≈16ms) in the past, the standard
// interpolation latency tradeoff.
//
// Lifecycle, driven by the fixed-step loop in main.ts:
//   per sim step:  stepBegin(targets) → advanceSimStep() → stepEnd(targets)
//   after loop:    apply(alpha, targets) → presentPass() → restore(targets)
// `restore` is load-bearing: it puts the authoritative `curr` pose back before
// the next sim step integrates from it (updateCamera reads camera.position
// incrementally; enemies read group.position). Without it the interpolated draw
// pose would feed back into the sim and drift.

// Distance (metres) between two consecutive sim snapshots above which we treat
// the move as a TELEPORT (spawn, blink, knockback impulse) and snap to `curr`
// rather than streak a lerp across the gap. A 1.5m/step jump is 90 m/s — far
// past any real locomotion (a dash is ~0.1m/step).
const SNAP_DIST = 1.5;
const SNAP_DIST2 = SNAP_DIST * SNAP_DIST;

// Orientation teleport: a per-step rotation jump past this (radians) is a
// SCRIPTED snap (an event look-at, a respawn facing change, a weapon-swap held
// pose) rather than real turning — slerping across it would streak the view
// through a wrong heading for a frame. 2.0 rad ≈ 115°/step ≈ 6900°/s, far past
// the fastest human flick (a 180° flick over 3 frames is ~60°/step), so real
// look + swing input still interpolates smoothly. Mirrors SNAP_DIST's intent on
// the rotational axis (the position check alone misses a pure-rotation snap).
const SNAP_ANGLE = 2.0;

interface Entry {
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
}

// WeakMap keyed by the live Object3D: when an enemy's group is dropped from the
// scene and GC'd, its entry goes with it — no manual pruning, no leak.
const entries = new WeakMap<THREE.Object3D, Entry>();
let enabled = false;

export function setRenderInterpEnabled(on: boolean): void { enabled = on; }
export function isRenderInterpEnabled(): boolean { return enabled; }

function makeEntry(obj: THREE.Object3D): Entry {
  // Seed prev = curr = the object's current pose, so a newly-tracked object
  // (first frame, or a just-spawned enemy) never lerps from a stale origin.
  return {
    prevPos: obj.position.clone(),
    currPos: obj.position.clone(),
    prevQuat: obj.quaternion.clone(),
    currQuat: obj.quaternion.clone(),
  };
}

/** Before a sim step: roll the last step's `curr` into `prev` for everything
 *  that already exists. New objects (spawned during the step) are picked up by
 *  stepEnd with prev=curr so they don't streak. */
export function interpStepBegin(targets: readonly THREE.Object3D[]): void {
  if (!enabled) return;
  for (const obj of targets) {
    const e = entries.get(obj);
    if (e) {
      e.prevPos.copy(e.currPos);
      e.prevQuat.copy(e.currQuat);
    }
  }
}

/** After a sim step: record the new authoritative pose as `curr` (creating the
 *  entry for anything seen for the first time). */
export function interpStepEnd(targets: readonly THREE.Object3D[]): void {
  if (!enabled) return;
  for (const obj of targets) {
    const e = entries.get(obj);
    if (e) {
      e.currPos.copy(obj.position);
      e.currQuat.copy(obj.quaternion);
    } else {
      entries.set(obj, makeEntry(obj));
    }
  }
}

/** Before the present pass: set each object's drawn pose to lerp(prev,curr,a).
 *  Teleports (gap > SNAP_DIST) snap to curr. */
export function interpApply(alpha: number, targets: readonly THREE.Object3D[]): void {
  if (!enabled) return;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  for (const obj of targets) {
    const e = entries.get(obj);
    if (!e) continue;
    const teleported =
      e.prevPos.distanceToSquared(e.currPos) > SNAP_DIST2 ||
      e.prevQuat.angleTo(e.currQuat) > SNAP_ANGLE;
    if (teleported) {
      obj.position.copy(e.currPos);
      obj.quaternion.copy(e.currQuat);
    } else {
      obj.position.lerpVectors(e.prevPos, e.currPos, a);
      obj.quaternion.copy(e.prevQuat).slerp(e.currQuat, a);
    }
  }
}

/** Re-seed prev = curr = each object's CURRENT pose. Call after a HARD TELEPORT
 *  (level load / respawn) that moves an object outside the sim step — otherwise
 *  interpRestore keeps snapping it back to its stale pre-teleport `curr` (and while
 *  the sim is paused, e.g. the harness bot between turns, it never updates, so the
 *  object is pinned to the OLD position forever — the bot spawning out of bounds on
 *  descent). Idempotent; creates the entry if the object is new. */
export function interpSync(targets: readonly THREE.Object3D[]): void {
  if (!enabled) return;
  for (const obj of targets) {
    const e = entries.get(obj);
    if (e) {
      e.prevPos.copy(obj.position); e.currPos.copy(obj.position);
      e.prevQuat.copy(obj.quaternion); e.currQuat.copy(obj.quaternion);
    } else {
      entries.set(obj, makeEntry(obj));
    }
  }
}

/** After the present pass: restore the authoritative `curr` pose so the next
 *  sim step integrates from real state, not the interpolated draw pose. */
export function interpRestore(targets: readonly THREE.Object3D[]): void {
  if (!enabled) return;
  for (const obj of targets) {
    const e = entries.get(obj);
    if (!e) continue;
    obj.position.copy(e.currPos);
    obj.quaternion.copy(e.currQuat);
  }
}
