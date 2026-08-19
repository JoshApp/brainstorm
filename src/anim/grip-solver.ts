// ── THE GRIP ─────────────────────────────────────────────────────────────────
//
// The hand closes into ONE authored fist (content/grip-pose.ts) and exactly one number is
// solved: how far to close it, so the fist's hollow matches the weapon's grip.
//
// ── WHY THIS REPLACED A SOLVER ──────────────────────────────────────────────
//
// The previous version asked each joint, independently: rotate until the joint below you
// touches the grip cylinder. It worked, by its own measure — every fingertip 0.0mm off the
// hilt — and it kept producing hands that did not look like hands. Josh, on the last one: *"the
// index finger and ring finger are close but really far up on the grip and the thumb is kinda
// held like a kitchen knife spine reinforcement."*
//
// Both true, and neither visible to the metric. Contact distance cannot tell a grip from a set
// of fingers that happen to be the right distance from a line, so fifteen little optimisations
// each landed somewhere defensible and the whole read wrong. Every fix revealed the next wrong
// assumption under it: the palm side, the hilt depth, the thumb's target radius, the adduction.
// That is the shape of a problem being solved at the wrong level.
//
// A hand gripping is one coordinated shape, not fifteen independent distances. So it is authored
// as a shape, and the only thing left to compute is its size.
//
// ── WHAT IS STILL DERIVED, AND WHY ──────────────────────────────────────────
//
// WHERE the hilt sits, because that part was never what looked wrong and it is genuinely a fact
// about the hand rather than a taste call:
//
//   · the LEVEL along the hand — across the metacarpal heads, where a hilt crosses the palm
//   · the DEPTH through it — palm_anchor's own lean off the knuckle plane IS the hand's
//     thickness, so the hilt rests against the palm with the knuckles behind it
//
// Those two survive from the solver and are the only geometry left here.

import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import type { ResolvedGrip } from '../content/grip';
import { FIST, THUMB_OPPOSE, CURL_RANGE, CONVERGE, type FistPose }
  from '../content/grip-pose';

/** The JOINTS of each finger, knuckle first. The fingertip is an anchor, not a joint — it is the
 *  far end of the last bone, and the hollow is measured from it. */
const CHAINS: Record<keyof FistPose, string[]> = {
  thumb: ['finger_thumb', 'finger_thumb_ip'],
  index: ['finger_index', 'finger_index_pip', 'finger_index_dip'],
  middle: ['finger_middle', 'finger_middle_pip', 'finger_middle_dip'],
  ring: ['finger_ring', 'finger_ring_pip', 'finger_ring_dip'],
  pinky: ['finger_pinky', 'finger_pinky_pip', 'finger_pinky_dip'],
};

/** Bisection depth for the single curl solve. 14 steps splits the curl range finer than any
 *  angle a hand can be posed to and still read differently. */
const STEPS = 14;

export interface GripSolve {
  /** Where the weapon's grip_anchor should sit, in hand-root space — ON the palm, not in it. */
  center: THREE.Vector3;
  /** The grip axis, hand-frame. */
  axis: THREE.Vector3;
  radius: number;
  /** The curl scale the fist closed to. 1.0 = the authored pose exactly. */
  curl: number;
  /** Mean fingertip distance from the hilt surface, millimetres — mean, not worst, because the
   *  pose is authored and no single fingertip is being driven to zero. */
  contact: number;
  /** Fingertip span along the hilt, millimetres. */
  span: number;
}

const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _reach = new THREE.Vector3();
let warned = false;

/** Perpendicular offset of `p` from the line (c, a). `a` must be unit. */
function radial(p: THREE.Vector3, c: THREE.Vector3, a: THREE.Vector3, out: THREE.Vector3): number {
  out.subVectors(p, c);
  out.addScaledVector(a, -out.dot(a));
  return out.length();
}

interface Chain { finger: keyof FistPose; nodes: THREE.Object3D[]; tip: THREE.Object3D }

/**
 * Resolve finger chains for THIS hand.
 *
 * The fingertip anchor is looked up under both conventions on purpose: the baked bone hand
 * exports `finger_index_tip`, content/hand.ts authors `fingertip_index`. Same anchor, two
 * spellings, and a version that knew only one silently refused to pose the hand the game ships.
 */
function resolveChains(hand: BuiltModel): Chain[] {
  const out: Chain[] = [];
  for (const key of Object.keys(CHAINS) as Array<keyof FistPose>) {
    const nodes: THREE.Object3D[] = [];
    for (const name of CHAINS[key]) {
      const node = hand.slots.get(name);
      if (!node) break;
      nodes.push(node);
    }
    if (nodes.length !== CHAINS[key].length) continue;
    const tip = hand.slots.get(`finger_${key}_tip`) ?? hand.slots.get(`fingertip_${key}`);
    if (!tip) continue;
    out.push({ finger: key, nodes, tip });
  }
  return out;
}

/**
 * Close the hand around a cylinder of `grip.radius` lying on its palm.
 *
 * Mutates the finger joint rotations and returns where the weapon goes. Runs once per equip.
 */
export function solveGrip(hand: BuiltModel, grip: ResolvedGrip): GripSolve | null {
  const root = hand.group;
  const palm = hand.slots.get('palm_anchor');
  const chains = palm ? resolveChains(hand) : [];
  if (!palm || !chains.length) {
    if (import.meta.env.DEV && !warned) {
      warned = true;   // once: the viewmodel recomposes on every weapon change
      console.warn('[grip] no pose —',
        palm ? 'no finger chain resolved' : 'hand has no palm_anchor');
    }
    return null;
  }

  for (const c of chains) for (const node of c.nodes) node.quaternion.identity();
  root.updateMatrixWorld(true);

  // ── THE FRAME ─────────────────────────────────────────────────────────────
  //
  // Measured in the WRIST's frame, not the root's: the hand carries the authored wrist bend on
  // its `wrist` node, so everything below is rotated by it. In the root frame the grip axis came
  // out pointing down the fingers instead of across the palm.
  const frame = hand.slots.get('wrist') ?? root;
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const P = new THREE.Vector3().setFromMatrixPosition(palm.matrixWorld).applyMatrix4(inv);

  // `palm_anchor`'s +Y. composeHeldWeapon gives the weapon palm_anchor's whole rotation, so that
  // direction IS the hilt, and the fingers must close on the same cylinder the weapon occupies.
  const A = new THREE.Vector3(0, 1, 0)
    .transformDirection(_m.multiplyMatrices(inv, palm.matrixWorld)).normalize();

  // The knuckle line: the LEVEL along the hand where a hilt crosses the palm.
  const K = new THREE.Vector3();
  let knuckles = 0;
  for (const c of chains) {
    if (c.finger === 'thumb') continue;
    K.add(_p.setFromMatrixPosition(c.nodes[0].matrixWorld).applyMatrix4(inv));
    knuckles++;
  }
  if (knuckles) K.divideScalar(knuckles);
  else K.copy(P);

  // The palm normal's LINE is perpendicular to the grip axis and the fingers; which end is the
  // palm is answered directly by palm_anchor, which is authored as a point IN the palm.
  const F = K.clone().normalize();
  const N = new THREE.Vector3().crossVectors(F, A).normalize();
  if (_p.subVectors(P, K).dot(N) < 0) N.negate();

  // The DEPTH through the hand: palm_anchor's lean off the knuckle plane. The hilt rests against
  // the palm with the knuckles a hand's-thickness behind it.
  const depth = Math.max(0, _p.subVectors(P, K).dot(N));
  const C = K.clone().addScaledVector(N, depth + grip.radius);

  const wrapR = grip.radius + phalanxHalfThickness(hand);

  // ── APPLY THE FIST AT A GIVEN CURL ────────────────────────────────────────
  //
  // Every joint rotates about the GRIP AXIS, so each finger stays in its own plane across the
  // hilt and the fist keeps its authored shape at any size. The thumb additionally swings across
  // the hand about the palm normal — opposition, which does NOT scale with curl, because a thumb
  // opposes the same amount whatever it is holding.
  const frameQ = new THREE.Quaternion();
  frame.getWorldQuaternion(frameQ);
  const worldA = A.clone().applyQuaternion(frameQ).normalize();
  const worldN = N.clone().applyQuaternion(frameQ).normalize();
  const _pq = new THREE.Quaternion();

  const localAxis = (joint: THREE.Object3D, world: THREE.Vector3): THREE.Vector3 => {
    (joint.parent ?? frame).getWorldQuaternion(_pq).invert();
    return world.clone().applyQuaternion(_pq).normalize();
  };

  // Which way is "closing" for this hand? The sign that carries a fingertip toward the hilt.
  // Read ONCE, from the middle finger, and used for every joint — one hand does not close two
  // different ways, and reading it per joint is exactly how fingers ended up on opposite signs.
  let sign = 1;
  {
    const c = chains.find((x) => x.finger === 'middle') ?? chains[0];
    const joint = c.nodes[0];
    const axis = localAxis(joint, worldA);
    const at = (t: number): number => {
      joint.quaternion.setFromAxisAngle(axis, t);
      joint.updateMatrixWorld(true);
      _p.setFromMatrixPosition(c.nodes[1].matrixWorld).applyMatrix4(inv);
      return radial(_p, C, A, _r);
    };
    sign = at(0.25) < at(-0.25) ? 1 : -1;
    joint.quaternion.identity();
    root.updateMatrixWorld(true);
  }

  // ── ADDUCTION, MEASURED WHILE THE HAND IS STILL OPEN ──────────────────────
  //
  // Josh: *"the four fingers that arent the thumb are still spread like a claw instead of a
  // gripped fist."* Curling cannot fix that on its own — every joint bends about the grip axis,
  // which keeps each finger in its own plane, so all four stay at the spacing of the knuckle row
  // and the knuckle row is the widest part of a hand.
  //
  // The yaw is worked out HERE, with the fingers extended, and applied BEFORE the curl. Doing it
  // afterwards does almost nothing: measured, sensible-looking yaws of 16°/2°/-6°/-14° moved the
  // fingertip span 39mm to 35mm, because a curled fingertip is tucked in toward the palm and a
  // yaw about the palm normal can no longer carry it sideways. A hand adducts AS it closes.
  const yawOf = new Map<keyof FistPose, number>();
  {
    const four = chains.filter((c) => c.finger !== 'thumb');
    const axialOf = (o: THREE.Object3D): number =>
      _p.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv).sub(C).dot(A);
    const knuckle = four.map((c) => axialOf(c.nodes[0]));
    const mean = knuckle.reduce((a, b) => a + b, 0) / (knuckle.length || 1);
    for (let i = 0; i < four.length; i++) {
      const c = four[i];
      const len = _p.setFromMatrixPosition(c.tip.matrixWorld)
        .distanceTo(_reach.setFromMatrixPosition(c.nodes[0].matrixWorld));
      if (len < 1e-6) continue;
      const shift = -CONVERGE * (knuckle[i] - mean);
      let yaw = Math.asin(THREE.MathUtils.clamp(shift / len, -1, 1));
      // Resolve the sign by trying it: which way a yaw about the palm normal carries a finger
      // depends on how that knuckle's frame sits, and every sign I have derived this session has
      // been wrong at least once.
      const axis = localAxis(c.nodes[0], worldN);
      const before = axialOf(c.tip);
      c.nodes[0].quaternion.setFromAxisAngle(axis, yaw);
      c.nodes[0].updateMatrixWorld(true);
      if (Math.abs(axialOf(c.tip) - (before + shift)) > Math.abs(shift)) yaw = -yaw;
      c.nodes[0].quaternion.identity();
      c.nodes[0].updateMatrixWorld(true);
      yawOf.set(c.finger, yaw);
    }
    root.updateMatrixWorld(true);
  }

  const pose = (curl: number): void => {
    for (const c of chains) {
      const angles = FIST[c.finger].joints;
      for (let i = 0; i < c.nodes.length; i++) {
        const joint = c.nodes[i];
        joint.quaternion.setFromAxisAngle(localAxis(joint, worldA), sign * angles[i] * curl);
        if (i === 0) {
          // `multiply`, not `premultiply`: this composes as curl-after-yaw, so the finger swings
          // together first and the curl then carries it round. Premultiplying would apply the
          // yaw to an already-curled finger, which is the version that did nothing.
          const yaw = c.finger === 'thumb'
            ? sign * THUMB_OPPOSE
            : yawOf.get(c.finger) ?? 0;
          if (yaw) joint.quaternion.multiply(_q.setFromAxisAngle(localAxis(joint, worldN), yaw));
        }
        joint.updateMatrixWorld(true);
      }
    }
    root.updateMatrixWorld(true);
  };

  /**
   * Mean distance of the PIP JOINTS from the hilt surface. Negative = closed past it.
   *
   * The PIP — the knuckle where the middle phalanx begins — because that is what presses on a
   * hilt, and because its distance from the axis depends on ONE angle, the MCP. That makes it
   * monotonic in curl, which is what a bisection needs.
   *
   * NOT the fingertip. In a real fist around a thin grip the tips do not rest on the hilt at
   * all: they curl PAST it into the palm, with the weapon trapped between the middle phalanges
   * and the palm. And not the middle phalanx's midpoint either — the midpoint of a chord sits
   * well inside the circle its ends lie on, so aiming it at the surface describes a looser grip
   * than it sounds like.
   *
   * Targeting the tips is why every version of this looked wrong. Measured on this hand, tip
   * distance is not even monotonic in curl — it goes 8.2mm inside at curl 0.45 and back to 8.6mm
   * outside at 1.55, because the finger wraps right around and comes out the far side. No
   * bisection can find a grip in that, and the poses it settled for were the shapes Josh kept
   * having to describe back to me.
   */
  const gap = (): number => {
    let sum = 0;
    let count = 0;
    for (const c of chains) {
      if (c.finger === 'thumb' || c.nodes.length < 3) continue;
      _p.setFromMatrixPosition(c.nodes[1].matrixWorld).applyMatrix4(inv);
      sum += radial(_p, C, A, _r) - wrapR;
      count++;
    }
    return count ? sum / count : 0;
  };

  // ── THE ONE NUMBER ────────────────────────────────────────────────────────
  //
  // Close the whole fist together until its hollow matches the hilt. Monotonic in curl, so a
  // plain bisection lands it — and because every finger scales as one, no amount of closing can
  // produce the index-up-the-guard, thumb-along-the-spine shapes the per-joint solver found.
  let lo = CURL_RANGE[0];
  let hi = CURL_RANGE[1];
  pose(lo);
  const openGap = gap();
  pose(hi);
  const shutGap = gap();
  let curl: number;
  if (openGap > 0 && shutGap < 0) {
    for (let k = 0; k < STEPS; k++) {
      const mid = (lo + hi) / 2;
      pose(mid);
      if (gap() > 0) lo = mid;
      else hi = mid;
    }
    curl = (lo + hi) / 2;
  } else {
    // The hilt is outside what this hand can close on. Take the nearer end and let the contact
    // number say so, rather than clamping quietly and reporting a grip.
    curl = Math.abs(openGap) <= Math.abs(shutGap) ? CURL_RANGE[0] : CURL_RANGE[1];
  }
  pose(curl);

  const contact = Math.abs(gap()) * 1000;
  const axial = chains.filter((c) => c.finger !== 'thumb')
    .map((c) => _p.setFromMatrixPosition(c.tip.matrixWorld).applyMatrix4(inv).sub(C).dot(A));
  const span = axial.length ? (Math.max(...axial) - Math.min(...axial)) * 1000 : 0;

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[grip] fist curl=${curl.toFixed(2)} contact=${contact.toFixed(1)}mm `
      + `span=${span.toFixed(0)}mm r=${(grip.radius * 1000).toFixed(0)}mm`);
  }

  const center = C.clone().applyMatrix4(frame.matrixWorld)
    .applyMatrix4(_m.copy(root.matrixWorld).invert());
  return { center, axis: A, radius: grip.radius, curl, contact, span };
}

/** Half the cross-section of a proximal phalanx — the finger's own thickness, so the fist wraps
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
