import * as THREE from 'three';
import type { Clip, Pose, JointPose } from './types';
import type { Vec3 } from '../ecs/model-types';
import { ease } from './easing';

// Per-mob keyframe animator with TWO LAYERS:
//
//   - base     — locomotion. Idle when at rest, walk while chasing, crawl
//                in phase 2. Always playing (or null). Loops.
//   - override — ability poses. One-shot. When an ability fires, the
//                animator stretches the clip to fit the ability's full
//                window (windup + strike + recover) so the keyframe at
//                t=0.55-ish is naturally the windup peak, t=0.70 is the
//                strike pose, t=1.0 is back to rest.
//
// Layer rule per joint (NOT additive blending):
//   - If override has a value for this joint, override WINS (weighted by
//     a short fade-in/fade-out envelope so the transition doesn't pop).
//   - Otherwise the joint stays on the base layer.
//
// This split = "upper body owns the sweep, legs keep walking under it"
// for free, without authoring a single combined clip per ability.
//
// Costs ~12 joints × a few interpolations + 12 Object3D.rotation writes
// per frame. Negligible on mobile next to lights/shadows.

const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();

interface JointEntry {
  obj: THREE.Object3D;
  restRot: THREE.Euler;
  restPos: THREE.Vector3;
}

interface ActiveBase {
  clip: Clip;
  duration: number;
  t: number;
}

interface ActiveOverride extends ActiveBase {
  fadeIn: number;
  fadeOut: number;
}

export class Animator {
  private joints = new Map<string, JointEntry>();
  private base: ActiveBase | null = null;
  private override: ActiveOverride | null = null;

  constructor(slots: Map<string, THREE.Object3D>, jointNames: readonly string[]) {
    for (const name of jointNames) {
      const obj = slots.get(name);
      if (!obj) continue;        // animation refs an unknown joint — silently skip
      this.joints.set(name, {
        obj,
        restRot: obj.rotation.clone(),
        restPos: obj.position.clone(),
      });
    }
  }

  /** Switch the locomotion layer. No-op if the same clip is already playing. */
  setBase(clip: Clip | null): void {
    if (this.base?.clip.id === clip?.id) return;
    this.base = clip ? { clip, duration: clip.duration, t: 0 } : null;
  }

  /** Fire a one-shot ability pose. `durationSec` stretches the normalized
   *  keyframes to fit the ability's real window. */
  playOverride(clip: Clip, durationSec: number): void {
    const fadeIn = Math.min(0.08, durationSec * 0.06);
    const fadeOut = Math.min(0.15, durationSec * 0.12);
    this.override = { clip, duration: durationSec, t: 0, fadeIn, fadeOut };
  }

  /** Drop any active override immediately (e.g. interrupted by stagger). */
  cancelOverride(): void {
    this.override = null;
  }

  update(dt: number): void {
    // Advance times.
    if (this.base) {
      this.base.t += dt;
      if (this.base.clip.loop) {
        if (this.base.t > this.base.duration) this.base.t -= this.base.duration;
      } else if (this.base.t > this.base.duration) {
        this.base.t = this.base.duration;
      }
    }
    let overWeight = 0;
    if (this.override) {
      this.override.t += dt;
      if (this.override.t >= this.override.duration) {
        this.override = null;
      } else {
        overWeight = envelope(this.override);
      }
    }

    // Sample each layer once.
    const basePose = this.base ? sample(this.base.clip, this.base.t / this.base.duration) : null;
    const overPose = this.override ? sample(this.override.clip, this.override.t / this.override.duration) : null;

    // Write to every joint we own, even if neither layer touches it — so a
    // joint a previous override moved snaps back to rest when the clip ends.
    for (const [name, j] of this.joints) {
      writeJoint(j, basePose?.[name], overPose?.[name], overWeight);
    }
  }
}

/** Apply rest + layered deltas to one joint. */
function writeJoint(j: JointEntry, base: JointPose | undefined, over: JointPose | undefined, w: number): void {
  // Rotation — combine via quaternions so additive Euler doesn't gimbal-walk.
  const restR = j.restRot;
  if (!base && !over) {
    j.obj.rotation.set(restR.x, restR.y, restR.z);
  } else {
    const bx = base?.rot?.[0] ?? 0, by = base?.rot?.[1] ?? 0, bz = base?.rot?.[2] ?? 0;
    const ox = over?.rot?.[0] ?? 0, oy = over?.rot?.[1] ?? 0, oz = over?.rot?.[2] ?? 0;
    let rx: number, ry: number, rz: number;
    if (!over) { rx = bx; ry = by; rz = bz; }
    else if (!base) { rx = ox * w; ry = oy * w; rz = oz * w; }
    else { rx = bx * (1 - w) + ox * w; ry = by * (1 - w) + oy * w; rz = bz * (1 - w) + oz * w; }
    // Apply delta = rest * delta (rest first).
    _euler.set(restR.x, restR.y, restR.z, restR.order);
    _qA.setFromEuler(_euler);
    _euler.set(rx, ry, rz, 'XYZ');
    _qB.setFromEuler(_euler);
    _q.multiplyQuaternions(_qA, _qB);
    j.obj.quaternion.copy(_q);
  }
  // Position — only used by pelvis-style bob; pure additive.
  const restP = j.restPos;
  const bp = base?.pos, op = over?.pos;
  if (!bp && !op) {
    j.obj.position.set(restP.x, restP.y, restP.z);
  } else {
    const bx = bp?.[0] ?? 0, by = bp?.[1] ?? 0, bz = bp?.[2] ?? 0;
    const ox = op?.[0] ?? 0, oy = op?.[1] ?? 0, oz = op?.[2] ?? 0;
    let px: number, py: number, pz: number;
    if (!op) { px = bx; py = by; pz = bz; }
    else if (!bp) { px = ox * w; py = oy * w; pz = oz * w; }
    else { px = bx * (1 - w) + ox * w; py = by * (1 - w) + oy * w; pz = bz * (1 - w) + oz * w; }
    j.obj.position.set(restP.x + px, restP.y + py, restP.z + pz);
  }
}

/** Sample a clip's keyframes at normalized time `u` ∈ [0,1]. */
function sample(clip: Clip, u: number): Pose {
  const kfs = clip.keyframes;
  if (kfs.length === 0) return {};
  if (kfs.length === 1) return kfs[0].pose;
  // Bracketing keyframes.
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t <= u) i++;
  const a = kfs[i];
  const b = kfs[Math.min(i + 1, kfs.length - 1)];
  if (a === b) return a.pose;
  const span = b.t - a.t;
  let local = span > 0 ? (u - a.t) / span : 0;
  if (local < 0) local = 0; else if (local > 1) local = 1;
  // Per-keyframe ease (on the destination kf) wins — it's how a clip authors a
  // SNAP into the strike. Else fall back to the clip's smoothstep/linear.
  if (b.ease) local = ease(b.ease, local);
  else if (clip.smooth !== false) local = local * local * (3 - 2 * local);
  return lerpPose(a.pose, b.pose, local);
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  const keys = new Set<string>();
  for (const k of Object.keys(a)) keys.add(k);
  for (const k of Object.keys(b)) keys.add(k);
  for (const k of keys) {
    out[k] = lerpJoint(a[k], b[k], t);
  }
  return out;
}

function lerpJoint(a: JointPose | undefined, b: JointPose | undefined, t: number): JointPose {
  return {
    rot: lerpVec3(a?.rot, b?.rot, t),
    pos: lerpVec3(a?.pos, b?.pos, t),
  };
}

function lerpVec3(a: Vec3 | undefined, b: Vec3 | undefined, t: number): Vec3 | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function envelope(o: ActiveOverride): number {
  if (o.t < o.fadeIn) return o.t / o.fadeIn;
  const tail = o.duration - o.fadeOut;
  if (o.t > tail) return Math.max(0, (o.duration - o.t) / o.fadeOut);
  return 1;
}
