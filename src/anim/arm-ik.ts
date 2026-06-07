// 2-bone inverse kinematics for the player's arm — solves shoulder/elbow
// rotations each frame so the wrist tracks a moving target (the hand
// gripping a swinging weapon) while the shoulder stays roughly anchored
// off-screen.
//
// Three features beyond the textbook solver, all critical for not
// looking like a clamped rig:
//
//   1. SPRING-ANCHORED SHOULDER. A real shoulder isn't a fixed point —
//      a hard swing carries the body a little, then the inertia of
//      the torso pulls it back. The shoulder has a REST world position
//      and a critically-damped spring tugging it back; under fast
//      motion the spring biases it toward the hand direction (Josh's
//      "wiggle room") so the arm doesn't snap straight at full reach.
//
//   2. ELBOW POLE BIAS. The 2-bone elbow can bend either side of the
//      shoulder→hand line. A right arm's elbow biases DOWN-AND-OUT
//      (positive X, negative Y in camera space) so it doesn't flip
//      to the inside of the body when the hand reaches across. The
//      pole vector is a hint, not a hard constraint — when the hand
//      moves through the constraint zone the elbow swings through
//      naturally rather than locking.
//
//   3. TEMPORAL JOINT SMOOTHING. Instead of writing the IK solution
//      directly to each joint, we damp the joint angles toward the
//      solution with a configurable half-life. Frame-coherent: a
//      single bad IK frame can't snap the arm; smaller dt = tighter
//      tracking, larger = more lag. Uses the `damp()` exponential
//      decay so the smoothing is frame-rate-independent.
//
// All math is pure (no THREE dependency beyond Vector3 for math
// helpers); the caller writes the returned angles + shoulder pos
// onto the live rig.

import { Vector3 } from 'three';
import { damp, spring, makeSpring, type Spring1 } from './spring';

export interface ArmIKConfig {
  /** Shoulder REST world position (where the shoulder should sit at
   *  idle, in the same coordinate frame the caller uses for the hand
   *  target). */
  shoulderRest: [number, number, number];
  /** Spring frequency for shoulder follow-through (Hz). Higher = stiffer. */
  shoulderSpringFreq: number;
  /** Spring damping ratio (1 = critical, <1 = overshoot). */
  shoulderSpringDamping: number;
  /** How far the shoulder gets pulled toward the hand under motion (0..1).
   *  0 = fully anchored at rest; 1 = follows the hand entirely. */
  shoulderHandBias: number;
  /** Length of the humerus (shoulder → elbow), in metres. */
  humerusLength: number;
  /** Length of the forearm (elbow → wrist), in metres. */
  forearmLength: number;
  /** Preferred elbow pole DIRECTION (will be normalised). For a right
   *  arm in camera-local frame, ≈ (+1, -1, 0) — outboard and down. */
  elbowPole: [number, number, number];
  /** Half-life (seconds) for damping joint angles toward the IK target.
   *  Smaller = snappier, larger = more lag. */
  jointDampHalfLife: number;
}

export interface ArmIKResult {
  /** Shoulder's CURRENT world position (post-spring). */
  shoulderPos: Vector3;
  /** Elbow's CURRENT world position (analytic). */
  elbowPos: Vector3;
  /** Wrist's actual world position (= hand target, or clamped if
   *  unreachable). */
  wristPos: Vector3;
  /** Euler-XYZ rotation to apply to the shoulder slot (camera/parent local). */
  shoulderRot: [number, number, number];
  /** Euler-XYZ rotation to apply to the elbow slot (shoulder local). */
  elbowRot: [number, number, number];
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _pole = new Vector3();
const _bend = new Vector3();
const _humerusDir = new Vector3();
const _forearmDir = new Vector3();

export class ArmIK {
  private shoulderSpringX: Spring1;
  private shoulderSpringY: Spring1;
  private shoulderSpringZ: Spring1;
  // Damped joint angles — the solver writes the IK target into a
  // temporary, then damp pulls these toward it.
  private dampedShoulderRot: [number, number, number] = [0, 0, 0];
  private dampedElbowRot:    [number, number, number] = [0, 0, 0];

  constructor(public config: ArmIKConfig) {
    this.shoulderSpringX = makeSpring(config.shoulderRest[0]);
    this.shoulderSpringY = makeSpring(config.shoulderRest[1]);
    this.shoulderSpringZ = makeSpring(config.shoulderRest[2]);
  }

  /** Solve the arm so the wrist ends up at `handTarget`. Mutates internal
   *  springs/damped angles by `dt`; returns the rig pose to apply. */
  solve(handTarget: Vector3, dt: number): ArmIKResult {
    const c = this.config;
    const rest = c.shoulderRest;

    // ── 1. Spring-anchored shoulder ────────────────────────────────
    // The shoulder's IDEAL position is the rest pulled slightly toward
    // the hand. The spring then chases that ideal — for low-motion
    // frames the ideal IS the rest, so the spring settles there.
    const idealX = rest[0] + (handTarget.x - rest[0]) * c.shoulderHandBias;
    const idealY = rest[1] + (handTarget.y - rest[1]) * c.shoulderHandBias;
    const idealZ = rest[2] + (handTarget.z - rest[2]) * c.shoulderHandBias;
    const shoulderPos = _v1.set(
      spring(this.shoulderSpringX, idealX, c.shoulderSpringFreq, c.shoulderSpringDamping, dt),
      spring(this.shoulderSpringY, idealY, c.shoulderSpringFreq, c.shoulderSpringDamping, dt),
      spring(this.shoulderSpringZ, idealZ, c.shoulderSpringFreq, c.shoulderSpringDamping, dt),
    );

    // ── 2. Determine reach + elbow bend ────────────────────────────
    // Triangle: shoulder→elbow (humerus), elbow→wrist (forearm),
    // shoulder→wrist (the gap we need to close).
    const toHand = _v2.copy(handTarget).sub(shoulderPos);
    const gap = toHand.length();
    const maxReach = c.humerusLength + c.forearmLength;
    // Clamp the target inside the max reach (so we don't get NaNs on
    // overextension) but allow it to get very close to fully straight.
    const clampedGap = Math.min(gap, maxReach * 0.995);
    if (gap > 0) toHand.multiplyScalar(clampedGap / gap);
    const wristPos = _v3.copy(shoulderPos).add(toHand);

    // Law of cosines on the elbow's INTERIOR angle.
    const h = c.humerusLength;
    const f = c.forearmLength;
    const d = Math.max(0.0001, clampedGap);
    const cosE = Math.max(-1, Math.min(1, (h * h + f * f - d * d) / (2 * h * f)));
    const elbowInteriorAngle = Math.acos(cosE);     // 0 = bent shut, π = straight

    // Law of cosines on the SHOULDER's interior angle (between humerus and shoulder-hand line).
    const cosS = Math.max(-1, Math.min(1, (h * h + d * d - f * f) / (2 * h * d)));
    const shoulderInteriorAngle = Math.acos(cosS);

    // ── 3. Place the elbow using the pole bias ─────────────────────
    // Build an orthonormal frame from the shoulder→hand line + the pole
    // direction. The elbow sits in the plane those two define.
    _humerusDir.copy(toHand).normalize();
    _pole.set(c.elbowPole[0], c.elbowPole[1], c.elbowPole[2]).normalize();
    // Subtract the component of pole along the humerus direction so
    // _bend is perpendicular to humerusDir (the "elbow swings out this
    // way" axis).
    const polePerpDot = _pole.dot(_humerusDir);
    _bend.copy(_pole).addScaledVector(_humerusDir, -polePerpDot);
    if (_bend.lengthSq() < 1e-6) {
      // Pole aligned with humerus (degenerate) — pick a default bend.
      _bend.set(1, 0, 0);
      const fallbackDot = _bend.dot(_humerusDir);
      _bend.addScaledVector(_humerusDir, -fallbackDot);
    }
    _bend.normalize();
    // Elbow = shoulder + (along humerus) * (humerus * cos(shoulderAngle))
    //                  + (along bend)    * (humerus * sin(shoulderAngle))
    const alongHumerus = h * Math.cos(shoulderInteriorAngle);
    const alongBend    = h * Math.sin(shoulderInteriorAngle);
    const elbowPos = new Vector3()
      .copy(shoulderPos)
      .addScaledVector(_humerusDir, alongHumerus)
      .addScaledVector(_bend, alongBend);

    // ── 4. Derive Euler rotations for shoulder + elbow ─────────────
    // Shoulder rotation = align local +Y to (elbow - shoulder).
    _humerusDir.copy(elbowPos).sub(shoulderPos).normalize();
    const targetShoulder = eulerXYZFromYAxis(_humerusDir);

    // Elbow rotation = additional bend so the forearm points at wrist.
    // The forearm-local frame inherits the shoulder's rotation; the
    // elbow rotates further to bring +Y in line with (wrist - elbow).
    _forearmDir.copy(wristPos).sub(elbowPos).normalize();
    // Elbow's local axes after shoulder rotation: humerusDir is shoulder's +Y.
    // We compute the angle between humerusDir and forearmDir for the elbow bend,
    // and the axis of bending is perpendicular to both (= the bend axis).
    const elbowBend = Math.PI - elbowInteriorAngle;   // 0 = straight, π = folded
    // Elbow rotation around its local X axis bends the forearm in the YZ plane.
    // Approximation: assume the elbow's natural axis is X (consistent with
    // a human elbow). The bend amount is `elbowBend`; sign chosen so the
    // forearm goes toward the wrist (not opposite).
    const targetElbow: [number, number, number] = [-elbowBend, 0, 0];

    // ── 5. Temporal smoothing — damp current angles toward target ──
    const hl = c.jointDampHalfLife;
    this.dampedShoulderRot[0] = damp(this.dampedShoulderRot[0], targetShoulder[0], hl, dt);
    this.dampedShoulderRot[1] = damp(this.dampedShoulderRot[1], targetShoulder[1], hl, dt);
    this.dampedShoulderRot[2] = damp(this.dampedShoulderRot[2], targetShoulder[2], hl, dt);
    this.dampedElbowRot[0]    = damp(this.dampedElbowRot[0],    targetElbow[0],    hl, dt);
    this.dampedElbowRot[1]    = damp(this.dampedElbowRot[1],    targetElbow[1],    hl, dt);
    this.dampedElbowRot[2]    = damp(this.dampedElbowRot[2],    targetElbow[2],    hl, dt);

    return {
      shoulderPos: shoulderPos.clone(),
      elbowPos,
      wristPos: wristPos.clone(),
      shoulderRot: [this.dampedShoulderRot[0], this.dampedShoulderRot[1], this.dampedShoulderRot[2]],
      elbowRot: [this.dampedElbowRot[0], this.dampedElbowRot[1], this.dampedElbowRot[2]],
    };
  }
}

/** Euler XYZ that takes (0,1,0) to `yAxis`. Decomposes via spherical
 *  coords: tilt-around-X to set Y component, then twist-around-Z to
 *  set X component. Z rotation kept zero — caller composes their own
 *  roll on top. */
function eulerXYZFromYAxis(yAxis: Vector3): [number, number, number] {
  const n = yAxis.clone().normalize();
  // After rotZ φ then rotX θ applied to (0,1,0):
  //   X' = -sinφ * cosθ
  //   Y' =  cosφ * cosθ
  //   Z' =  sinθ
  // Given target (nx, ny, nz):
  const theta = Math.asin(Math.max(-1, Math.min(1, n.z)));     // rotX
  const cosTheta = Math.cos(theta);
  let phi = 0;
  if (Math.abs(cosTheta) > 1e-6) {
    phi = Math.atan2(-n.x / cosTheta, n.y / cosTheta);          // rotZ
  }
  return [theta, 0, phi];
}
