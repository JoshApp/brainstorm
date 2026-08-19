// ── THE VR VIEWMODEL: HANDS, NO ARMS ─────────────────────────────────────────
//
// Josh, 2026-08-19: *"lets do a kinda vr viewmodel just floating hands that also makes our life
// easier with arms during animations right?"* — and yes, on both counts.
//
// ── WHY IT LOOKS BETTER ─────────────────────────────────────────────────────
//
// The two forearms were the largest objects on screen, running diagonally from the bottom
// corners into the middle of the frame, in a game whose whole look is small lit things against
// black (docs/VISUAL-LANGUAGE.md). They lit up brightest because they were nearest the lamp, so
// the eye went to a limb instead of to the dungeon. Nothing was gained for it: neither arm
// carries information the player reads. The weapon says where the weapon is; the lantern says
// where the light is. A hand emerging from the dark explains both without occupying a third of
// the view.
//
// ── WHY IT MAKES THE ANIMATION WORK EASIER ──────────────────────────────────
//
// An arm is a CONSTRAINT on every pose: a swing that puts the hand somewhere the elbow cannot
// follow bends the limb wrong, and the fixes for that (elbow poles, reach alarms, wrist
// re-aiming so the forearm exits the wrist anatomically) are all machinery for keeping a limb
// believable. With no limb drawn, an animation only has to put the HAND somewhere — position and
// orientation, two facts, both of them the ones the player actually reads.
//
// The IK still runs. It is what moves the hand, and its shoulder spring is what makes the hand
// lag and settle instead of teleporting. Only the geometry goes.
//
// ── ONE SEAM, BECAUSE THERE ARE TWO ARMS ────────────────────────────────────
//
// The right arm (viewmodel.ts) and the left (lamp-arm.ts) were each stripping their own bones
// inline, with the same reasoning copied into both. That is exactly the shape that drifts — one
// side gets a fix and the other keeps the bug for a month. Both call this instead.

import type * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';

/**
 * Is the viewmodel arms-off?
 *
 * A flag rather than deleted code because it is a LOOK, not a fact about the rig — the arms can
 * come back for a cutscene, a different camera, or if floating hands read wrong on a phone in a
 * dark room, which is the only test that counts. Everything below it is unchanged either way.
 */
export const FLOATING_HANDS = true;

/**
 * Take an arm's geometry off screen, leaving the rig running underneath.
 *
 * `meshes` are the bone meshes the caller poses from the IK each frame — the caller should drop
 * its references afterwards, so its `poseBone` calls become no-ops rather than posing detached
 * objects. `built` is the arm's model, whose `shoulder` and `elbow` slots carry the filler
 * spheres that covered the seams between primitive bones.
 *
 * DETACHED, NEVER DISPOSED. buildModel's geometry comes from a global pool
 * (scene/geometry-pool) and its materials from a shared `modelMatCache`, so disposing anything
 * it produced frees buffers that every other user of that primitive is still drawing with —
 * `disposeGpuTree` has no reference counting; it frees whatever it walks.
 */
export function stripArmGeometry(
  built: BuiltModel | null | undefined,
  meshes: Array<THREE.Object3D | undefined | null>,
): void {
  for (const m of meshes) m?.removeFromParent();
  if (!built) return;
  // The joint spheres are unnamed parts, so they are found structurally: the mesh children of
  // the joint slots. The slots themselves stay — the IK writes to them every frame.
  for (const slotName of ['shoulder', 'elbow']) {
    const slot = built.slots.get(slotName);
    if (!slot) continue;
    for (const c of [...slot.children]) {
      if ((c as THREE.Mesh).isMesh) c.removeFromParent();
    }
  }
}
