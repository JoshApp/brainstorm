// ── THE FLOATING-HAND RIG ────────────────────────────────────────────────────
//
// Josh: *"can we just throw away the arms premises and make the system just floating hands? all
// we need is a hand properly holding the lamp and a hand holding a weapon."*
//
// So this is the whole viewmodel limb system now: a hand is a POSITION and an ORIENTATION under
// the camera, sprung so it lags and settles. There is no shoulder, no elbow, no forearm, no
// two-bone solve, no reach limit, no pole vector, and nothing that has to stay anatomical with
// respect to a limb nobody draws.
//
// ── WHAT THE ARM WAS ACTUALLY COSTING ───────────────────────────────────────
//
// It was not costing frames; it was costing CONTROL. The old rig ran a two-bone IK to a wrist
// target and then re-aimed the hand each frame so the forearm would leave the wrist at an
// anatomical angle. With the arm invisible that second step is a rotation applied for a reason
// the player cannot see — and on the weapon hand it actively fought the animation, because a
// hand gripping a hilt must turn WITH the hilt, and the solver kept turning it toward a phantom
// elbow instead. Every pose became a negotiation with a limb that was not there.
//
// A pose is now two facts, both of them ones the player reads directly: where the hand is, and
// which way it faces. That is the entire authoring surface.
//
// ── WHAT IS KEPT, BECAUSE IT WAS THE GOOD PART ──────────────────────────────
//
// The old shoulder had a spring on it, and that spring is why the hand lagged the camera and
// settled instead of teleporting — the difference between a held object and a decal. It is kept,
// as ONE spring on the hand's position, with the two knobs a spring actually has. What is
// dropped is the machinery that existed to keep an unseen limb honest.
//
// ── ORIENTATION IS AUTHORED AS ANATOMY ──────────────────────────────────────
//
// Not as Euler decimals and not as the model's local axes — a hand's axes are not its anatomy
// (the fingers hang off an authored wrist bend, and +Z is the palm on one hand and the back of
// it on the other). `aimHand` measures the hand's own frame from landmarks and solves for the
// rotation; a rest pose says "fingers this way, palm that way" and means it. See
// floating-hands.ts for the measurement and why it is handedness-proof.

import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import { aimHand } from './floating-hands';

/** How a hand is held: where it is, and which way it faces. Camera-local. */
export interface HandRest {
  /**
   * Where the hand's GRIP POINT sits — the thing it holds, not the wrist. Authoring the grip
   * means moving a lantern moves the lantern; the hand follows it rather than needing to be
   * re-tuned behind it.
   */
  pos: THREE.Vector3;
  /** Which way the fingers point. */
  fingersTo: THREE.Vector3;
  /** Which way the palm faces. Orthogonalised against `fingersTo`, so it can be named loosely. */
  palmTo: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _target = new THREE.Vector3();
const _scratch = new THREE.Vector3();

export class HandRig {
  /** The hand's parent. Position and orientation are written here; the hand sits at identity. */
  readonly anchor = new THREE.Group();

  private hand: BuiltModel | null = null;
  private rest: HandRest | null = null;
  /** Where the held thing sits IN THE HAND — the solved grip centre, hand-local. */
  private gripLocal = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private settled = false;

  /**
   * @param freq    Spring frequency, Hz-ish. Higher = the hand keeps up with the camera more
   *                tightly. Around 6 reads as "held firmly", around 2 as "dangling".
   *
   * Always CRITICALLY damped — a viewmodel hand should settle, never wobble — so there is no
   * damping knob to get wrong.
   */
  constructor(
    parent: THREE.Object3D,
    name: string,
    private readonly freq = 6,
  ) {
    this.anchor.name = name;
    parent.add(this.anchor);
  }

  /**
   * Mount a hand and solve its orientation from the rest pose.
   *
   * Safe to call again when the hand is swapped (the scanned hand arrives asynchronously) — the
   * previous hand is DETACHED, never disposed: buildModel geometry is pooled and its materials
   * shared, so disposing frees buffers other models are still drawing with.
   */
  setHand(hand: BuiltModel, rest: HandRest): void {
    if (this.hand && this.hand !== hand) this.hand.group.removeFromParent();
    this.hand = hand;
    this.rest = rest;
    this.anchor.add(hand.group);
    hand.group.position.set(0, 0, 0);
    hand.group.quaternion.identity();
    this.anchor.updateWorldMatrix(true, true);
    const q = aimHand(hand, this.anchor, rest.fingersTo, rest.palmTo);
    if (q) this.anchor.quaternion.copy(q);
  }

  /**
   * Where the held thing sits in the hand, hand-local — normally the grip solver's centre, which
   * is the axis of the cylinder the fingers closed on. Null means the hand's own origin.
   */
  setGrip(local: THREE.Vector3 | null): void {
    if (local) this.gripLocal.copy(local);
    else this.gripLocal.set(0, 0, 0);
  }

  /** The grip point's position in the anchor's PARENT frame, at the anchor's current rotation. */
  private gripOffset(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.gripLocal).applyQuaternion(this.anchor.quaternion);
  }

  /**
   * Advance one frame.
   *
   * `target` overrides the rest position for this frame (a held object that moves, an animation
   * offset); omit it and the hand springs back to rest. The spring acts on the GRIP point, so
   * the anchor is placed behind it by the grip offset — that is what keeps the lantern's bail,
   * not the wrist, on the number the pose authored.
   */
  tick(dt: number, target?: THREE.Vector3): void {
    if (!this.rest) return;
    _target.copy(target ?? this.rest.pos).sub(this.gripOffset(_v));

    // FIRST FRAME SNAPS. A spring starting from the origin sweeps the hand across the whole
    // frame on the first descent, which reads as the hand flying in from the corner.
    if (!this.settled) {
      this.settled = true;
      this.anchor.position.copy(_target);
      this.vel.set(0, 0, 0);
      return;
    }

    // ── CRITICALLY DAMPED, ANALYTICALLY ─────────────────────────────────────
    //
    // NOT a hand-rolled explicit integrator. The first version of this was semi-implicit Euler
    // with a `1 - 2*damping*w*h` term, which is stable only while `w*h` stays small — and at
    // freq 8 on a 60Hz frame `w*h` is 0.84, so that factor goes NEGATIVE and the spring
    // diverges. It did not look like a diverging spring; it looked like the hand sitting 193mm
    // off the lantern, which is the kind of "tuning problem" that is really an arithmetic one.
    //
    // This is the closed-form solution for a critically damped spring over a timestep (Juckett's
    // formulation), which is exact at any step size and cannot blow up. Critically damped by
    // construction: a viewmodel hand should settle, never overshoot and wobble.
    const h = Math.min(Math.max(dt, 0), 1 / 20);
    if (h <= 0) return;
    const w = this.freq * Math.PI * 2;
    const decay = Math.exp(-w * h);
    _v.copy(this.anchor.position).sub(_target);                    // displacement from target
    const temp = _scratch.copy(this.vel).addScaledVector(_v, w).multiplyScalar(h);
    this.anchor.position.copy(_target).add(_v.add(temp).multiplyScalar(decay));
    this.vel.addScaledVector(temp, -w).multiplyScalar(decay);
  }

  /** The grip point in WORLD space — what a held object follows. */
  getGripWorld(out: THREE.Vector3): THREE.Vector3 {
    this.anchor.updateWorldMatrix(true, false);
    return out.copy(this.gripLocal).applyMatrix4(this.anchor.matrixWorld);
  }

  /** Drop the hand and the anchor. Detach only — pooled geometry, shared materials. */
  detach(): void {
    this.hand?.group.removeFromParent();
    this.hand = null;
    this.anchor.removeFromParent();
  }
}
