// ── THE GRIP SOLVER ──────────────────────────────────────────────────────────
//
// Josh, on the v2 grip: *"currently the weapon is stuck inside the handbone and the fingers try
// to close around it — in a real grip the anchor is like touching the palm and fingers and
// knuckles grip around it."*
//
// That is a GEOMETRY error, not a tuning error, and it has two halves.
//
// ── HALF ONE: THE HILT RESTS ON THE PALM ────────────────────────────────────
//
// v2 put the weapon's `grip_anchor` AT the hand's `palm_anchor` — a point inside the hand — so
// a hilt of radius r was buried r deep in the bone. A held cylinder does not pass through the
// palm; it TOUCHES it. So the grip axis belongs one radius out along the palm normal:
//
//     C = palm_anchor + palm_normal · radius
//
// Then the cylinder's SURFACE passes through palm_anchor, which is what "the anchor is touching
// the palm" means. One line, and the weapon comes out of the bone.
//
// ── HALF TWO: FINGERS CLOSE UNTIL THEY TOUCH ────────────────────────────────
//
// v2 nudged all five MCP joints by one scalar — `(0.022 − radius) × 25` — with nothing ever
// checking that a finger touched anything. Open loop, and tuned by eye against one specific
// hand, which is why swapping the hand model invalidated every pose constant at once.
//
// Here each joint is asked one question, and it is the question that actually matters:
//
//     rotate this joint until the joint BELOW it lies on the grip cylinder.
//
// That is a scalar root-find on one angle — march out from flat until the child's distance to
// the grip axis crosses the target radius, then bisect. Run it down the chain and the finger
// lays itself along the cylinder: the knuckle brings the finger to the surface, each joint
// after follows the curve.
//
// It is deliberately NOT the closed-form version. The tidy construction — project into the
// plane perpendicular to the grip axis, solve the circle intersection, convert to a joint
// angle — assumes every joint rotates exactly about that axis. Fingers nearly do; the THUMB
// does not, because opposition is precisely the thumb rotating about a different axis.
// Measured: that pass left PIPs 13–20mm off the hilt and the thumb tip 47.7mm off. Solving the
// real quantity, on whatever axis a joint actually has, needs no such assumption.
//
// A finger that CANNOT reach — a haft too fat to close on — never crosses the target, so it
// stops at its anatomical limit. That is the correct behaviour, and it shows up honestly in the
// error report instead of being hidden by a clamp.
//
// ── AND IT REPORTS ITS OWN ERROR ────────────────────────────────────────────
//
// Every joint's final distance to the axis is measured against the radius it should be at, and
// returned in millimetres. docs/AUTHORING.md has described this array (`fingerContactErrors`)
// as the thing that converts "tune curl angles by eye" into "drive these distances to zero"
// since before any of this existed. This is where it starts existing.

import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';

/** Joint chains, tip last. The tip is an anchor rather than a joint — it is the far end of the
 *  last bone, and without it that bone has no length and never closes. */
const CHAINS: Record<string, string[]> = {
  thumb: ['finger_thumb', 'finger_thumb_ip', 'finger_thumb_tip'],
  index: ['finger_index', 'finger_index_pip', 'finger_index_dip', 'finger_index_tip'],
  middle: ['finger_middle', 'finger_middle_pip', 'finger_middle_dip', 'finger_middle_tip'],
  ring: ['finger_ring', 'finger_ring_pip', 'finger_ring_dip', 'finger_ring_tip'],
  pinky: ['finger_pinky', 'finger_pinky_pip', 'finger_pinky_dip', 'finger_pinky_tip'],
};

/** Anatomical flexion limits, radians, knuckle first. A finger that cannot reach the grip stops
 *  here instead of bending through itself. */
const LIMITS = [1.75, 1.92, 1.40];

/** Coarse steps out from flat before bisecting, then bisection depth. 24 steps is far finer
 *  than the joint travel that reads as a different pose. */
const MARCH = 24;
const BISECT = 18;

export interface GripSolve {
  /** Where the weapon's grip_anchor should sit, in hand-root space — ON the palm, not in it. */
  center: THREE.Vector3;
  /** The grip axis, hand-root space. */
  axis: THREE.Vector3;
  /** The cylinder radius the fingers were closed onto. */
  radius: number;
  /** Per-joint distance-to-axis error, millimetres, keyed by joint (`index_pip`, `thumb_ip`…). */
  errors: Record<string, number>;
  /** Worst error in millimetres — the single number worth watching. */
  worst: number;
}

const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
let warnedNoSolve = false;

/** Perpendicular offset of `p` from the line (c, a). `a` must be unit. */
function radial(p: THREE.Vector3, c: THREE.Vector3, a: THREE.Vector3, out: THREE.Vector3): number {
  out.subVectors(p, c);
  out.addScaledVector(a, -out.dot(a));
  return out.length();
}

/**
 * Close the hand around a cylinder of `gripRadius` lying on its palm.
 *
 * Mutates the hand's finger joint rotations and returns where the weapon should go. Runs once
 * per equip.
 */
export function solveGrip(hand: BuiltModel, gripRadius: number): GripSolve | null {
  const root = hand.group;
  const palm = hand.slots.get('palm_anchor');
  const palmUp = hand.slots.get('palm_up');
  const gripAxis = hand.slots.get('grip_axis');
  if (!palm || !palmUp || !gripAxis) {
    // Not an error — the AUTHORED hand has palm_anchor and palm_up but no grip_axis, so it
    // falls back to the v2 curl. Say which is missing rather than failing silently.
    if (import.meta.env.DEV && !warnedNoSolve) {
      warnedNoSolve = true;   // once: the viewmodel recomposes on every weapon change
      const missing = [['palm_anchor', palm], ['palm_up', palmUp], ['grip_axis', gripAxis]]
        .filter(([, v]) => !v).map(([k]) => k);
      console.warn('[grip] no solve — hand is missing', missing.join(', '));
    }
    return null;
  }

  // Flat pose first. The solve writes ABSOLUTE joint angles, so it must start from a known
  // zero — and starting flat is also what frees this from content/hand.ts's authored curl,
  // which was eyeballed for a hand that is no longer the one being posed.
  for (const chain of Object.values(CHAINS)) {
    for (const name of chain) hand.slots.get(name)?.rotation.set(0, 0, 0);
  }
  root.updateMatrixWorld(true);

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const P = new THREE.Vector3().setFromMatrixPosition(palm.matrixWorld).applyMatrix4(inv);
  const N = new THREE.Vector3(0, 1, 0)
    .transformDirection(_m.multiplyMatrices(inv, palmUp.matrixWorld)).normalize();
  const A = new THREE.Vector3(0, 1, 0)
    .transformDirection(_m.multiplyMatrices(inv, gripAxis.matrixWorld)).normalize();
  // A grip lies ACROSS the palm, so the axis must be perpendicular to the palm normal. Both
  // anchors are measured off a scan independently, so they arrive a couple of degrees out.
  A.addScaledVector(N, -A.dot(N)).normalize();

  // THE WHOLE POINT: one radius out from the palm surface, so the cylinder rests on it.
  const C = P.clone().addScaledVector(N, gripRadius);

  const wrapR = gripRadius + phalanxHalfThickness(hand);

  /** Signed gap between a joint's child and the cylinder surface, at joint angle `t`. */
  const gapAt = (joint: THREE.Object3D, child: THREE.Object3D, t: number): number => {
    joint.rotation.x = t;
    joint.updateMatrixWorld(true);
    _p.setFromMatrixPosition(child.matrixWorld).applyMatrix4(inv);
    return radial(_p, C, A, _r) - wrapR;
  };

  for (const chain of Object.values(CHAINS)) {
    for (let i = 0; i < chain.length - 1; i++) {
      const joint = hand.slots.get(chain[i]);
      const child = hand.slots.get(chain[i + 1]);
      if (!joint || !child) continue;
      const limit = LIMITS[Math.min(i, LIMITS.length - 1)];

      // Which way does THIS joint close? Whichever sign brings its child toward the cylinder.
      // Read it rather than assume: the sign depends on how the joint's own X axis happens to
      // sit against the grip axis, and for the thumb it is not the finger answer.
      const flat = gapAt(joint, child, 0);
      const dir = Math.abs(gapAt(joint, child, 0.05)) < Math.abs(gapAt(joint, child, -0.05))
        ? 1 : -1;

      // March out for a sign change — the child crossing the cylinder surface — then bisect.
      let lo = 0;
      let hi = 0;
      let flo = flat;
      let crossed = false;
      for (let k = 1; k <= MARCH; k++) {
        const t = dir * limit * (k / MARCH);
        const f = gapAt(joint, child, t);
        if (flo * f <= 0) { hi = t; crossed = true; break; }
        lo = t;
        flo = f;
      }
      if (crossed) {
        for (let k = 0; k < BISECT; k++) {
          const mid = (lo + hi) / 2;
          const f = gapAt(joint, child, mid);
          if (flo * f <= 0) hi = mid;
          else { lo = mid; flo = f; }
        }
        gapAt(joint, child, (lo + hi) / 2);
      } else {
        // Never reached the cylinder: closed as far as the joint allows. Honest, and visible in
        // the error report rather than hidden.
        gapAt(joint, child, lo);
      }
    }
  }

  // Measure what we actually got — the acceptance test for the whole system.
  root.updateMatrixWorld(true);
  const errors: Record<string, number> = {};
  let worst = 0;
  for (const chain of Object.values(CHAINS)) {
    for (let i = 1; i < chain.length; i++) {
      const node = hand.slots.get(chain[i]);
      if (!node) continue;
      _p.setFromMatrixPosition(node.matrixWorld).applyMatrix4(inv);
      const err = Math.abs(radial(_p, C, A, _r) - wrapR) * 1000;
      // Keyed off the node's own name, so the thumb's IP joint is not mislabelled a PIP and a
      // renamed slot shows up as a renamed row instead of silently vanishing.
      errors[chain[i].replace('finger_', '')] = +err.toFixed(1);
      worst = Math.max(worst, err);
    }
  }

  return { center: C, axis: A, radius: gripRadius, errors, worst: +worst.toFixed(1) };
}

/** Half the cross-section of a proximal phalanx — the finger's own thickness, so a bone wraps
 *  the cylinder at a real skin distance instead of intersecting it. Measured off the mesh,
 *  because it is a fact about the model rather than a number worth authoring. */
function phalanxHalfThickness(hand: BuiltModel): number {
  const mesh = hand.parts.get('finger_index') as THREE.Mesh | undefined;
  const geo = mesh?.geometry;
  if (!geo) return 0.008;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox;
  if (!b) return 0.008;
  return Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5;
}
