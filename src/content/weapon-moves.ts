// Weapon MOVESETS (docs/MOVE-TIMELINE.md) — the authoring layer over the move
// runtime. The CLASS owns a default moveset (every generic dagger inherits
// DAGGER_DEFAULT_MOVES); a SIGNATURE weapon overrides with its own (HARROW_MOVES).
// Poses are deltas off STANDARD_IDLE, matched to the hand-tuned dagger poses
// (weapon-animations.ts) so the feel carries over from the legacy animations.

import type { MoveSpec, MoveStep } from '../combat/move-timeline';

// ── DAGGER stab/slash vocabulary ────────────────────────────────────────────
const HOME = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };
// STAB — the blade tilts to AIM (rotX −1.30) and holds that aim while it thrusts
// (matched to daggerStabPose). Ready = wound back; apex = punched forward.
const READY = { x: -0.06, y: 0.05, z: 0.10,  rotX: -1.30, rotY: 0.15, rotZ: -0.40 };
const APEX  = { x: -0.06, y: 0.05, z: -0.22, rotX: -1.30, rotY: 0.15, rotZ: -0.40 };
const LUNGE_APEX = { x: -0.06, y: 0.05, z: -0.44, rotX: -1.30, rotY: 0.15, rotZ: -0.40 };
const RETREAT_READY = { x: -0.06, y: 0.06, z: 0.20,  rotX: -1.30, rotY: 0.15, rotZ: -0.40 };
const RETREAT_APEX  = { x: -0.06, y: 0.06, z: -0.06, rotX: -1.30, rotY: 0.15, rotZ: -0.40 };
// SLASH — a lateral cut (matched to daggerSlashPose): wound to one side, edge
// sweeps across. R sweeps left→right; L mirrors it.
const SLASH_R_WOUND  = { x: -0.42, y: 0.10, z: 0.06,  rotX: -0.55, rotY: 0.95,  rotZ: -0.40 };
const SLASH_R_STRIKE = { x: 0.42,  y: 0,    z: -0.10, rotX: -0.25, rotY: -0.95, rotZ: 0.25 };
const SLASH_L_WOUND  = { x: 0.42,  y: 0.10, z: 0.06,  rotX: -0.55, rotY: -0.95, rotZ: 0.40 };
const SLASH_L_STRIKE = { x: -0.42, y: 0,    z: -0.10, rotX: -0.25, rotY: 0.95,  rotZ: -0.25 };

// SNAP the strike (ease-out — leaps then settles, the hand-tuned dagger's feel);
// the retract/recovery stay smooth.
function stabMotion(ready: typeof READY, apex: typeof APEX): MoveSpec['motion'] {
  return {
    intro: [{ t: 0, pose: HOME, ease: 'out' }, { t: 1, pose: ready }],
    loop:  [{ t: 0, pose: ready, ease: 'out' }, { t: 0.22, pose: apex }, { t: 0.40, pose: apex }, { t: 1, pose: ready }],
    outro: [{ t: 0, pose: ready }, { t: 1, pose: HOME }],
  };
}
// ONE-WAY sweep (not a loop-back — that flops): wind, cut across, follow through.
function slashMotion(wound: typeof READY, strike: typeof APEX): MoveSpec['motion'] {
  return {
    intro: [{ t: 0, pose: HOME, ease: 'out' }, { t: 1, pose: wound }],
    loop:  [{ t: 0, pose: wound, ease: 'out' }, { t: 1, pose: strike }],
    outro: [{ t: 0, pose: strike }, { t: 1, pose: HOME }],
  };
}
const M_STAB    = stabMotion(READY, APEX);
const M_LUNGE   = stabMotion(READY, LUNGE_APEX);
const M_RETREAT = stabMotion(RETREAT_READY, RETREAT_APEX);
const M_SLASH_R = slashMotion(SLASH_R_WOUND, SLASH_R_STRIKE);
const M_SLASH_L = slashMotion(SLASH_L_WOUND, SLASH_L_STRIKE);

/** A dagger move: `n` reps of a motion, dealing `damageMul` per rip. Windup +
 *  recovery (introS/outroS) govern cadence; loopS is the per-rip rhythm. */
function dg(n: number, motion: MoveSpec['motion'], loopS: number, damageMul: number, hitAt = 0.30): MoveSpec {
  return { motion, timing: { introS: 0.12, loopS, outroS: 0.22 }, loopCount: n, hitAt, damageMul };
}

/** The directional OPENER shared by daggers: a single stab, flavored by movement
 *  — forward LUNGE, back RETREAT, side SLASHES. */
function daggerOpener(): MoveStep {
  return {
    neutral: dg(1, M_STAB,    0.20, 0.6),
    forward: dg(1, M_LUNGE,   0.16, 0.7),
    back:    dg(1, M_RETREAT, 0.20, 0.5),
    left:    dg(1, M_SLASH_L, 0.22, 0.8, 0.55),
    right:   dg(1, M_SLASH_R, 0.22, 0.8, 0.55),
  };
}

/** The DEFAULT dagger combo — thrust → cut → double-stab. Every generic dagger
 *  inherits this (class default); a signature dagger overrides it. */
export const DAGGER_DEFAULT_MOVES: MoveStep[] = [
  daggerOpener(),
  dg(1, M_SLASH_R, 0.22, 0.9, 0.55),   // a wider cut, hits harder
  dg(2, M_STAB,    0.16, 0.55),        // double-stab finisher
];

/** The HARROW's frenzy override — same vocabulary, a rapid TRIPLE finisher. */
export const HARROW_MOVES: MoveStep[] = [
  daggerOpener(),
  dg(1, M_SLASH_R, 0.22, 0.9, 0.55),
  dg(3, M_STAB,    0.13, 0.42),        // rapid triple flurry, weaker per rip
];

// ── SWORD vocabulary (wind/end deltas from weapon-animations.ts POSE_SPECS) ──
// A sword SLASHES: diagonal cuts, a reaching lunge, wide cleaving sweeps, a
// committed thrust. Heavier + more committal than a dagger (longer timings).
const SW_SLASH_R_WIND = { x: 0.10,  y: -0.15, z: 0.08,  rotX: 0.55,  rotY: 0,     rotZ: -0.10 };
const SW_SLASH_R_END  = { x: 0.18,  y: 0.10,  z: -0.24, rotX: -0.45, rotY: -0.10, rotZ: 0.50 };
const SW_SLASH_L_WIND = { x: -0.10, y: -0.15, z: 0.08,  rotX: 0.55,  rotY: 0,     rotZ: 0.10 };   // mirror of R
const SW_SLASH_L_END  = { x: -0.18, y: 0.10,  z: -0.24, rotX: -0.45, rotY: 0.10,  rotZ: -0.50 };
const SW_THRUST_WIND  = { x: -0.08, y: 0.10,  z: 0.12,  rotX: -1.15, rotY: 0.15,  rotZ: -0.40 };
const SW_THRUST_END   = { x: -0.08, y: 0.10,  z: -0.43, rotX: -1.15, rotY: 0.15,  rotZ: -0.40 };
const SW_LUNGE_WIND   = { x: -0.10, y: 0.14,  z: 0.16,  rotX: -1.30, rotY: 0.18,  rotZ: -0.45 };
const SW_LUNGE_END    = { x: -0.10, y: 0.14,  z: -0.64, rotX: -1.30, rotY: 0.18,  rotZ: -0.45 };
const SW_SWEEP_L_WIND = { x: 0.22,  y: 0.10,  z: 0.06,  rotX: -0.45, rotY: -0.55, rotZ: -0.85 };
const SW_SWEEP_L_END  = { x: -0.28, y: -0.16, z: -0.05, rotX: -0.30, rotY: 0.40,  rotZ: 1.00 };
const SW_SWEEP_R_WIND = { x: -0.22, y: 0.10,  z: 0.06,  rotX: -0.45, rotY: 0.55,  rotZ: 0.85 };
const SW_SWEEP_R_END  = { x: 0.28,  y: -0.16, z: -0.05, rotX: -0.30, rotY: -0.40, rotZ: -1.00 };
const SW_WARD_WIND    = { x: 0.04,  y: 0.18,  z: 0.10,  rotX: -0.30, rotY: -0.40, rotZ: -0.10 };
const SW_WARD_END     = { x: -0.10, y: 0.02,  z: -0.32, rotX: -0.95, rotY: 0.30,  rotZ: 0.40 };

const SM_SLASH_R = slashMotion(SW_SLASH_R_WIND, SW_SLASH_R_END);
const SM_SLASH_L = slashMotion(SW_SLASH_L_WIND, SW_SLASH_L_END);
const SM_THRUST  = stabMotion(SW_THRUST_WIND, SW_THRUST_END);   // out-and-back thrust
const SM_LUNGE   = stabMotion(SW_LUNGE_WIND, SW_LUNGE_END);
const SM_SWEEP_L = slashMotion(SW_SWEEP_L_WIND, SW_SWEEP_L_END);
const SM_SWEEP_R = slashMotion(SW_SWEEP_R_WIND, SW_SWEEP_R_END);
const SM_WARD    = slashMotion(SW_WARD_WIND, SW_WARD_END);

/** A sword move: single hit, committal timing; per-move damage/reach/cleave. */
function sw(motion: MoveSpec['motion'], damageMul: number, reachMul?: number, maxTargets?: number): MoveSpec {
  return { motion, timing: { introS: 0.16, loopS: 0.26, outroS: 0.30 }, loopCount: 1, hitAt: 0.5, damageMul, reachMul, maxTargets };
}

/** The DEFAULT sword combo — diagonal slash → opposite slash → thrust. The opener
 *  is directional: a reaching LUNGE forward, a defensive WARD back, wide cleaving
 *  SWEEPS on the strafes (single-target otherwise — blanket cleave was OP). */
export const SWORD_DEFAULT_MOVES: MoveStep[] = [
  {
    neutral: sw(SM_SLASH_R, 1.0),
    forward: sw(SM_LUNGE,   1.2, 1.5),       // step in, long reach
    back:    sw(SM_WARD,    0.8),            // give ground, defensive cut
    left:    sw(SM_SWEEP_L, 0.9, 1.0, 2),    // wide arc, cleaves two
    right:   sw(SM_SWEEP_R, 0.9, 1.0, 2),
  },
  sw(SM_SLASH_L, 1.0),                        // the opposite diagonal
  sw(SM_THRUST,  1.4, 1.25),                  // committed thrust finisher
];
