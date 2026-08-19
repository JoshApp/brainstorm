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

import * as THREE from 'three';
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

// ── AIMING A HAND THAT HAS NO ARM ────────────────────────────────────────────
//
// With a forearm on screen the wrist solver aims the hand: its job is to keep the hand agreeing
// with a limb the player can see. With no limb there is nothing to agree with, so a floating
// hand is HELD at an authored orientation instead — and authoring that orientation by hand is
// where two sessions went wrong.
//
// `orient({ yAxisTo, upTo })` aims a model's local +Y and +Z. That is the right tool for a part
// whose axes ARE its anatomy, and a hand's are not:
//
//   · The fingers do not run along the hand root's +Y. Everything below the root hangs off the
//     `wrist` slot, which carries the authored wrist bend — roll, flexion and deviation, tuned
//     for the sabre grip (content/hand.ts). Aim the root and the hand lands wherever that bend
//     leaves it.
//   · +Z is not the back of the hand on both hands. HAND_LEFT is a MIRRORED spec, so its +Z is
//     the palm where the right hand's +Z is the back — measured: right palm normal
//     (0.39, 0.02, -0.92), left (0.39, -0.02, +0.92). "Back of the hand up" pointed one palm at
//     the ceiling.
//
// So the hand's frame is MEASURED off the hand, from landmarks that mean the same thing on any
// hand, scanned or authored, left or right:
//
//   fingers = wrist -> the mean of the four MCP knuckles
//   palm    = `palm_anchor`'s lean off the knuckle plane
//
// The second is the handedness-proof one. `palm_anchor` is authored as a point IN the palm, so
// which side of the knuckles it sits on IS the answer — no cross product whose sign flips with
// the mirror, no convention to remember. The grip solver derives its palm normal the same way
// and for the same reason.

const _handQ = new THREE.Quaternion();
const _v = new THREE.Vector3();
const KNUCKLES = ['finger_index', 'finger_middle', 'finger_ring', 'finger_pinky'];

/**
 * The rotation for `anchor` that points the hand's FINGERS along `fingersTo` and faces its PALM
 * along `palmTo`, both given in the anchor's parent frame.
 *
 * `palmTo` is orthogonalised against `fingersTo`, so it can be named loosely — "palm down" while
 * the fingers already point a little down is a sensible thing to ask for and does not need the
 * caller to do the trigonometry.
 *
 * Returns null if the hand is missing the landmarks, which is a real possibility while a scanned
 * hand is still loading: the caller should keep whatever it had.
 */
export function aimHand(
  hand: { slots: Map<string, THREE.Object3D> },
  anchor: THREE.Object3D,
  fingersTo: THREE.Vector3,
  palmTo: THREE.Vector3,
): THREE.Quaternion | null {
  const wrist = hand.slots.get('wrist');
  const palmAnchor = hand.slots.get('palm_anchor');
  if (!wrist || !palmAnchor) return null;

  // MEASURED WITH THE ANCHOR AT IDENTITY, so what comes out is a rotation OF the anchor rather
  // than one composed on top of whatever it already carries. Restored before returning.
  const saved = anchor.quaternion.clone();
  anchor.quaternion.identity();
  anchor.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(anchor.matrixWorld).invert();
  const at = (o: THREE.Object3D): THREE.Vector3 =>
    new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);

  const W = at(wrist);
  const K = new THREE.Vector3();
  let n = 0;
  for (const name of KNUCKLES) {
    const slot = hand.slots.get(name);
    if (!slot) continue;
    K.add(at(slot));
    n++;
  }
  const P = at(palmAnchor);

  anchor.quaternion.copy(saved);
  anchor.updateWorldMatrix(true, true);
  if (!n) return null;
  K.divideScalar(n);

  const F = K.clone().sub(W);
  if (F.lengthSq() < 1e-9) return null;
  F.normalize();
  const N = P.clone().sub(K);
  N.addScaledVector(F, -N.dot(F));
  if (N.lengthSq() < 1e-9) return null;
  N.normalize();

  const f2 = fingersTo.clone();
  if (f2.lengthSq() < 1e-9) return null;
  f2.normalize();
  const n2 = palmTo.clone();
  n2.addScaledVector(f2, -n2.dot(f2));
  if (n2.lengthSq() < 1e-9) return null;
  n2.normalize();

  // Two orthonormal bases with the hand's own axes in the same columns; the rotation between
  // them is the answer, sign-correct by construction rather than by trying it.
  const from = new THREE.Matrix4().makeBasis(_v.crossVectors(F, N).clone(), F, N);
  const to = new THREE.Matrix4().makeBasis(_v.crossVectors(f2, n2).clone(), f2, n2);
  return _handQ.setFromRotationMatrix(to.multiply(from.invert())).clone();
}
