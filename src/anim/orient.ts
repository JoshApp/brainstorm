import * as THREE from 'three';

// Author rotations by INTENT, not by guessing Euler decimals.
//
// The pain this module solves: rotations are the #1 documented LLM-CAD
// failure mode (axis confusion + sign confusion + Euler-order traps),
// and we've felt every one of them this session. `[-0.2, -0.15, 0.4]`
// reads as nothing to anyone — including future Claude — without
// running the math in your head, and "invert the Z" is the wrong
// answer half the time because the sign depends on which axis you're
// projecting to.
//
// Instead, describe the orientation symbolically:
//
//   const SWORD_IDLE_ROT = orient({
//     yAxisTo: tilt(DIR.UP, DIR.FORWARD, 0.2),   // blade up, slight forward lean
//     upTo:    tilt(DIR.BACKWARD, DIR.LEFT, 0.4), // back of hand mostly behind, slight left
//   });
//
// The function solves for the Euler — sign-correct, order-correct,
// orthogonalised. Authors only ever name DIRECTIONS, never axes or
// rotation amounts.
//
// Coordinate convention (matches CLAUDE.md): Y-up, −Z-forward.
//   +X = right, +Y = up, −Z = forward (into the scene).
//   When used to compose CAMERA-LOCAL rotations (like SWORD_IDLE_ROT),
//   these are in the player's view frame.

export type Vec3Tuple = readonly [number, number, number];

/**
 * Named cardinal directions in the camera-local (or world) frame.
 * Y-up, −Z-forward.
 */
export const DIR = {
  UP:       [ 0,  1,  0] as Vec3Tuple,
  DOWN:     [ 0, -1,  0] as Vec3Tuple,
  RIGHT:    [ 1,  0,  0] as Vec3Tuple,
  LEFT:     [-1,  0,  0] as Vec3Tuple,
  FORWARD:  [ 0,  0, -1] as Vec3Tuple,
  BACKWARD: [ 0,  0,  1] as Vec3Tuple,
} as const;

/**
 * Blend a principal direction with a secondary tilt.
 *
 * `amount` is the ratio of secondary to principal — keep below 1 for
 * the result to still "read" as the principal direction with a lean.
 * Suggested feel:
 *   0.05  subtle  (a hint of tilt)
 *   0.20  slight  (clearly leaning but the principal still dominates)
 *   0.40  moderate
 *   0.80  strong  (the two directions are nearly equal)
 */
export function tilt(principal: Vec3Tuple, secondary: Vec3Tuple, amount = 0.20): Vec3Tuple {
  const r: [number, number, number] = [
    principal[0] + secondary[0] * amount,
    principal[1] + secondary[1] * amount,
    principal[2] + secondary[2] * amount,
  ];
  const len = Math.hypot(r[0], r[1], r[2]);
  if (len < 1e-9) return principal;
  return [r[0] / len, r[1] / len, r[2] / len];
}

/**
 * Solve for the Euler XYZ rotation that orients an object so its
 * LOCAL +Y axis points along `yAxisTo`, and its LOCAL +Z axis aligns
 * (after orthogonalisation) with `upTo`. Defaults `upTo` to world UP.
 *
 * Returns an `[x, y, z]` tuple ready to drop into SWORD_IDLE_ROT,
 * slot.rot, or anywhere Three's Euler XYZ is expected.
 *
 * Why +Y? Most authored model parts in this codebase point along
 * their local +Y by convention (cylinder height-axis, bone direction,
 * weapon grip axis, finger extension direction). Constraining that
 * one axis covers almost every rotation we need.
 *
 * The remaining freedom (rotation around the +Y axis after it's
 * pinned) is resolved by `upTo` — which way the object's "top" or
 * "back" faces. If the two directions aren't perpendicular, `upTo`
 * is projected onto the plane perpendicular to `yAxisTo`.
 */
/**
 * Convert a "desired rotation in the parent's REFERENCE frame" into a
 * "rotation expressed in PARENT-LOCAL" — i.e. handle the counter-
 * rotation math when you want a child's orientation to be specified
 * independently of how its parent is oriented.
 *
 * Example: you've rotated the wrist 30° so the hand reads differently,
 * but you DON'T want the palm_anchor (and therefore the weapon
 * attached to it) to rotate with the wrist. You want the palm anchor
 * to stay at its previous orientation in the hand's frame.
 *
 *   const newWristRot = orient({ yAxisTo: tilt(DIR.UP, DIR.FORWARD, 0.5) });
 *
 *   slots: {
 *     wrist: { rot: newWristRot },
 *     palm_anchor: {
 *       parent: 'wrist',
 *       // Whatever orientation you want the palm anchor to have IN THE
 *       // HAND's reference frame (not the wrist's local frame). The
 *       // helper computes the wrist-local rotation that achieves it.
 *       rot: localFromWorld([0, 0, 0], newWristRot),  // identity in hand-root
 *     },
 *   }
 *
 * Reads as: "what local Euler do I need, given parent has THIS Euler,
 * so my orientation in the parent's parent frame ends up THAT."
 *
 * Works in pure quaternion space internally so there's no Euler-order
 * surprise.
 */
export function localFromWorld(
  worldRot: Vec3Tuple,
  parentWorldRot: Vec3Tuple,
): [number, number, number] {
  const wQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...worldRot, 'XYZ'));
  const pQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...parentWorldRot, 'XYZ'));
  const localQ = pQ.invert().multiply(wQ);
  const e = new THREE.Euler().setFromQuaternion(localQ, 'XYZ');
  return [e.x, e.y, e.z];
}

/**
 * Compose an INTRINSIC rotation onto an existing Euler — i.e. apply
 * an additional rotation around the OBJECT'S CURRENT LOCAL axis
 * after its existing rotation has been applied.
 *
 * This is what you need when the author looks at a debug axis triad
 * in the viewport and says "rotate 25° around the blue axis." That
 * blue axis is the object's local +Z AFTER its existing X/Y/Z
 * rotation is applied — not the parent's +Z. Simply adding to the
 * Euler's Z channel rotates around the PARENT axis instead, which
 * is a different operation when the object already has non-zero X
 * or Y components.
 *
 * Implementation: quaternion-multiply on the right (intrinsic).
 *   q_new = q_existing * q_axis_rotation
 *
 *   const BASE = [PITCH, TWIST, 0];
 *   const NEW  = rotateLocally(BASE, 'z', -25 * Math.PI / 180);
 *   //         ^ adds a 25° clockwise-from-POV rotation around the
 *   //         BLUE axis (local +Z) on top of the base.
 */
export function rotateLocally(
  baseRot: Vec3Tuple,
  axis: 'x' | 'y' | 'z',
  radians: number,
): [number, number, number] {
  const qBase = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(baseRot[0], baseRot[1], baseRot[2], 'XYZ'),
  );
  const axisVec = new THREE.Vector3(
    axis === 'x' ? 1 : 0,
    axis === 'y' ? 1 : 0,
    axis === 'z' ? 1 : 0,
  );
  const qDelta = new THREE.Quaternion().setFromAxisAngle(axisVec, radians);
  qBase.multiply(qDelta);
  const e = new THREE.Euler().setFromQuaternion(qBase, 'XYZ');
  return [e.x, e.y, e.z];
}

export function orient(opts: {
  yAxisTo: Vec3Tuple,
  upTo?: Vec3Tuple,
}): [number, number, number] {
  const y = new THREE.Vector3(...opts.yAxisTo).normalize();
  const upRef = new THREE.Vector3(...(opts.upTo ?? DIR.UP)).normalize();
  // Project upRef onto the plane perpendicular to y — that's the
  // valid +Z axis (the object's "back / top"). If upRef is parallel
  // to y the projection collapses, fall back to a stable arbitrary
  // perpendicular so the matrix stays orthonormal.
  let z = upRef.clone().sub(y.clone().multiplyScalar(upRef.dot(y)));
  if (z.lengthSq() < 1e-6) {
    z = Math.abs(y.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    z.sub(y.clone().multiplyScalar(z.dot(y)));
  }
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z];
}
