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

/** The JOINTS of each finger, knuckle first. The fingertip is not a joint and is resolved
 *  separately — it is the far end of the last bone, and without it that bone has no length and
 *  never closes. */
const CHAINS: Record<string, string[]> = {
  thumb: ['finger_thumb', 'finger_thumb_ip'],
  index: ['finger_index', 'finger_index_pip', 'finger_index_dip'],
  middle: ['finger_middle', 'finger_middle_pip', 'finger_middle_dip'],
  ring: ['finger_ring', 'finger_ring_pip', 'finger_ring_dip'],
  pinky: ['finger_pinky', 'finger_pinky_pip', 'finger_pinky_dip'],
};

/** A finger, resolved against whichever hand is being posed. */
interface Chain {
  finger: string;
  /** Joints, then the fingertip anchor. Length = joints + 1. */
  nodes: THREE.Object3D[];
  /** Report labels, one per node after the first. */
  labels: string[];
}

/**
 * Resolve the finger chains for THIS hand.
 *
 * The fingertip anchor is looked up under both conventions on purpose: the baked bone hand
 * exports `finger_index_tip`, content/hand.ts authors `fingertip_index`. Same anchor, two
 * spellings, and a solver that only knew one silently refused to pose the other — which is how
 * the whole contact system ran for a session without ever touching the hand the game ships.
 */
function resolveChains(hand: BuiltModel): Chain[] {
  const out: Chain[] = [];
  for (const [finger, joints] of Object.entries(CHAINS)) {
    const nodes: THREE.Object3D[] = [];
    const labels: string[] = [];
    for (const name of joints) {
      const node = hand.slots.get(name);
      if (!node) break;
      nodes.push(node);
      if (nodes.length > 1) labels.push(name.replace('finger_', ''));
    }
    if (nodes.length !== joints.length) continue;
    const tip = hand.slots.get(`finger_${finger}_tip`) ?? hand.slots.get(`fingertip_${finger}`);
    if (!tip) continue;
    nodes.push(tip);
    labels.push(`${finger}_tip`);
    out.push({ finger, nodes, labels });
  }
  return out;
}

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
let loggedAxial = false;

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
  // Ask only for what the solve READS. The guard used to demand `palm_up` and `grip_axis` too,
  // neither of which this function has touched since the axis moved to palm_anchor and the palm
  // normal became derived — so it was refusing to pose the authored hand over two slots it did
  // not need, and the whole contact solver only ever ran behind a DEV flag.
  const palm = hand.slots.get('palm_anchor');
  const chains = palm ? resolveChains(hand) : [];
  if (!palm || !chains.length) {
    if (import.meta.env.DEV && !warnedNoSolve) {
      warnedNoSolve = true;   // once: the viewmodel recomposes on every weapon change
      console.warn('[grip] no solve —',
        palm ? 'no finger chain resolved (joints or fingertip anchors missing)'
          : 'hand has no palm_anchor');
    }
    return null;
  }

  // Flat pose first. The solve writes ABSOLUTE joint angles, so it must start from a known
  // zero — and starting flat is also what frees this from content/hand.ts's authored curl,
  // which was eyeballed for a hand that is no longer the one being posed.
  for (const c of chains) {
    for (let i = 0; i < c.nodes.length - 1; i++) c.nodes[i].rotation.set(0, 0, 0);
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
  for (const c of chains) {
    if (c.finger === 'thumb') continue;      // the thumb is not on the knuckle line
    K.add(_p.setFromMatrixPosition(c.nodes[0].matrixWorld).applyMatrix4(inv));
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
  const _q3 = new THREE.Quaternion();
  const _q2 = new THREE.Vector3();

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
    /** Worst error over the FOUR FINGERS only — what the palm side is judged on. */
    fingersWorst: number;
    /** Fingertip span along the hilt BEFORE adduction, millimetres. */
    spreadBefore: number;
  }

  /** Close every finger onto a cylinder lying on the palm side `N`, and score the result. */
  const attempt = (N: THREE.Vector3): Attempt => {
    const worldN = N.clone().applyQuaternion(frameQ).normalize();
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

    for (const c of chains) {
      for (let i = 0; i < c.nodes.length - 1; i++) c.nodes[i].quaternion.identity();
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
    for (const c of chains) {
      // A thumb riding ALONG the haft does not close onto it — that is the whole difference
      // between a hammer's fist and a spear's thrust grip, and it is the one finger whose job
      // changes between them. Left flat, it points down the weapon.
      if (c.finger === 'thumb' && grip.thumb === 'along') continue;
      // A wrapped thumb does not touch the HILT — it crosses over the backs of the fingers
      // already wrapped around it, so it closes onto a circle one finger-thickness wider.
      // Demanding it reach the hilt itself drove both its joints to their limits and left it
      // 34mm out, which is the report politely describing a broken thumb.
      const target = c.finger === 'thumb' ? wrapR + 2 * half : wrapR;
      for (let i = 0; i < c.nodes.length - 1; i++) {
        const joint = c.nodes[i];
        const child = c.nodes[i + 1];
        const limit = LIMITS[Math.min(i, LIMITS.length - 1)];
        const axis = bendAxis(joint);

        // Which way does THIS joint CLOSE? The direction carrying its child toward the axis.
        // Read, not assumed — and NOT chosen by whichever direction reduces |distance − radius|,
        // because once a child starts inside the cylinder that rule picks hyperextension.
        const dir = radialAt(joint, child, axis, 0.05) < radialAt(joint, child, axis, -0.05)
          ? 1 : -1;

        if (radialAt(joint, child, axis, 0) <= target) { solved[c.labels[i]] = 0; continue; }

        let lo = 0;
        let hi = 0;
        let crossed = false;
        for (let k = 1; k <= MARCH; k++) {
          const t = dir * limit * (k / MARCH);
          if (radialAt(joint, child, axis, t) <= target) { hi = t; crossed = true; break; }
          lo = t;
        }
        if (crossed) {
          for (let k = 0; k < BISECT; k++) {
            const mid = (lo + hi) / 2;
            if (radialAt(joint, child, axis, mid) <= target) hi = mid;
            else lo = mid;
          }
          lo = (lo + hi) / 2;
        }
        // Not crossed = never reached the cylinder, so it closed as far as the joint allows.
        // Honest, and visible in the error report rather than hidden by a clamp.
        radialAt(joint, child, axis, lo);
        solved[c.labels[i]] = lo;
      }
    }

    root.updateMatrixWorld(true);
    const errors: Record<string, number> = {};
    let worst = 0;
    // ── FINGERS CLOSE TOGETHER, NOT JUST AROUND ─────────────────────────
    //
    // Josh, on the first clear look at it in game: "the grips is a bit too spread vertically."
    //
    // Exactly right, and nothing above could have fixed it. Every joint here bends ABOUT the
    // grip axis, which keeps each finger in its own plane perpendicular to the hilt — so all
    // four stay at whatever spacing their knuckles have. On this hand the knuckle line spans
    // ~100mm and the sword's usable grip is ~118mm, so the fist covers the entire hilt, index
    // at the guard and pinky at the pommel.
    //
    // Real fingers ADDUCT as they close: the knuckles stay put and the fingers converge, so a
    // closed fist is four fingers side by side, not four fingers spread across a span. That is
    // a yaw at each knuckle about the PALM NORMAL, perpendicular to everything the wrap solve
    // touches — which is why it composes cleanly on top rather than needing a re-solve.
    //
    // The target spacing is measured, not chosen: one finger's own thickness apart, packed and
    // centred on the fist.
    let spreadBefore = 0;
    {
      const others = chains.filter((c) => c.finger !== 'thumb');
      const axial = (n: THREE.Object3D): number =>
        _p.setFromMatrixPosition(n.matrixWorld).applyMatrix4(inv).sub(C).dot(A);
      // What the wrap alone leaves, so the adduction's effect is reported rather than asserted.
      const pre = others.map((c) => axial(c.nodes.at(-1) as THREE.Object3D));
      spreadBefore = (Math.max(...pre) - Math.min(...pre)) * 1000;
      if (import.meta.env.DEV && !loggedAxial) {
        loggedAxial = true;
        console.log('[grip] axial mm — knuckles',
          others.map((c) => (axial(c.nodes[0]) * 1000).toFixed(0)).join(','),
          '· tips', pre.map((v) => (v * 1000).toFixed(0)).join(','),
          '· finger width', (2 * half * 1000).toFixed(1));
      }
      const ranked = others
        .map((c) => ({ c, s: axial(c.nodes.at(-1) as THREE.Object3D) }))
        .sort((a, b) => a.s - b.s);
      const mid = ranked.reduce((acc, r) => acc + r.s, 0) / (ranked.length || 1);
      const width = 2 * half;
      // ADDUCTION ONLY EVER CLOSES A HAND. If the wrap has already left the fingertips closer
      // together than one finger-width apart, packing them "to" that width would SPREAD them —
      // which is what the first version did, measured, 39mm out to 45mm while claiming to be
      // fixing exactly that. On this hand the tips land 13mm apart with 16mm-wide fingers: they
      // are touching already, and the right amount of adduction is none.
      const packedMm = width * (ranked.length - 1) * 1000;
      if (spreadBefore > packedMm)
      for (let i = 0; i < ranked.length; i++) {
        const { c } = ranked[i];
        const mcp = c.nodes[0];
        const tip = c.nodes.at(-1) as THREE.Object3D;
        const want = mid + (i - (ranked.length - 1) / 2) * width;
        const reach = _p.setFromMatrixPosition(tip.matrixWorld)
          .distanceTo(_q2.setFromMatrixPosition(mcp.matrixWorld));
        if (reach < 1e-6) continue;
        const need = want - axial(tip);
        const yaw = Math.asin(THREE.MathUtils.clamp(need / reach, -1, 1));
        // Which sign of the yaw carries the tip the way we want depends on how this knuckle's
        // frame sits against the palm normal. Try one, keep it only if it helped — cheaper and
        // more honest than deriving a sign that has been wrong every time I have derived one.
        (mcp.parent ?? frame).getWorldQuaternion(_pq).invert();
        const nLocal = worldN.clone().applyQuaternion(_pq).normalize();
        const before = Math.abs(need);
        const before2 = mcp.quaternion.clone();
        mcp.quaternion.premultiply(_q3.setFromAxisAngle(nLocal, yaw));
        mcp.updateMatrixWorld(true);
        if (Math.abs(want - axial(tip)) > before) {
          mcp.quaternion.copy(before2).premultiply(_q3.setFromAxisAngle(nLocal, -yaw));
          mcp.updateMatrixWorld(true);
        }
      }
      root.updateMatrixWorld(true);
    }

    let fingersWorst = 0;
    for (const c of chains) {
      const target = c.finger === 'thumb' ? wrapR + 2 * half : wrapR;
      for (let i = 1; i < c.nodes.length; i++) {
        _p.setFromMatrixPosition(c.nodes[i].matrixWorld).applyMatrix4(inv);
        const err = Math.abs(radial(_p, C, A, _r) - target) * 1000;
        // Labelled from the chain, so the thumb's IP joint is not mislabelled a PIP and a
        // renamed slot shows up as a renamed row instead of silently vanishing.
        errors[c.labels[i - 1]] = +err.toFixed(1);
        worst = Math.max(worst, err);
        if (c.finger !== 'thumb') fingersWorst = Math.max(fingersWorst, err);
      }
    }
    return { C, solved, errors, worst, fingersWorst, spreadBefore };
  };

  // ── WHICH SIDE IS THE PALM? MEASURE IT ────────────────────────────────────
  //
  // F x A gives the normal's LINE; nothing in the geometry says which end is the palm and which
  // is the back of the hand, and every attempt to settle it from an authored sign has been wrong
  // at least once this session. So close the hand both ways and keep whichever actually reaches
  // the hilt. Three cheap solves, and a whole class of sign bug stops being possible.
  // F x A gives the normal's LINE; which end is the palm and which the back of the hand is a
  // separate question, and it has a direct answer: `palm_anchor` is authored as a point IN THE
  // PALM, so the palm side is simply whichever way it lies off the knuckle line.
  //
  // This replaces closing the hand both ways and keeping the lower contact error. That worked
  // until adduction, which improved both sides equally and left the comparison at 5.9 vs 5.8mm
  // — a coin flip deciding which side of a hand the palm is on. A projection of a few
  // centimetres is not a coin flip. The both-ways search stays as the fallback for a hand whose
  // palm anchor sits on the knuckle plane, where the projection genuinely says nothing.
  const lean = _p.subVectors(P, K).dot(N0) * 1000;      // mm off the knuckle plane
  let N: THREE.Vector3;
  let decided: string;
  if (Math.abs(lean) > 3) {
    N = lean >= 0 ? N0.clone() : N0.clone().negate();
    decided = `palm_anchor leans ${lean.toFixed(0)}mm`;
  } else {
    const up = N0.clone();
    const down = N0.clone().negate();
    const a = attempt(up);
    const b = attempt(down);
    N = a.fingersWorst <= b.fingersWorst ? up : down;
    decided = `contact ${a.fingersWorst.toFixed(1)} vs ${b.fingersWorst.toFixed(1)}mm`;
  }
  const { C, solved, errors, worst, spreadBefore } = attempt(N);

  // ── HOW FAR DOES THE FIST SPREAD ALONG THE HILT? ──────────────────────────
  //
  // The measurement for "the grip is a bit too spread vertically". Contact error cannot see it:
  // four fingers can each be 0.0mm off the cylinder while strung out along the whole grip.
  let span = 0;
  {
    const tips = chains.filter((c) => c.finger !== 'thumb')
      .map((c) => _p.setFromMatrixPosition((c.nodes.at(-1) as THREE.Object3D).matrixWorld)
        .applyMatrix4(inv).sub(C).dot(A));
    if (tips.length) span = (Math.max(...tips) - Math.min(...tips)) * 1000;
  }

  // ── DOES THE THUMB OPPOSE? ────────────────────────────────────────────────
  //
  // "0.0mm from the axis" is satisfied ANYWHERE around the cylinder, so the contact report alone
  // cannot tell a grip from a hand with every digit draped down one side. A grip is fingers on
  // one side and the thumb on the other; measure the angle between them about the grip axis.
  let opposition = 0;
  {
    const tip = chains.find((c) => c.finger === 'thumb')?.nodes.at(-1);
    const mid = chains.find((c) => c.finger === 'middle')?.nodes.at(-1);
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
      .map(([k, t]) => `${k}=${(t * 57.2958).toFixed(0)}`).join(' ');
    console.log(`[grip] A=${f3(A)} N=${f3(N)} C=${f3(C)} `
      + `(palm side by ${decided}) `
      + `thumb-opposition=${opposition.toFixed(0)}° span=${span.toFixed(0)}mm (wrap alone ${spreadBefore.toFixed(0)}mm) · ${deg}`);
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
