import * as THREE from 'three';
import type { Vec3Tuple } from './orient';

// Runtime wrist aim — the LIVE form of orient.ts's
// retargetLocalDirection().
//
// The static version bakes a measured forearm-exit direction into the
// hand spec; it silently rots when any coupled constant (idle pose,
// shoulder anchor, elbow pole, lamp position) moves — exactly the
// drift class that detached the lantern hand from its ring. This
// class solves the same minimal-arc retarget every frame against the
// IK's actual elbow, so the wrist stays anatomical no matter where
// the arm ends up:
//
//   - `desiredExitLocal` — where the forearm SHOULD leave the wrist,
//     in the hand-root frame (e.g. 5° ulnar + 15° extension for the
//     saber; near-straight for the lantern carry). This is the only
//     authored input — anatomy as data.
//   - each frame: measure where the forearm ACTUALLY is (elbow −
//     wrist from the IK), take the minimal arc from desired to
//     actual, clamp it to an anatomical max, and damp toward it.
//
// Minimal-arc preserves the roll around the exit axis (no twist
// accumulation: the arc is recomputed fresh from the BASELINE pose
// each frame, never integrated), the clamp keeps a degenerate IK
// frame from folding the hand, and the damping turns frame-to-frame
// IK jitter into organic follow-through.

export class WristAim {
  private readonly desired = new THREE.Vector3();   // hand-ROOT frame (see setDesiredFromWristFrame)
  private readonly maxArc: number;
  private readonly dampHalfLife: number;
  private readonly current = new THREE.Quaternion();
  private hasState = false;

  private readonly _toElbow = new THREE.Vector3();
  private readonly _exitInParent = new THREE.Vector3();
  private readonly _invParent = new THREE.Quaternion();
  private readonly _target = new THREE.Quaternion();
  private readonly _identity = new THREE.Quaternion();

  constructor(opts: {
    /** Forearm-exit direction in the hand-root frame (normalized here). */
    desiredExitLocal: Vec3Tuple;
    /** Max correction arc, radians. Default ~26° (real wrists give up there). */
    maxArcRad?: number;
    /** Damping half-life in seconds. Default 40ms — follows a swing,
     *  swallows IK jitter. */
    dampHalfLife?: number;
  }) {
    this.desired.set(...opts.desiredExitLocal).normalize();
    this.maxArc = opts.maxArcRad ?? 0.45;
    this.dampHalfLife = opts.dampHalfLife ?? 0.04;
  }

  /** Forget damped state (call on mount/equip so a new weapon doesn't
   *  inherit the previous one's correction mid-arc). */
  reset(): void {
    this.current.identity();
    this.hasState = false;
  }

  /**
   * Re-express the desired exit for the frame the solver actually
   * rotates. Poses author the exit in the WRIST frame (where the
   * anatomy measurement lives), but the solver re-aims the HAND ROOT
   * one level up — call this at mount with the wrist slot's
   * quaternion to map it: desired_root = q_wrist · desired_wrist.
   */
  setDesiredFromWristFrame(desiredWristLocal: Vec3Tuple, wristQuat: THREE.Quaternion): void {
    this.desired.set(...desiredWristLocal).applyQuaternion(wristQuat).normalize();
  }

  /**
   * Solve the hand-root LOCAL quaternion.
   *
   * @param parentQuat hand-parent orientation in the SAME frame as
   *                   elbow/wrist (for viewmodels: camera-local).
   * @param elbow,wrist live IK joint positions (camera-local).
   * @returns quaternion to assign to the hand root's `.quaternion`.
   */
  solve(
    parentQuat: THREE.Quaternion,
    elbow: THREE.Vector3,
    wrist: THREE.Vector3,
    dt: number,
  ): THREE.Quaternion {
    this._toElbow.subVectors(elbow, wrist);
    if (this._toElbow.lengthSq() < 1e-8) return this.current;
    this._toElbow.normalize();
    // Express the live forearm direction in the hand-PARENT frame; the
    // arc from `desired` to it is then directly the hand-root local
    // rotation that retargets the exit.
    this._invParent.copy(parentQuat).invert();
    this._exitInParent.copy(this._toElbow).applyQuaternion(this._invParent);
    this._target.setFromUnitVectors(this.desired, this._exitInParent);
    // Clamp the arc to anatomy.
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this._target.w)));
    if (angle > this.maxArc) {
      this._target.slerpQuaternions(this._identity, this._target, this.maxArc / angle);
    }
    if (!this.hasState || !(dt > 0)) {
      this.current.copy(this._target);
      this.hasState = true;
    } else {
      const a = 1 - Math.exp((-dt * Math.LN2) / this.dampHalfLife);
      this.current.slerp(this._target, a);
    }
    return this.current;
  }
}
