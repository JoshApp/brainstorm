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
import type { ResolvedGrip } from '../content/grip';

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
export function solveGrip(hand: BuiltModel, grip: ResolvedGrip): GripSolve | null {
  const gripRadius = grip.radius;
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

  // ── MEASURE IN THE WRIST'S FRAME, NOT THE ROOT'S ──────────────────────────
  //
  // The hand carries the authored wrist bend (NEW_WRIST_ROT) on its `wrist` node, so everything
  // below it — palm_anchor, palm_up, grip_axis, every knuckle — is rotated by that bend relative
  // to the root. Measured in the root frame the grip axis came out as [0.344, -0.873, -0.346]:
  // pointing DOWN THE FINGERS instead of across the palm, so the solver was closing fingers onto
  // a cylinder lying the wrong way and adjacent fingers disagreed about which way to curl.
  //
  // The grip is a fact about the HAND, not about how the wrist is currently cocked.
  const frame = hand.slots.get('wrist') ?? root;
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const P = new THREE.Vector3().setFromMatrixPosition(palm.matrixWorld).applyMatrix4(inv);

  // ── THE AXIS IS THE ONE THE WEAPON IS ON ──────────────────────────────────
  //
  // `palm_anchor`'s +Y. composeHeldWeapon gives the weapon palm_anchor's whole rotation, so
  // that direction IS the hilt — and the fingers must close on the SAME cylinder the weapon
  // occupies, or the two are solving different problems. (The scan's own `grip_axis` agrees
  // with it to a sign: [1, 0, 0.024] against [-0.914, 0.397, 0.079], both across the palm.)
  const A = new THREE.Vector3(0, 1, 0)
    .transformDirection(_m.multiplyMatrices(inv, palm.matrixWorld)).normalize();

  // ── THE PALM NORMAL IS DERIVED, NOT READ ──────────────────────────────────
  //
  // NOT from `palm_up`: content/hand.ts authors it as identity relative to palm_anchor, so its
  // +Y is palm_anchor's +Y — the GRIP AXIS. Reading it as a normal fed the solver a cylinder
  // lying along the fingers, which is why they closed to their limits and disagreed about which
  // way to curl. The doc comment calls it "the palm's outward normal"; the data does not.
  //
  // Perpendicular to the grip axis and to the fingers is the only thing the palm normal can be.
  const K = new THREE.Vector3();
  let knuckles = 0;
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const j = hand.slots.get(`finger_${f}`);
    if (!j) continue;
    K.add(_p.setFromMatrixPosition(j.matrixWorld).applyMatrix4(inv));
    knuckles++;
  }
  if (knuckles) K.divideScalar(knuckles);
  else K.copy(P);
  const F = K.clone().sub(new THREE.Vector3()).normalize();     // wrist -> knuckle line
  const N0 = new THREE.Vector3().crossVectors(F, A).normalize();

  const half = phalanxHalfThickness(hand);
  const wrapR = gripRadius + half;

  // Bend every joint about the GRIP AXIS, not about its own local X.
  //
  // A finger wrapping a cylinder bends in the plane perpendicular to that cylinder's axis. A
  // joint's local X is only approximately that axis — and for the thumb it is nowhere near,
  // because opposition is the thumb turning about a different axis entirely.
  const frameQ = new THREE.Quaternion();
  frame.getWorldQuaternion(frameQ);
  const worldA = A.clone().applyQuaternion(frameQ).normalize();
  const _pq = new THREE.Quaternion();

  /** The grip axis expressed in a joint's PARENT frame — the axis it should bend about. */
  const bendAxis = (joint: THREE.Object3D): THREE.Vector3 => {
    (joint.parent ?? frame).getWorldQuaternion(_pq).invert();
    return worldA.clone().applyQuaternion(_pq).normalize();
  };

  interface Attempt {
    C: THREE.Vector3;
    solved: Record<string, number>;
    errors: Record<string, number>;
    worst: number;
  }

  /** Close every finger onto a cylinder lying on the palm side `N`, and score the result. */
  const attempt = (N: THREE.Vector3): Attempt => {
    // ── WHERE THE HILT LIES: THE KNUCKLES SAY WHEN, THE PALM SAYS HOW DEEP ──
    //
    // Two anchors, each used for the one thing it actually knows:
    //
    //   K (the metacarpal-head line) fixes the LEVEL along the hand. A hilt crosses the palm
    //     just under the knuckles, not down at the heel — resting it on palm_anchor put the
    //     axis 58mm from a knuckle whose proximal phalanx is 56mm, so no finger could reach and
    //     every one curled to its limit. That was "kinda a bit crippled".
    //
    //   palm_anchor fixes the DEPTH through the hand. Offsetting from the knuckles by a
    //     phalanx's own thickness instead put the axis 28mm out on a 22mm hilt — the knuckles
    //     pressed flat against it, so each finger had to wrap almost the whole way round and the
    //     bones tangled into a cage. A held hilt rests against the PALM, and the knuckles sit a
    //     palm-thickness behind it.
    //
    // So the depth is measured, not guessed: how far palm_anchor sits from the knuckle plane
    // along the palm normal is exactly the thickness of the hand through the metacarpals.
    const depth = Math.max(0, _p.subVectors(P, K).dot(N));
    const C = K.clone().addScaledVector(N, depth + gripRadius);

    for (const chain of Object.values(CHAINS)) {
      for (const name of chain) hand.slots.get(name)?.quaternion.identity();
    }
    root.updateMatrixWorld(true);

    /** Distance from a joint's child to the grip axis, with that joint bent by `t`. */
    const radialAt = (
      joint: THREE.Object3D, child: THREE.Object3D, axis: THREE.Vector3, t: number,
    ): number => {
      joint.quaternion.setFromAxisAngle(axis, t);
      joint.updateMatrixWorld(true);
      _p.setFromMatrixPosition(child.matrixWorld).applyMatrix4(inv);
      return radial(_p, C, A, _r);
    };

    const solved: Record<string, number> = {};
    for (const [finger, chain] of Object.entries(CHAINS)) {
      // A thumb riding ALONG the haft does not close onto it — that is the whole difference
      // between a hammer's fist and a spear's thrust grip, and it is the one finger whose job
      // changes between them. Left flat, it points down the weapon.
      if (finger === 'thumb' && grip.thumb === 'along') {
        for (const name of chain) solved[name] = 0;
        continue;
      }
      for (let i = 0; i < chain.length - 1; i++) {
        const joint = hand.slots.get(chain[i]);
        const child = hand.slots.get(chain[i + 1]);
        if (!joint || !child) continue;
        const limit = LIMITS[Math.min(i, LIMITS.length - 1)];
        const axis = bendAxis(joint);

        // Which way does THIS joint CLOSE? The direction carrying its child toward the axis.
        // Read, not assumed — and NOT chosen by whichever direction reduces |distance − radius|,
        // because once a child starts inside the cylinder that rule picks hyperextension.
        const dir = radialAt(joint, child, axis, 0.05) < radialAt(joint, child, axis, -0.05)
          ? 1 : -1;

        if (radialAt(joint, child, axis, 0) <= wrapR) { solved[chain[i]] = 0; continue; }

        let lo = 0;
        let hi = 0;
        let crossed = false;
        for (let k = 1; k <= MARCH; k++) {
          const t = dir * limit * (k / MARCH);
          if (radialAt(joint, child, axis, t) <= wrapR) { hi = t; crossed = true; break; }
          lo = t;
        }
        if (crossed) {
          for (let k = 0; k < BISECT; k++) {
            const mid = (lo + hi) / 2;
            if (radialAt(joint, child, axis, mid) <= wrapR) hi = mid;
            else lo = mid;
          }
          lo = (lo + hi) / 2;
        }
        // Not crossed = never reached the cylinder, so it closed as far as the joint allows.
        // Honest, and visible in the error report rather than hidden by a clamp.
        radialAt(joint, child, axis, lo);
        solved[chain[i]] = lo;
      }
    }

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
    return { C, solved, errors, worst };
  };

  // ── WHICH SIDE IS THE PALM? MEASURE IT ────────────────────────────────────
  //
  // F x A gives the normal's LINE; nothing in the geometry says which end is the palm and which
  // is the back of the hand, and every attempt to settle it from an authored sign has been wrong
  // at least once this session. So close the hand both ways and keep whichever actually reaches
  // the hilt. Three cheap solves, and a whole class of sign bug stops being possible.
  const up = N0.clone();
  const down = N0.clone().negate();
  const first = attempt(up);
  const second = attempt(down);
  const N = first.worst <= second.worst ? up : down;
  const { C, solved, errors, worst } = attempt(N);

  // ── DOES THE THUMB OPPOSE? ────────────────────────────────────────────────
  //
  // "0.0mm from the axis" is satisfied ANYWHERE around the cylinder, so the contact report alone
  // cannot tell a grip from a hand with every digit draped down one side. A grip is fingers on
  // one side and the thumb on the other; measure the angle between them about the grip axis.
  let opposition = 0;
  {
    const tip = hand.slots.get('finger_thumb_tip');
    const mid = hand.slots.get('finger_middle_tip');
    if (tip && mid) {
      const a = _p.setFromMatrixPosition(tip.matrixWorld).applyMatrix4(inv).sub(C);
      a.addScaledVector(A, -a.dot(A));
      const b = new THREE.Vector3().setFromMatrixPosition(mid.matrixWorld)
        .applyMatrix4(inv).sub(C);
      b.addScaledVector(A, -b.dot(A));
      if (a.lengthSq() > 1e-9 && b.lengthSq() > 1e-9) {
        opposition = a.angleTo(b) * 57.2958;
      }
    }
  }

  if (import.meta.env.DEV) {
    const f3 = (v: THREE.Vector3): string =>
      `[${v.toArray().map((n: number) => n.toFixed(2)).join(',')}]`;
    const deg = Object.entries(solved)
      .map(([k, t]) => `${k.replace('finger_', '')}=${(t * 57.2958).toFixed(0)}`).join(' ');
    console.log(`[grip] A=${f3(A)} N=${f3(N)} C=${f3(C)} `
      + `(palm side ${first.worst <= second.worst ? '+' : '-'}: `
      + `${first.worst.toFixed(1)} vs ${second.worst.toFixed(1)}mm) `
      + `thumb-opposition=${opposition.toFixed(0)}° · ${deg}`);
  }

  // The caller places the weapon in the composition ROOT's frame, so hand the centre back there.
  const center = C.clone().applyMatrix4(frame.matrixWorld)
    .applyMatrix4(_m.copy(root.matrixWorld).invert());
  return { center, axis: A, radius: gripRadius, errors, worst: +worst.toFixed(1) };
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
