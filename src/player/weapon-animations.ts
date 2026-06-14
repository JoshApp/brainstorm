import { CONFIG } from '../config';
import type { PoseKey } from '../content/weapon-classes';
import type { SwingPhase } from './viewmodel';
import { evalPoseSpec, type PoseSpec, type Pose6 } from './weapon-pose-spec';
import { sampleClip } from '../anim/keyframes';
import { POSE_CLIPS } from '../content/clips-weapons';

// Per-step viewmodel pose curves. Each function takes the current
// phase + a normalised phase progress (0..1) and returns the local
// pose to apply on top of the idle rest pose.
//
// Pose units:
//   pos       metres, camera-local. +X right, +Y up, -Z forward.
//   rot       radians, applied in camera-local Euler.
//
// Most weapons share the SAME idle pose (CONFIG.SWORD_IDLE_POS /
// _ROT) so weapon swaps don't snap-rotate the held item. The wand
// is the exception — it idles upright like a staff. The walking
// bob (getBobOffset in viewmodel-bob.ts) layers on top of idle.
//
// The caller (viewmodel.ts) picks the pose KEY from the current
// combo step on the resolved weapon stats — pose key → curve here.

export interface WeaponPose {
  x: number; y: number; z: number;
  rotX: number; rotY: number; rotZ: number;
}

// SHOULDER PIVOT — populated by clip-based poses only (legacy + pose-
// spec poses leave it at zero). The viewmodel reads this each frame
// and writes it onto the shoulder slot's rotation; the whole arm +
// hand + weapon chain swings together (proven FPS technique). Kept
// separate from WeaponPose so existing pose-spec / legacy functions
// don't need to know about it.
export const shoulderPivot = { x: 0, y: 0, z: 0 };

const ix = CONFIG.SWORD_IDLE_POS[0];
const iy = CONFIG.SWORD_IDLE_POS[1];
const iz = CONFIG.SWORD_IDLE_POS[2];
const rx = CONFIG.SWORD_IDLE_ROT[0];
const ry = CONFIG.SWORD_IDLE_ROT[1];
const rz = CONFIG.SWORD_IDLE_ROT[2];

const scratch: WeaponPose = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };

// The shared rest pose for all hip-held weapons (everything but the wand, which
// idles upright). Data poses (POSE_SPECS) author their keyframes as deltas off
// this.
export const STANDARD_IDLE: Pose6 = { x: ix, y: iy, z: iz, rotX: rx, rotY: ry, rotZ: rz };

// ── DATA-DRIVEN POSES (the authoring surface) ────────────────────
// Poses authored as two keyframes (WIND/END deltas off STANDARD_IDLE) + the odd
// sine modifier — see weapon-pose-spec.ts. computeWeaponPose evaluates these
// before falling back to the hand-coded functions below, so new weapons can be
// authored as pure data. Every entry is pinned to its original function by
// tests/weapon-pose-spec.test.ts, so the data can't drift from the tuned anim.
// Poses that don't fit the envelope (sword-slash-left's discontinuity, the
// double-stab pulses, the crossbow reload dip, the wand tremble, the scythe
// spin) are intentionally absent and stay hand-coded.
const POSE_SPECS: Partial<Record<PoseKey, PoseSpec>> = {
  'sword-slash-right': {
    wind: { x: 0.10, y: -0.15, z: 0.08, rotX: 0.55, rotZ: -0.10 },
    end:  { x: 0.18, y: 0.10, z: -0.24, rotX: -0.45, rotY: -0.10, rotZ: 0.50 },
  },
  'sword-thrust': {
    wind: { x: -0.08, y: 0.10, z: 0.12, rotX: -1.15, rotY: 0.15, rotZ: -0.40 },
    end:  { x: -0.08, y: 0.10, z: -0.43, rotX: -1.15, rotY: 0.15, rotZ: -0.40 },
  },
  'sword-lunge-forward': {
    wind: { x: -0.10, y: 0.14, z: 0.16, rotX: -1.30, rotY: 0.18, rotZ: -0.45 },
    end:  { x: -0.10, y: 0.14, z: -0.64, rotX: -1.30, rotY: 0.18, rotZ: -0.45 },
  },
  'sword-sweep-left': {
    wind: { x: 0.22, y: 0.10, z: 0.06, rotX: -0.45, rotY: -0.55, rotZ: -0.85 },
    end:  { x: -0.28, y: -0.16, z: -0.05, rotX: -0.30, rotY: 0.40, rotZ: 1.00 },
  },
  'sword-sweep-right': {
    wind: { x: -0.22, y: 0.10, z: 0.06, rotX: -0.45, rotY: 0.55, rotZ: 0.85 },
    end:  { x: 0.28, y: -0.16, z: -0.05, rotX: -0.30, rotY: -0.40, rotZ: -1.00 },
  },
  'sword-ward-back': {
    wind: { x: 0.04, y: 0.18, z: 0.10, rotX: -0.30, rotY: -0.40, rotZ: -0.10 },
    end:  { x: -0.10, y: 0.02, z: -0.32, rotX: -0.95, rotY: 0.30, rotZ: 0.40 },
  },
  'sword-retreat-slash': {
    wind: { x: -0.04, y: 0.06, z: 0.08, rotX: -0.85, rotY: 0.10, rotZ: -0.25 },
    end:  { x: -0.04, y: 0.06, z: -0.28, rotX: -0.85, rotY: 0.10, rotZ: -0.25 },
  },
  'dagger-stab': {
    wind: { x: -0.06, y: 0.05, z: 0.10, rotX: -1.30, rotY: 0.15, rotZ: -0.40 },
    end:  { x: -0.06, y: 0.05, z: -0.22, rotX: -1.30, rotY: 0.15, rotZ: -0.40 },
  },
  'dagger-slash': {
    wind: { x: -0.42, y: 0.10, z: 0.06, rotX: -0.55, rotY: 0.95, rotZ: -0.40 },
    end:  { x: 0.42, y: 0.00, z: -0.10, rotX: -0.25, rotY: -0.95, rotZ: 0.25 },
  },
  'hammer-smash': {
    wind: { x: -0.10, y: 0.55, z: 0.08, rotX: 1.40, rotZ: -0.20 },
    end:  { x: 0.00, y: -0.30, z: -0.12, rotX: -1.10, rotZ: 0.25 },
  },
  'hammer-swing-left': {
    wind: { x: 0.40, y: 0.18, z: 0.18, rotZ: -1.15 },
    end:  { x: -0.45, y: 0.18, z: 0.18, rotZ: 1.45 },
    arcForwardPush: 0.42,
  },
  'hammer-swing-right': {
    wind: { x: -0.45, y: 0.18, z: 0.18, rotZ: 1.45 },
    end:  { x: 0.40, y: 0.18, z: 0.18, rotZ: -1.15 },
    arcForwardPush: 0.42,
  },
  'spear-thrust': {
    wind: { x: -0.10, y: 0.06, z: 0.12, rotX: 0.20, rotY: 0.15, rotZ: -0.34 },
    end:  { x: -0.10, y: 0.06, z: -0.30, rotX: 0.20, rotY: 0.15, rotZ: -0.34 },
    dropSin: 0.04,
  },
  'spear-lunge': {
    wind: { x: -0.10, y: 0.06, z: 0.12, rotX: 0.20, rotY: 0.15, rotZ: -0.34 },
    end:  { x: -0.10, y: 0.06, z: -0.50, rotX: 0.20, rotY: 0.15, rotZ: -0.34 },
    dropSin: 0.12,
  },
  'scythe-reap-right': {
    wind: { x: -0.26, y: 0.20, z: 0.10, rotX: -0.50, rotY: 0.65, rotZ: 1.00 },
    end:  { x: 0.30, y: -0.22, z: -0.08, rotX: -0.20, rotY: -0.45, rotZ: -1.10 },
  },
  'scythe-reap-left': {
    wind: { x: 0.26, y: 0.20, z: 0.10, rotX: -0.50, rotY: -0.65, rotZ: -1.00 },
    end:  { x: -0.30, y: -0.22, z: -0.08, rotX: -0.20, rotY: 0.45, rotZ: 1.10 },
  },
  'whip-crack-right': {
    wind: { x: 0.18, y: 0.10, z: 0.10, rotX: -0.40, rotY: -0.35, rotZ: -0.20 },
    end:  { x: 0.18, y: -0.05, z: -0.30, rotX: -0.90, rotY: 0.10, rotZ: -0.10 },
  },
  'whip-crack-left': {
    wind: { x: -0.18, y: 0.10, z: 0.10, rotX: -0.40, rotY: 0.35, rotZ: 0.20 },
    end:  { x: -0.18, y: -0.05, z: -0.30, rotX: -0.90, rotY: -0.10, rotZ: 0.10 },
  },
  'whip-wrap': {
    wind: { x: 0.24, y: 0.04, z: 0.10, rotX: -0.50, rotY: -0.40, rotZ: -0.40 },
    end:  { x: -0.24, y: -0.08, z: -0.20, rotX: -0.50, rotY: 0.40, rotZ: 0.40 },
  },
  'knife-throw': {
    wind: { x: 0.16, y: 0.04, z: 0.14, rotX: -0.65, rotY: -0.15, rotZ: -0.30 },
    end:  { x: -0.04, y: 0.12, z: -0.28, rotX: -1.20, rotY: 0.10, rotZ: 0.15 },
  },
  // ── FIST poses — unarmed punches. Authored as deltas off the shared
  // hip-held rest pose (the fist is "down by the body" the same way a
  // dagger or sword would be). All three end with the fist driven
  // forward in -Z; what differs is the wind path + the cock-back angle.
  'fist-jab': {
    // Snap forward. Minimal wind (it's a quick lead) and a clean
    // straight-line drive into the target.
    wind: { x: 0.02, y: 0.04, z: 0.06, rotX: -0.30, rotY: 0.05, rotZ: -0.15 },
    end:  { x: -0.10, y: 0.06, z: -0.32, rotX: -0.95, rotY: 0.10, rotZ: -0.10 },
  },
  'fist-cross': {
    // Body rotates into the punch — cock further back, drive across.
    wind: { x: 0.14, y: 0.06, z: 0.10, rotX: -0.20, rotY: 0.25, rotZ: -0.30 },
    end:  { x: -0.16, y: 0.08, z: -0.40, rotX: -1.10, rotY: -0.10, rotZ: -0.05 },
  },
  'fist-hook': {
    // Wide arc — wind out to the right, swing through to the left.
    wind: { x: 0.26, y: 0.10, z: 0.06, rotX: -0.40, rotY: -0.50, rotZ: -0.55 },
    end:  { x: -0.22, y: 0.06, z: -0.24, rotX: -0.65, rotY: 0.50, rotZ: 0.50 },
  },
};

/** Poses whose data spec is BORN data — they never had a hand-coded
 *  legacy function. The equivalence test below pins migrated specs
 *  against their original `legacyComputeWeaponPose` switch case, so
 *  data-native keys (which would fall through to the default case +
 *  fail the equivalence) are excluded from that loop. Add new
 *  data-native poses here as you author them. */
const DATA_NATIVE_POSE_KEYS = new Set<PoseKey>([
  'fist-jab',
  'fist-cross',
  'fist-hook',
]);

/** Pose keys whose data spec is pinned to a legacy hand-coded function
 *  (the equivalence oracle). Data-native specs are excluded; so are
 *  poses overridden by a ClipSpec (the new authoring path produces a
 *  richer curve than the wind/end form, and the legacy function is the
 *  oracle for that wind/end form — not for the clip).
 *  See src/content/clips-weapons.ts. */
export const MIGRATED_POSE_KEYS = (Object.keys(POSE_SPECS) as PoseKey[])
  .filter((k) => !DATA_NATIVE_POSE_KEYS.has(k) && !POSE_CLIPS[k]);

/** Pose for the current swing phase. Caller passes the pose key for
 *  the current combo step + the phase + the PROGRESS within that
 *  phase (0..1). Returns a shared scratch object — read it, don't
 *  retain. */
export function computeWeaponPose(pose: PoseKey, phase: SwingPhase, t: number): WeaponPose {
  // Reset the shared shoulder-pivot scratch — only clip-based poses
  // write it; legacy / pose-spec swings leave it at zero so the
  // shoulder stays at rest.
  shoulderPivot.x = 0; shoulderPivot.y = 0; shoulderPivot.z = 0;
  if (phase === 'idle') {
    // Idle = the rest pose for THIS weapon type. Default = hip-held
    // (sword/dagger/hammer/spear). Wand idle is upright like a
    // staff. Crossbow idle is the same rest pose for now.
    if (pose === 'wand-cast') {
      scratch.x = WAND_DRAW_X; scratch.y = WAND_DRAW_Y; scratch.z = WAND_DRAW_Z;
      scratch.rotX = WAND_DRAW_RX; scratch.rotY = ry; scratch.rotZ = WAND_DRAW_RZ;
      return scratch;
    }
    scratch.x = ix; scratch.y = iy; scratch.z = iz;
    scratch.rotX = rx; scratch.rotY = ry; scratch.rotZ = rz;
    return scratch;
  }
  // CLIP-based poses (the new authoring path) — richer than wind/end,
  // with anticipation pulses, peak holds, impact overshoot, settle
  // bobble. See src/content/clips-weapons.ts for the pose→clip table.
  const clip = POSE_CLIPS[pose];
  if (clip) return evalClipPose(clip, phase, t, scratch);
  // Data-driven poses (wind/end format); fall back to hand-coded ones.
  const spec = POSE_SPECS[pose];
  if (spec) return evalPoseSpec(spec, STANDARD_IDLE, phase, t, scratch);
  return legacyComputeWeaponPose(pose, phase, t);
}

// Phase boundaries inside the clip's normalized [0, 1] timeline. Authors
// keyframe to these conventions; the evaluator maps the live (phase, t)
// of the swing into the corresponding clip time. Approximates "windup
// ≈ strike ≈ recover × 2" which is roughly true across the existing
// weapon classes; per-weapon proportions are fudged inside the
// segments by where the author places the keyframes.
const CLIP_WINDUP_END = 0.25;
const CLIP_STRIKE_END = 0.50;

function evalClipPose(
  clip: { duration?: number; tracks: Record<string, Array<{ t: number; v: number; ease?: string }>> },
  phase: SwingPhase,
  t: number,
  out: WeaponPose,
): WeaponPose {
  let clipT: number;
  if (phase === 'windup')      clipT = t * CLIP_WINDUP_END;
  else if (phase === 'strike') clipT = CLIP_WINDUP_END + t * (CLIP_STRIKE_END - CLIP_WINDUP_END);
  else                         clipT = CLIP_STRIKE_END + t * (1 - CLIP_STRIKE_END);
  // Sample at clip-local time. ClipSpec defaults to duration 1.0 so
  // normalized t equals clip-local t for our 0..1 keyframe convention.
  const sample = sampleClip(clip as Parameters<typeof sampleClip>[0], clipT);
  out.x    = ix + (sample['weapon.pos.x'] ?? 0);
  out.y    = iy + (sample['weapon.pos.y'] ?? 0);
  out.z    = iz + (sample['weapon.pos.z'] ?? 0);
  out.rotX = rx + (sample['weapon.rot.x'] ?? 0);
  out.rotY = ry + (sample['weapon.rot.y'] ?? 0);
  out.rotZ = rz + (sample['weapon.rot.z'] ?? 0);
  // Shoulder pivot — absolute rotation relative to the slot's
  // spec-authored rest (which is 0). Written to the shared
  // shoulderPivot scratch the viewmodel reads each frame.
  shoulderPivot.x = sample['shoulder.rot.x'] ?? 0;
  shoulderPivot.y = sample['shoulder.rot.y'] ?? 0;
  shoulderPivot.z = sample['shoulder.rot.z'] ?? 0;
  return out;
}

/** The hand-coded pose dispatch — fallback for poses not (yet) authored as data,
 *  and the oracle the data specs are tested against. Exported only for the test. */
export function legacyComputeWeaponPose(pose: PoseKey, phase: SwingPhase, t: number): WeaponPose {
  switch (pose) {
    case 'dagger-stab':        return daggerStabPose(phase, t);
    case 'dagger-slash':       return daggerSlashPose(phase, t);
    case 'dagger-double-stab': return daggerDoubleStabPose(phase, t);
    case 'sword-slash-right':  return swordSlashRightPose(phase, t);
    case 'sword-thrust':       return swordThrustPose(phase, t);
    case 'sword-lunge-forward':return swordLungeForwardPose(phase, t);
    case 'sword-sweep-left':   return swordSweepLeftPose(phase, t);
    case 'sword-sweep-right':  return swordSweepRightPose(phase, t);
    case 'sword-retreat-slash':return swordRetreatSlashPose(phase, t);
    case 'sword-ward-back':    return swordWardBackPose(phase, t);
    case 'hammer-swing-left':  return hammerSwingLeftPose(phase, t);
    case 'hammer-swing-right': return hammerSwingRightPose(phase, t);
    case 'hammer-smash':       return hammerPose(phase, t);
    case 'spear-thrust':       return spearThrustPose(phase, t);
    case 'spear-lunge':        return spearLungePose(phase, t);
    case 'crossbow-fire':      return crossbowFirePose(phase, t);
    case 'wand-cast':          return wandCastPose(phase, t);
    case 'scythe-reap-right':  return scytheReapRightPose(phase, t);
    case 'scythe-reap-left':   return scytheReapLeftPose(phase, t);
    case 'scythe-spin':        return scytheSpinPose(phase, t);
    case 'whip-crack-right':   return whipCrackRightPose(phase, t);
    case 'whip-crack-left':    return whipCrackLeftPose(phase, t);
    case 'whip-wrap':          return whipWrapPose(phase, t);
    case 'knife-throw':        return knifeThrowPose(phase, t);
    case 'sword-slash-left':
    default:                   return swordSlashLeftPose(phase, t);
  }
}

// ── Sword combo: slash-left → slash-right → thrust ───────────────
// Step 0: existing diagonal slash, ending on the lower-LEFT.
// Step 1: mirror of step 0 — winds up on the LEFT, sweeps to the
//         lower-RIGHT. Combined, the two slashes make an X-cut
//         routine — natural rhythm for sword and ratchets toward
//         the thrust finisher.
// Step 2: forward lunge with the tip leading — committing finisher,
//         long recover.

function swordSlashLeftPose(phase: SwingPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    // Pull up + back, pitch back.
    scratch.x = ix;
    scratch.y = iy + 0.15 * t;
    scratch.z = iz + 0.05 * t;
    scratch.rotX = rx - 0.9 * t;
    scratch.rotY = ry;
    scratch.rotZ = rz;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);   // ease-out quad
    scratch.x = ix - 0.15 * ease;
    scratch.y = iy + 0.15 - 0.4 * ease;
    scratch.z = iz - 0.1 * ease;
    scratch.rotX = rx - 0.9 + 1.6 * ease;
    scratch.rotY = ry;
    scratch.rotZ = rz + 0.3 * ease;
    return scratch;
  }
  // recover — lerp from end-of-strike back to idle.
  const e = 1 - (1 - t) * (1 - t);
  const fromX = ix - 0.15, fromY = iy - 0.25, fromZ = iz - 0.1;
  scratch.x = fromX + (ix - fromX) * e;
  scratch.y = fromY + (iy - fromY) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = (rx + 0.7) + (rx - (rx + 0.7)) * e;
  scratch.rotY = ry;
  scratch.rotZ = (rz + 0.3) + (rz - (rz + 0.3)) * e;
  return scratch;
}

function swordSlashRightPose(phase: SwingPhase, t: number): WeaponPose {
  // Rising slice on the RIGHT side. Previous version went mostly
  // STRAIGHT UP (low-right → high-right) and read as a parade salute
  // — "presenting arms," not striking. This version drives the blade
  // FORWARD as it rises so it visibly slices through the cut line.
  // End pose has the tip pointing up-and-FORWARD (not vertical) so
  // the strike looks like it carved through something on the way up.
  const WOUND_X = ix + 0.10;          // stay on the right
  const WOUND_Y = iy - 0.15;          // low
  const WOUND_Z = iz + 0.08;          // pulled back to load the cut
  const WOUND_RX = rx + 0.55;         // pitch forward — tip down
  const WOUND_RY = ry;
  const WOUND_RZ = rz - 0.10;         // edge pre-rotated to lead the rise
  const STRIKE_X = ix + 0.18;         // modest right — not flaring outward
  const STRIKE_Y = iy + 0.10;         // moderate height — chest/shoulder, not overhead
  const STRIKE_Z = iz - 0.24;         // PUSH FORWARD: this is what makes it a cut, not a lift
  const STRIKE_RX = rx - 0.45;        // tip up-and-FORWARD (not straight up)
  const STRIKE_RY = ry - 0.10;        // slight yaw so the blade arcs across the front
  const STRIKE_RZ = rz + 0.50;        // edge leads the slice
  if (phase === 'windup') {
    scratch.x = ix + (WOUND_X - ix) * t;
    scratch.y = iy + (WOUND_Y - iy) * t;
    scratch.z = iz + (WOUND_Z - iz) * t;
    scratch.rotX = rx + (WOUND_RX - rx) * t;
    scratch.rotY = ry + (WOUND_RY - ry) * t;
    scratch.rotZ = rz + (WOUND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WOUND_X + (STRIKE_X - WOUND_X) * ease;
    scratch.y = WOUND_Y + (STRIKE_Y - WOUND_Y) * ease;
    scratch.z = WOUND_Z + (STRIKE_Z - WOUND_Z) * ease;
    scratch.rotX = WOUND_RX + (STRIKE_RX - WOUND_RX) * ease;
    scratch.rotY = WOUND_RY + (STRIKE_RY - WOUND_RY) * ease;
    scratch.rotZ = WOUND_RZ + (STRIKE_RZ - WOUND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = STRIKE_X + (ix - STRIKE_X) * e;
  scratch.y = STRIKE_Y + (iy - STRIKE_Y) * e;
  scratch.z = STRIKE_Z + (iz - STRIKE_Z) * e;
  scratch.rotX = STRIKE_RX + (rx - STRIKE_RX) * e;
  scratch.rotY = STRIKE_RY + (ry - STRIKE_RY) * e;
  scratch.rotZ = STRIKE_RZ + (rz - STRIKE_RZ) * e;
  return scratch;
}

function swordThrustPose(phase: SwingPhase, t: number): WeaponPose {
  // Forward lunge — tip leads. Larger reach than the dagger thrust
  // because the sword is longer; deeper push along -Z. Rotation
  // mirrors the dagger stab orientation (sword blade tip is +Y in
  // the model, same as dagger).
  const THRUST_RX = rx - 1.15;
  const THRUST_RY = ry + 0.15;
  const THRUST_RZ = rz - 0.40;
  const WOUND_X = ix - 0.08;
  const WOUND_Y = iy + 0.10;
  const WOUND_Z = iz + 0.12;
  const THRUST_DEPTH = 0.55;
  if (phase === 'windup') {
    scratch.x = ix + (WOUND_X - ix) * t;
    scratch.y = iy + (WOUND_Y - iy) * t;
    scratch.z = iz + (WOUND_Z - iz) * t;
    scratch.rotX = rx + (THRUST_RX - rx) * t;
    scratch.rotY = ry + (THRUST_RY - ry) * t;
    scratch.rotZ = rz + (THRUST_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WOUND_X;
    scratch.y = WOUND_Y;
    scratch.z = WOUND_Z + (-THRUST_DEPTH) * ease;
    scratch.rotX = THRUST_RX;
    scratch.rotY = THRUST_RY;
    scratch.rotZ = THRUST_RZ;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  const fromZ = WOUND_Z - THRUST_DEPTH;
  scratch.x = WOUND_X + (ix - WOUND_X) * e;
  scratch.y = WOUND_Y + (iy - WOUND_Y) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = THRUST_RX + (rx - THRUST_RX) * e;
  scratch.rotY = THRUST_RY + (ry - THRUST_RY) * e;
  scratch.rotZ = THRUST_RZ + (rz - THRUST_RZ) * e;
  return scratch;
}

// ── Sword movement-driven variants ───────────────────────────────
// Fired when the player's joystick is held in a direction at the
// moment of press. Each one is a single-strike alternative to the
// normal combo step — combat/attack.ts picks which by direction.

/** Forward lunge — bigger committed thrust than the combo finisher.
 *  Tip leads further, the body visibly leans IN, deeper push along
 *  -Z. Reads as "I'm closing the gap." */
function swordLungeForwardPose(phase: SwingPhase, t: number): WeaponPose {
  const WIND_X = ix - 0.10;
  const WIND_Y = iy + 0.14;
  const WIND_Z = iz + 0.16;
  const WIND_RX = rx - 1.30;
  const WIND_RY = ry + 0.18;
  const WIND_RZ = rz - 0.45;
  const LUNGE_DEPTH = 0.80;        // deeper than the thrust's 0.55
  if (phase === 'windup') {
    scratch.x = ix + (WIND_X - ix) * t;
    scratch.y = iy + (WIND_Y - iy) * t;
    scratch.z = iz + (WIND_Z - iz) * t;
    scratch.rotX = rx + (WIND_RX - rx) * t;
    scratch.rotY = ry + (WIND_RY - ry) * t;
    scratch.rotZ = rz + (WIND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WIND_X;
    scratch.y = WIND_Y;
    scratch.z = WIND_Z + (-LUNGE_DEPTH) * ease;
    scratch.rotX = WIND_RX;
    scratch.rotY = WIND_RY;
    scratch.rotZ = WIND_RZ;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  const fromZ = WIND_Z - LUNGE_DEPTH;
  scratch.x = WIND_X + (ix - WIND_X) * e;
  scratch.y = WIND_Y + (iy - WIND_Y) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = WIND_RX + (rx - WIND_RX) * e;
  scratch.rotY = WIND_RY + (ry - WIND_RY) * e;
  scratch.rotZ = WIND_RZ + (rz - WIND_RZ) * e;
  return scratch;
}

/** Strafe-LEFT sweep — wide horizontal arc following the body's
 *  leftward momentum. Sword cocks behind the right shoulder, sweeps
 *  across to the lower-left. Triggered when strafing LEFT into
 *  the swing. */
function swordSweepLeftPose(phase: SwingPhase, t: number): WeaponPose {
  return swordSweepBetween(phase, t,
    /* WIND */  ix + 0.22, iy + 0.10, iz + 0.06,
    /* WIND R */ rx - 0.45, ry - 0.55, rz - 0.85,
    /* END  */  ix - 0.28, iy - 0.16, iz - 0.05,
    /* END R */ rx - 0.30, ry + 0.40, rz + 1.00,
  );
}

/** Strafe-RIGHT sweep — mirror of strafe-left. Cocks behind the
 *  left shoulder, sweeps to the lower-right. */
function swordSweepRightPose(phase: SwingPhase, t: number): WeaponPose {
  return swordSweepBetween(phase, t,
    /* WIND */  ix - 0.22, iy + 0.10, iz + 0.06,
    /* WIND R */ rx - 0.45, ry + 0.55, rz + 0.85,
    /* END  */  ix + 0.28, iy - 0.16, iz - 0.05,
    /* END R */ rx - 0.30, ry - 0.40, rz - 1.00,
  );
}

/** Shared sweep curve — same windup→strike→recover envelope, just
 *  parametrised by the start/end pose endpoints. Saves duplicating
 *  the lerp math for the two mirrored sweeps. */
function swordSweepBetween(
  phase: SwingPhase, t: number,
  windX: number, windY: number, windZ: number,
  windRX: number, windRY: number, windRZ: number,
  endX: number, endY: number, endZ: number,
  endRX: number, endRY: number, endRZ: number,
): WeaponPose {
  if (phase === 'windup') {
    scratch.x = ix + (windX - ix) * t;
    scratch.y = iy + (windY - iy) * t;
    scratch.z = iz + (windZ - iz) * t;
    scratch.rotX = rx + (windRX - rx) * t;
    scratch.rotY = ry + (windRY - ry) * t;
    scratch.rotZ = rz + (windRZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = windX + (endX - windX) * ease;
    scratch.y = windY + (endY - windY) * ease;
    scratch.z = windZ + (endZ - windZ) * ease;
    scratch.rotX = windRX + (endRX - windRX) * ease;
    scratch.rotY = windRY + (endRY - windRY) * ease;
    scratch.rotZ = windRZ + (endRZ - windRZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = endX + (ix - endX) * e;
  scratch.y = endY + (iy - endY) * e;
  scratch.z = endZ + (iz - endZ) * e;
  scratch.rotX = endRX + (rx - endRX) * e;
  scratch.rotY = endRY + (ry - endRY) * e;
  scratch.rotZ = endRZ + (rz - endRZ) * e;
  return scratch;
}

/** Charged-back WARD — the player held to charge, then released
 *  backwards. They're winding up to KICK SPACE OPEN. Blade held
 *  vertical at the chest during windup (flat-of-blade forward),
 *  then a wide horizontal SHOVE during strike. Wider arc than the
 *  thrust, and the long recover sells the commit. The "I will be
 *  given space" move. */
function swordWardBackPose(phase: SwingPhase, t: number): WeaponPose {
  // Windup: blade pulled vertically up to chest, flat facing forward,
  // gripped at centre — a guard stance.
  const WIND_X = ix + 0.04;
  const WIND_Y = iy + 0.18;
  const WIND_Z = iz + 0.10;
  const WIND_RX = rx - 0.30;
  const WIND_RY = ry - 0.40;
  const WIND_RZ = rz - 0.10;
  // Strike-end: blade SHOVED forward + sweeping horizontally across.
  const END_X = ix - 0.10;
  const END_Y = iy + 0.02;
  const END_Z = iz - 0.32;
  const END_RX = rx - 0.95;
  const END_RY = ry + 0.30;
  const END_RZ = rz + 0.40;
  if (phase === 'windup') {
    scratch.x = ix + (WIND_X - ix) * t;
    scratch.y = iy + (WIND_Y - iy) * t;
    scratch.z = iz + (WIND_Z - iz) * t;
    scratch.rotX = rx + (WIND_RX - rx) * t;
    scratch.rotY = ry + (WIND_RY - ry) * t;
    scratch.rotZ = rz + (WIND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Fast snap during strike — this is the SHOVE.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WIND_X + (END_X - WIND_X) * ease;
    scratch.y = WIND_Y + (END_Y - WIND_Y) * ease;
    scratch.z = WIND_Z + (END_Z - WIND_Z) * ease;
    scratch.rotX = WIND_RX + (END_RX - WIND_RX) * ease;
    scratch.rotY = WIND_RY + (END_RY - WIND_RY) * ease;
    scratch.rotZ = WIND_RZ + (END_RZ - WIND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = END_X + (ix - END_X) * e;
  scratch.y = END_Y + (iy - END_Y) * e;
  scratch.z = END_Z + (iz - END_Z) * e;
  scratch.rotX = END_RX + (rx - END_RX) * e;
  scratch.rotY = END_RY + (ry - END_RY) * e;
  scratch.rotZ = END_RZ + (rz - END_RZ) * e;
  return scratch;
}

/** Retreat slash — a short defensive poke as the player backs off.
 *  Brief windup, modest forward extension, fast recovery so the
 *  next move can be a reposition or a follow-up. */
function swordRetreatSlashPose(phase: SwingPhase, t: number): WeaponPose {
  // Smaller wound-up than the thrust — this is a JAB, not a commit.
  const WIND_X = ix - 0.04;
  const WIND_Y = iy + 0.06;
  const WIND_Z = iz + 0.08;
  const WIND_RX = rx - 0.85;
  const WIND_RY = ry + 0.10;
  const WIND_RZ = rz - 0.25;
  const POKE_DEPTH = 0.36;       // shorter than the thrust's 0.55
  if (phase === 'windup') {
    scratch.x = ix + (WIND_X - ix) * t;
    scratch.y = iy + (WIND_Y - iy) * t;
    scratch.z = iz + (WIND_Z - iz) * t;
    scratch.rotX = rx + (WIND_RX - rx) * t;
    scratch.rotY = ry + (WIND_RY - ry) * t;
    scratch.rotZ = rz + (WIND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WIND_X;
    scratch.y = WIND_Y;
    scratch.z = WIND_Z + (-POKE_DEPTH) * ease;
    scratch.rotX = WIND_RX;
    scratch.rotY = WIND_RY;
    scratch.rotZ = WIND_RZ;
    return scratch;
  }
  // Snappier recover — same ease curve but the phase duration in the
  // class spec is already shorter (0.22s).
  const e = 1 - (1 - t) * (1 - t);
  const fromZ = WIND_Z - POKE_DEPTH;
  scratch.x = WIND_X + (ix - WIND_X) * e;
  scratch.y = WIND_Y + (iy - WIND_Y) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = WIND_RX + (rx - WIND_RX) * e;
  scratch.rotY = WIND_RY + (ry - WIND_RY) * e;
  scratch.rotZ = WIND_RZ + (rz - WIND_RZ) * e;
  return scratch;
}

// ── Dagger combo: stab → slash → stab-stab ───────────────────────
// Step 0: single forward thrust — quick, clean. Step 1: lateral cut
// across the view. Step 2: two-pulse "stab stab" finisher.
// All three share the same wound-up centre-line tilt so the combo
// reads as one continuous routine, not three unrelated swings.

// Shared stab-pose orientation: blade tip aimed at camera-forward.
// Dagger model has tip at +Y, so we rotate ~−π/2 around X to swing
// the tip toward camera-forward (−Z). The idle yaw/roll get cancelled
// out so the blade lines up with the crosshair instead of cutting
// across the body.
const DAGGER_STAB_RX = rx - 1.30;   // -0.2 - 1.30 = -1.50 → tip forward
const DAGGER_STAB_RY = ry + 0.15;   // cancel idle yaw  → ≈ 0
const DAGGER_STAB_RZ = rz - 0.40;   // cancel idle roll → ≈ 0

// Wound-up translation, shared by stab and double-stab.
const DAGGER_WOUND_X = ix - 0.06;   // pulled toward centre line
const DAGGER_WOUND_Y = iy + 0.05;   // up to eye-line
const DAGGER_WOUND_Z = iz + 0.10;   // drawn back toward camera

function daggerStabPose(phase: SwingPhase, t: number): WeaponPose {
  // Single forward thrust. Same wound-up pose as the finisher; just
  // one sine-pulse instead of two. Reads as the opener.
  const STAB_DEPTH = 0.32;
  if (phase === 'windup') {
    scratch.x = ix + (DAGGER_WOUND_X - ix) * t;
    scratch.y = iy + (DAGGER_WOUND_Y - iy) * t;
    scratch.z = iz + (DAGGER_WOUND_Z - iz) * t;
    scratch.rotX = rx + (DAGGER_STAB_RX - rx) * t;
    scratch.rotY = ry + (DAGGER_STAB_RY - ry) * t;
    scratch.rotZ = rz + (DAGGER_STAB_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Ease-out push forward. Holds at full extension at end of strike
    // so the blade visually peaks in the enemy.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = DAGGER_WOUND_X;
    scratch.y = DAGGER_WOUND_Y;
    scratch.z = DAGGER_WOUND_Z + (-STAB_DEPTH) * ease;
    scratch.rotX = DAGGER_STAB_RX;
    scratch.rotY = DAGGER_STAB_RY;
    scratch.rotZ = DAGGER_STAB_RZ;
    return scratch;
  }
  // recover — strike ends at full extension; lerp back to idle.
  const e = 1 - (1 - t) * (1 - t);
  const fromZ = DAGGER_WOUND_Z - STAB_DEPTH;
  scratch.x = DAGGER_WOUND_X + (ix - DAGGER_WOUND_X) * e;
  scratch.y = DAGGER_WOUND_Y + (iy - DAGGER_WOUND_Y) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = DAGGER_STAB_RX + (rx - DAGGER_STAB_RX) * e;
  scratch.rotY = DAGGER_STAB_RY + (ry - DAGGER_STAB_RY) * e;
  scratch.rotZ = DAGGER_STAB_RZ + (rz - DAGGER_STAB_RZ) * e;
  return scratch;
}

function daggerSlashPose(phase: SwingPhase, t: number): WeaponPose {
  // Lateral cut: pull the blade WAY across to the LEFT in windup,
  // then sweep right across the view. Big visible arc — the edge
  // leads, the tip yaws through ~120° so the slash reads at a glance.
  const WOUND_X = ix - 0.42;          // pulled across to the left, FAR
  const WOUND_Y = iy + 0.10;          // raised slightly above eye-line
  const WOUND_Z = iz + 0.06;
  const WOUND_RX = rx - 0.55;          // blade tilts up-and-across
  const WOUND_RY = ry + 0.95;          // tip yaws hard to the right
  const WOUND_RZ = rz - 0.40;          // cancel idle diagonal roll
  const STRIKE_X = ix + 0.42;          // sweep all the way across to the right
  const STRIKE_Y = iy + 0.00;
  const STRIKE_Z = iz - 0.10;
  const STRIKE_RX = rx - 0.25;
  const STRIKE_RY = ry - 0.95;         // tip yaws back the other way
  const STRIKE_RZ = rz + 0.25;
  if (phase === 'windup') {
    scratch.x = ix + (WOUND_X - ix) * t;
    scratch.y = iy + (WOUND_Y - iy) * t;
    scratch.z = iz + (WOUND_Z - iz) * t;
    scratch.rotX = rx + (WOUND_RX - rx) * t;
    scratch.rotY = ry + (WOUND_RY - ry) * t;
    scratch.rotZ = rz + (WOUND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WOUND_X + (STRIKE_X - WOUND_X) * ease;
    scratch.y = WOUND_Y + (STRIKE_Y - WOUND_Y) * ease;
    scratch.z = WOUND_Z + (STRIKE_Z - WOUND_Z) * ease;
    scratch.rotX = WOUND_RX + (STRIKE_RX - WOUND_RX) * ease;
    scratch.rotY = WOUND_RY + (STRIKE_RY - WOUND_RY) * ease;
    scratch.rotZ = WOUND_RZ + (STRIKE_RZ - WOUND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = STRIKE_X + (ix - STRIKE_X) * e;
  scratch.y = STRIKE_Y + (iy - STRIKE_Y) * e;
  scratch.z = STRIKE_Z + (iz - STRIKE_Z) * e;
  scratch.rotX = STRIKE_RX + (rx - STRIKE_RX) * e;
  scratch.rotY = STRIKE_RY + (ry - STRIKE_RY) * e;
  scratch.rotZ = STRIKE_RZ + (rz - STRIKE_RZ) * e;
  return scratch;
}

// Per-stab forward push in metres along camera-local −Z for the
// double-stab finisher. Second stab goes deeper so the rhythm reads
// as "jab… JAB".
const STAB1_DEPTH = 0.30;
const STAB2_DEPTH = 0.42;

function daggerDoubleStabPose(phase: SwingPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    // Lerp idle → wound-up in one shot. Quick draw, no flourish.
    scratch.x = ix + (DAGGER_WOUND_X - ix) * t;
    scratch.y = iy + (DAGGER_WOUND_Y - iy) * t;
    scratch.z = iz + (DAGGER_WOUND_Z - iz) * t;
    scratch.rotX = rx + (DAGGER_STAB_RX - rx) * t;
    scratch.rotY = ry + (DAGGER_STAB_RY - ry) * t;
    scratch.rotZ = rz + (DAGGER_STAB_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Two sine pulses end-to-end. Each pulse: 0 → peak → 0 along the
    // forward axis. Blade rotation stays locked at the stab pose so
    // the tip leads each thrust cleanly.
    let fwd = 0;
    if (t < 0.5) {
      const u = t / 0.5;                       // 0..1 inside stab 1
      fwd = STAB1_DEPTH * Math.sin(Math.PI * u);
    } else {
      const u = (t - 0.5) / 0.5;               // 0..1 inside stab 2
      fwd = STAB2_DEPTH * Math.sin(Math.PI * u);
    }
    // Tiny inward sway scaled to the current thrust depth so the
    // blade tracks slightly toward centre as it extends.
    const swayScale = fwd / STAB2_DEPTH;
    scratch.x = DAGGER_WOUND_X + (-0.03) * swayScale;
    scratch.y = DAGGER_WOUND_Y + (-0.02) * swayScale;
    scratch.z = DAGGER_WOUND_Z + (-fwd);
    scratch.rotX = DAGGER_STAB_RX;
    scratch.rotY = DAGGER_STAB_RY;
    scratch.rotZ = DAGGER_STAB_RZ;
    return scratch;
  }
  // recover — strike ends back at the wound-up pose (sin(π)=0), so
  // we lerp from THAT back to idle in one ease.
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = DAGGER_WOUND_X + (ix - DAGGER_WOUND_X) * e;
  scratch.y = DAGGER_WOUND_Y + (iy - DAGGER_WOUND_Y) * e;
  scratch.z = DAGGER_WOUND_Z + (iz - DAGGER_WOUND_Z) * e;
  scratch.rotX = DAGGER_STAB_RX + (rx - DAGGER_STAB_RX) * e;
  scratch.rotY = DAGGER_STAB_RY + (ry - DAGGER_STAB_RY) * e;
  scratch.rotZ = DAGGER_STAB_RZ + (rz - DAGGER_STAB_RZ) * e;
  return scratch;
}

// ── Hammer combo: swing-left → swing-right → smash ───────────────
// Step 0/1: lateral side-smashes. Hammer head wound up high on one
// shoulder, sweeps down and ACROSS the view to the opposite side.
// Reads as a horizontal smash — same head-leads logic as the overhead
// finisher but the arc is sideways instead of vertical.
// Step 2: the existing overhead crash — committing finisher.

// Shared hammer-side-swing implementation. swingLeft and swingRight
// pass mirrored windup/strike values; the actual arc curve is the
// same. The KEY trick is the z-axis sin curve in the strike phase:
// the body's grip is pulled BACK at both endpoints and pushed forward
// at midpoint, so the whole hammer + arm traces a parabolic arc
// through the front of the player instead of just translating in a
// straight line. That's what makes it read as a swinging arc rather
// than the hammer leaning in place.
interface SwingParams {
  woundX: number; strikeX: number;
  woundZ: number; strikeZ: number;
  woundRZ: number; strikeRZ: number;
  swingY: number;
  /** How far the grip pushes FORWARD (−Z) at the midpoint of the
   *  strike. The whole arm rides this forward arc, so the head
   *  visibly carves a horizontal arc through the player's view. */
  arcForwardPush: number;
}

function applyHammerSwing(phase: SwingPhase, t: number, p: SwingParams): WeaponPose {
  if (phase === 'windup') {
    scratch.x = ix + (p.woundX - ix) * t;
    scratch.y = iy + (p.swingY - iy) * t;
    scratch.z = iz + (p.woundZ - iz) * t;
    scratch.rotX = rx;
    scratch.rotY = ry;
    scratch.rotZ = rz + (p.woundRZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    // Linear-ish base path from wound → strike.
    scratch.x = p.woundX + (p.strikeX - p.woundX) * ease;
    scratch.y = p.swingY;
    // Z-arc: lerp base + forward push that peaks at mid-strike (sin(π·t)
    // = 0 at endpoints, 1 at t=0.5). This is what makes the grip — and
    // the whole hammer with it — visibly swing through the front.
    const zBase = p.woundZ + (p.strikeZ - p.woundZ) * ease;
    const zArc = -p.arcForwardPush * Math.sin(Math.PI * t);
    scratch.z = zBase + zArc;
    scratch.rotX = rx;
    scratch.rotY = ry;
    scratch.rotZ = p.woundRZ + (p.strikeRZ - p.woundRZ) * ease;
    return scratch;
  }
  // recover — lerp end-of-strike back to idle. At strike t=1 the
  // sin arc is 0, so strike-end z is just the strikeZ.
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = p.strikeX + (ix - p.strikeX) * e;
  scratch.y = p.swingY + (iy - p.swingY) * e;
  scratch.z = p.strikeZ + (iz - p.strikeZ) * e;
  scratch.rotX = rx;
  scratch.rotY = ry;
  scratch.rotZ = p.strikeRZ + (rz - p.strikeRZ) * e;
  return scratch;
}

function hammerSwingLeftPose(phase: SwingPhase, t: number): WeaponPose {
  // Right-to-left wide haymaker. Body sweeps from far right through
  // forward to far left; HEAD must sweep the same direction so the
  // whole hammer moves together.
  //
  // rotZ sign: three.js XYZ Euler order rotates +Y (model head)
  // toward −X (LEFT) for POSITIVE rotZ. So:
  //   - head on RIGHT (windup) → rotZ NEGATIVE
  //   - head on LEFT  (strike) → rotZ POSITIVE
  // Earlier versions had this reversed — the head went one way while
  // the grip went the other, so the haft ended up doing the work.
  return applyHammerSwing(phase, t, {
    swingY: iy + 0.18,
    woundX: ix + 0.40, strikeX: ix - 0.45,
    woundZ: iz + 0.18, strikeZ: iz + 0.18,
    woundRZ: rz - 1.15, strikeRZ: rz + 1.45,
    arcForwardPush: 0.42,
  });
}

function hammerSwingRightPose(phase: SwingPhase, t: number): WeaponPose {
  // Mirror — left-to-right. Head LEFT in windup (rotZ positive) →
  // head RIGHT in strike (rotZ negative).
  return applyHammerSwing(phase, t, {
    swingY: iy + 0.18,
    woundX: ix - 0.45, strikeX: ix + 0.40,
    woundZ: iz + 0.18, strikeZ: iz + 0.18,
    woundRZ: rz + 1.45, strikeRZ: rz - 1.15,
    arcForwardPush: 0.42,
  });
}

// ── Hammer (overhead smash — finisher) ────────────────────────────
// Big wind-up: viewmodel rises high above the camera, the HEAD
// pitches back over the shoulder. Strike sweeps the head forward
// and down through the centre line — gravity-driven. Slow recovery
// so missing is genuinely punishing.
//
// Iron-maul model has the head at +Y (up). To swing the head BACK
// during windup we rotate POSITIVELY around X (head moves +Y → +Z,
// i.e. up-and-back). The strike then rotates NEGATIVELY through the
// arc so the head crashes from over-the-shoulder, through overhead,
// down to forward-and-low. The previous version inverted both — the
// head went forward during windup and BACKWARD during strike, so
// players were smashing things with the haft instead of the iron.

// Wound-up pose: hammer raised, head pitched back over the shoulder.
const HAMMER_WOUND_X = ix - 0.10;
const HAMMER_WOUND_Y = iy + 0.55;
const HAMMER_WOUND_Z = iz + 0.08;
const HAMMER_WOUND_RX = rx + 1.40;   // +X rot pulls the +Y head back to +Z
const HAMMER_WOUND_RZ = rz - 0.20;
// Strike-end pose: head down and forward.
const HAMMER_STRIKE_X = ix + 0.00;
const HAMMER_STRIKE_Y = iy - 0.30;
const HAMMER_STRIKE_Z = iz - 0.12;
const HAMMER_STRIKE_RX = rx - 1.10;  // sweep through +π/2 → head ends pointing down/-Z
const HAMMER_STRIKE_RZ = rz + 0.25;

function hammerPose(phase: SwingPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    scratch.x = ix + (HAMMER_WOUND_X - ix) * t;
    scratch.y = iy + (HAMMER_WOUND_Y - iy) * t;
    scratch.z = iz + (HAMMER_WOUND_Z - iz) * t;
    scratch.rotX = rx + (HAMMER_WOUND_RX - rx) * t;
    scratch.rotY = ry;
    scratch.rotZ = rz + (HAMMER_WOUND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Ease-out: head accelerates fast through the arc.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = HAMMER_WOUND_X + (HAMMER_STRIKE_X - HAMMER_WOUND_X) * ease;
    scratch.y = HAMMER_WOUND_Y + (HAMMER_STRIKE_Y - HAMMER_WOUND_Y) * ease;
    scratch.z = HAMMER_WOUND_Z + (HAMMER_STRIKE_Z - HAMMER_WOUND_Z) * ease;
    scratch.rotX = HAMMER_WOUND_RX + (HAMMER_STRIKE_RX - HAMMER_WOUND_RX) * ease;
    scratch.rotY = ry;
    scratch.rotZ = HAMMER_WOUND_RZ + (HAMMER_STRIKE_RZ - HAMMER_WOUND_RZ) * ease;
    return scratch;
  }
  // recover — slow lift back to idle from low-and-forward.
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = HAMMER_STRIKE_X + (ix - HAMMER_STRIKE_X) * e;
  scratch.y = HAMMER_STRIKE_Y + (iy - HAMMER_STRIKE_Y) * e;
  scratch.z = HAMMER_STRIKE_Z + (iz - HAMMER_STRIKE_Z) * e;
  scratch.rotX = HAMMER_STRIKE_RX + (rx - HAMMER_STRIKE_RX) * e;
  scratch.rotY = ry;
  scratch.rotZ = HAMMER_STRIKE_RZ + (rz - HAMMER_STRIKE_RZ) * e;
  return scratch;
}

// ── Spear: braced thrust + lunge ─────────────────────────────────
// The spear model runs the shaft along −Z with the head at the tip, so
// the pose is mostly about levelling the shared idle tilt to point the
// head down the crosshair, then driving it forward. Two flavours:
//   spear-thrust — quick jab, modest depth, snappy recover.
//   spear-lunge  — the finisher: deeper push + a small body-drop, long
//                  recover (committing).
// Both brace at the same "ready" pose (drawn back + levelled) so the
// combo reads as one continuous routine.
const SPEAR_READY_X = ix - 0.10;     // pulled toward centre line
const SPEAR_READY_Y = iy + 0.06;     // raised to a braced carry
const SPEAR_READY_Z = iz + 0.12;     // drawn back to load the thrust
const SPEAR_READY_RX = rx + 0.20;    // ≈ 0 — level the shaft forward
const SPEAR_READY_RY = ry + 0.15;    // ≈ 0 — aim down the crosshair
const SPEAR_READY_RZ = rz - 0.34;    // ≈ 0.06 — de-roll

/** Shared spear thrust curve. `depth` = forward push along −Z at full
 *  extension; `drop` = how far the whole weapon sinks (body lunge) at
 *  the strike peak. */
function spearThrust(phase: SwingPhase, t: number, depth: number, drop: number): WeaponPose {
  if (phase === 'windup') {
    scratch.x = ix + (SPEAR_READY_X - ix) * t;
    scratch.y = iy + (SPEAR_READY_Y - iy) * t;
    scratch.z = iz + (SPEAR_READY_Z - iz) * t;
    scratch.rotX = rx + (SPEAR_READY_RX - rx) * t;
    scratch.rotY = ry + (SPEAR_READY_RY - ry) * t;
    scratch.rotZ = rz + (SPEAR_READY_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Ease-out push; holds at full extension so the head visibly peaks
    // in the target. A sine drop adds a small lunge dip at mid-strike.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = SPEAR_READY_X;
    scratch.y = SPEAR_READY_Y - drop * Math.sin(Math.PI * t);
    scratch.z = SPEAR_READY_Z + (-depth) * ease;
    scratch.rotX = SPEAR_READY_RX;
    scratch.rotY = SPEAR_READY_RY;
    scratch.rotZ = SPEAR_READY_RZ;
    return scratch;
  }
  // recover — from full extension back to idle.
  const e = 1 - (1 - t) * (1 - t);
  const fromZ = SPEAR_READY_Z - depth;
  scratch.x = SPEAR_READY_X + (ix - SPEAR_READY_X) * e;
  scratch.y = SPEAR_READY_Y + (iy - SPEAR_READY_Y) * e;
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = SPEAR_READY_RX + (rx - SPEAR_READY_RX) * e;
  scratch.rotY = SPEAR_READY_RY + (ry - SPEAR_READY_RY) * e;
  scratch.rotZ = SPEAR_READY_RZ + (rz - SPEAR_READY_RZ) * e;
  return scratch;
}

function spearThrustPose(phase: SwingPhase, t: number): WeaponPose {
  return spearThrust(phase, t, 0.42, 0.04);
}

function spearLungePose(phase: SwingPhase, t: number): WeaponPose {
  // Finisher — deeper drive + a real body-drop on the lunge.
  return spearThrust(phase, t, 0.62, 0.12);
}

// ── Crossbow: level → recoil → re-cock ───────────────────────────
// The crossbow model points the stock/barrel along −Z (forward), so
// the "aim" pose is mostly about CANCELLING the shared idle tilt — the
// idle roll/pitch (rz 0.4, rx −0.2) reads as "carried at the hip," and
// we level it to the crosshair to brace the shot.
//
//   windup  — raise + pull to the shoulder, level the barrel (de-roll,
//             de-pitch) so it aims down the crosshair.
//   strike  — RECOIL: snap back toward the camera (+Z) and kick the
//             muzzle UP (rotX more positive → −Z barrel tips toward +Y).
//             Fast, so the kick punches.
//   recover — the reload. A slow re-cock: the front dips DOWN (muzzle
//             drops as if working the lever) on a sine bump partway
//             through, while the base path eases recoil → idle. The
//             long recover is the cadence cost.
const XBOW_AIM_X = ix - 0.20;       // closer to centre line
const XBOW_AIM_Y = iy + 0.08;       // raised slightly
const XBOW_AIM_Z = iz - 0.14;       // pushed FORWARD past idle — bow stays out
const XBOW_AIM_RX = rx + 0.10;      // mostly level barrel, slight downward tip
const XBOW_AIM_RY = ry + 0.20;      // aimed straight forward
const XBOW_AIM_RZ = rz - 0.30;      // de-roll so the prod is horizontal
// Recoil end-of-strike pose, relative to the aim pose.
const XBOW_KICK_Y = 0.06;           // muzzle climbs
const XBOW_KICK_Z = 0.16;           // snaps back into the shoulder
const XBOW_KICK_RX = 0.34;          // muzzle pitches up

function crossbowFirePose(phase: SwingPhase, t: number): WeaponPose {
  if (phase === 'windup') {
    scratch.x = ix + (XBOW_AIM_X - ix) * t;
    scratch.y = iy + (XBOW_AIM_Y - iy) * t;
    scratch.z = iz + (XBOW_AIM_Z - iz) * t;
    scratch.rotX = rx + (XBOW_AIM_RX - rx) * t;
    scratch.rotY = ry + (XBOW_AIM_RY - ry) * t;
    scratch.rotZ = rz + (XBOW_AIM_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    // Snap to recoil fast (ease-out), so the kick reads as an impulse.
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = XBOW_AIM_X;
    scratch.y = XBOW_AIM_Y + XBOW_KICK_Y * ease;
    scratch.z = XBOW_AIM_Z + XBOW_KICK_Z * ease;
    scratch.rotX = XBOW_AIM_RX + XBOW_KICK_RX * ease;
    scratch.rotY = XBOW_AIM_RY;
    scratch.rotZ = XBOW_AIM_RZ;
    return scratch;
  }
  // recover — the reload. Base path eases the recoil pose back to idle;
  // a sine bump dips the muzzle down mid-way (re-cock the lever) so the
  // long recover has a beat of business instead of a dead lerp.
  const e = 1 - (1 - t) * (1 - t);
  const fromX = XBOW_AIM_X, fromY = XBOW_AIM_Y + XBOW_KICK_Y, fromZ = XBOW_AIM_Z + XBOW_KICK_Z;
  const fromRX = XBOW_AIM_RX + XBOW_KICK_RX, fromRZ = XBOW_AIM_RZ;
  const dip = Math.sin(Math.PI * t);      // 0 → 1 → 0 across recover
  scratch.x = fromX + (ix - fromX) * e;
  scratch.y = fromY + (iy - fromY) * e - 0.10 * dip;     // drop while re-cocking
  scratch.z = fromZ + (iz - fromZ) * e;
  scratch.rotX = fromRX + (rx - fromRX) * e - 0.45 * dip; // muzzle pitches down
  scratch.rotY = ry;
  scratch.rotZ = fromRZ + (rz - fromRZ) * e;
  return scratch;
}

// ── Wand / Staff: raise upright → cast → settle ──────────────────
// The staff is held UPRIGHT in the casting pose — vertical shaft,
// orb at the top. The shiver during windup reads as the staff
// gathering charge before the release. Cast keeps the staff
// vertical but pushes it slightly forward + tips the orb toward
// the target.
//   windup  — bring the staff to the upright ready pose with a
//             rising sine-tremble (shiver builds with t).
//   strike  — push the upright staff forward briefly, tip the
//             orb toward the camera-forward direction. The orb
//             stays HIGH so the launched projectile reads as
//             coming from the top of the staff.
//   recover — settle back to idle.
// Upright pose — wand model authors shaft along -Z, so rotX ≈ -π/2
// tilts it to point UP. Held to the player's right, base at hip
// level, orb crown at head level.
const WAND_DRAW_X = ix + 0.18;       // out to the right of centre
const WAND_DRAW_Y = iy - 0.12;       // base low so the orb sits at eye level
const WAND_DRAW_Z = iz + 0.05;       // close to chest, slightly back
const WAND_DRAW_RX = 1.35;           // tilted UP — close to vertical (orb crown at top)
const WAND_DRAW_RZ = rz - 0.12;      // slight outward roll, natural hold
// Cast pose — shaft tips FORWARD from vertical to about 45°,
// pointing the orb crown at the target while staying high. The
// small forward Z-push reads as the release motion.
const WAND_CAST_X = ix + 0.10;
const WAND_CAST_Y = iy - 0.04;
const WAND_CAST_Z = iz - 0.10;
const WAND_CAST_RX = 0.65;           // tipped forward from upright, orb toward target
const WAND_CAST_RZ = rz - 0.10;

function wandCastPose(phase: SwingPhase, t: number): WeaponPose {
  // Staff is ALREADY held upright (idle = DRAW pose). Windup is a
  // tiny tremble in place — orb gathering — not a big motion, since
  // the staff is already cocked. Strike tips forward to the cast
  // pose. Recover settles back to the upright draw pose, NOT the
  // hip-rest pose. That keeps the staff vertical throughout combat.
  if (phase === 'windup') {
    const tremble = 0.012 * t * Math.sin(t * 40);
    scratch.x = WAND_DRAW_X + tremble;
    scratch.y = WAND_DRAW_Y;
    scratch.z = WAND_DRAW_Z;
    scratch.rotX = WAND_DRAW_RX;
    scratch.rotY = ry;
    scratch.rotZ = WAND_DRAW_RZ - tremble;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WAND_DRAW_X + (WAND_CAST_X - WAND_DRAW_X) * ease;
    scratch.y = WAND_DRAW_Y + (WAND_CAST_Y - WAND_DRAW_Y) * ease;
    scratch.z = WAND_DRAW_Z + (WAND_CAST_Z - WAND_DRAW_Z) * ease;
    scratch.rotX = WAND_DRAW_RX + (WAND_CAST_RX - WAND_DRAW_RX) * ease;
    scratch.rotY = ry;
    scratch.rotZ = WAND_DRAW_RZ + (WAND_CAST_RZ - WAND_DRAW_RZ) * ease;
    return scratch;
  }
  // Recover: CAST → DRAW (not back to hip-rest).
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = WAND_CAST_X + (WAND_DRAW_X - WAND_CAST_X) * e;
  scratch.y = WAND_CAST_Y + (WAND_DRAW_Y - WAND_CAST_Y) * e;
  scratch.z = WAND_CAST_Z + (WAND_DRAW_Z - WAND_CAST_Z) * e;
  scratch.rotX = WAND_CAST_RX + (WAND_DRAW_RX - WAND_CAST_RX) * e;
  scratch.rotY = ry;
  scratch.rotZ = WAND_CAST_RZ + (WAND_DRAW_RZ - WAND_CAST_RZ) * e;
  return scratch;
}

// ── Scythe poses ────────────────────────────────────────────────
// Wider arcs than sword sweeps, with the blade hanging lower (the
// curve does the cutting). The spin finisher rotates the haft
// through a large rotZ for a full clearance motion.

function scytheReapRightPose(phase: SwingPhase, t: number): WeaponPose {
  // Cocks high-LEFT (blade lifted over left shoulder), reaps through
  // a wide low arc to the lower-RIGHT. Lower than the sword sweep
  // because the scythe blade hangs below the haft.
  return swordSweepBetween(phase, t,
    ix - 0.26, iy + 0.20, iz + 0.10,
    rx - 0.50, ry + 0.65, rz + 1.00,
    ix + 0.30, iy - 0.22, iz - 0.08,
    rx - 0.20, ry - 0.45, rz - 1.10,
  );
}

function scytheReapLeftPose(phase: SwingPhase, t: number): WeaponPose {
  // Mirror — cocks high-RIGHT, reaps to lower-LEFT.
  return swordSweepBetween(phase, t,
    ix + 0.26, iy + 0.20, iz + 0.10,
    rx - 0.50, ry - 0.65, rz - 1.00,
    ix - 0.30, iy - 0.22, iz - 0.08,
    rx - 0.20, ry + 0.45, rz + 1.10,
  );
}

function scytheSpinPose(phase: SwingPhase, t: number): WeaponPose {
  // Spin finisher — blade lifted high overhead, then a sweeping
  // 270° rotation through the rotZ axis. Reads as a clearing
  // motion even though it's still parametric per phase.
  if (phase === 'windup') {
    scratch.x = ix;
    scratch.y = iy + 0.30 * t;
    scratch.z = iz + 0.10 * t;
    scratch.rotX = rx - 0.30 * t;
    scratch.rotY = ry;
    scratch.rotZ = rz - 0.60 * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = -0.10 * ease;
    scratch.y = iy + 0.30 - 0.55 * ease;
    scratch.z = iz + 0.10 - 0.18 * ease;
    scratch.rotX = rx - 0.30 + 0.20 * ease;
    scratch.rotY = ry;
    scratch.rotZ = rz - 0.60 + 2.40 * ease;     // big rotZ sweep
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = -0.10 + (ix - (-0.10)) * e;
  scratch.y = (iy - 0.25) + (iy - (iy - 0.25)) * e;
  scratch.z = (iz - 0.08) + (iz - (iz - 0.08)) * e;
  scratch.rotX = (rx - 0.10) + (rx - (rx - 0.10)) * e;
  scratch.rotY = ry;
  scratch.rotZ = (rz + 1.80) + (rz - (rz + 1.80)) * e;
  return scratch;
}

// ── Whip poses ──────────────────────────────────────────────────
// Snappy — the WIND is the cock-back-and-coil; the STRIKE is the
// flick forward. Recoveries are short so the next crack chains.

function whipCrackRightPose(phase: SwingPhase, t: number): WeaponPose {
  // Cocks behind right shoulder, snaps forward-and-out.
  const WIND_X = ix + 0.18, WIND_Y = iy + 0.10, WIND_Z = iz + 0.10;
  const WIND_RX = rx - 0.40, WIND_RY = ry - 0.35, WIND_RZ = rz - 0.20;
  const END_X = ix + 0.18, END_Y = iy - 0.05, END_Z = iz - 0.30;
  const END_RX = rx - 0.90, END_RY = ry + 0.10, END_RZ = rz - 0.10;
  if (phase === 'windup') {
    scratch.x = ix + (WIND_X - ix) * t;
    scratch.y = iy + (WIND_Y - iy) * t;
    scratch.z = iz + (WIND_Z - iz) * t;
    scratch.rotX = rx + (WIND_RX - rx) * t;
    scratch.rotY = ry + (WIND_RY - ry) * t;
    scratch.rotZ = rz + (WIND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WIND_X + (END_X - WIND_X) * ease;
    scratch.y = WIND_Y + (END_Y - WIND_Y) * ease;
    scratch.z = WIND_Z + (END_Z - WIND_Z) * ease;
    scratch.rotX = WIND_RX + (END_RX - WIND_RX) * ease;
    scratch.rotY = WIND_RY + (END_RY - WIND_RY) * ease;
    scratch.rotZ = WIND_RZ + (END_RZ - WIND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = END_X + (ix - END_X) * e;
  scratch.y = END_Y + (iy - END_Y) * e;
  scratch.z = END_Z + (iz - END_Z) * e;
  scratch.rotX = END_RX + (rx - END_RX) * e;
  scratch.rotY = END_RY + (ry - END_RY) * e;
  scratch.rotZ = END_RZ + (rz - END_RZ) * e;
  return scratch;
}

function whipCrackLeftPose(phase: SwingPhase, t: number): WeaponPose {
  // Mirror — cocks behind left shoulder, snaps forward-and-out.
  const WIND_X = ix - 0.18, WIND_Y = iy + 0.10, WIND_Z = iz + 0.10;
  const WIND_RX = rx - 0.40, WIND_RY = ry + 0.35, WIND_RZ = rz + 0.20;
  const END_X = ix - 0.18, END_Y = iy - 0.05, END_Z = iz - 0.30;
  const END_RX = rx - 0.90, END_RY = ry - 0.10, END_RZ = rz + 0.10;
  if (phase === 'windup') {
    scratch.x = ix + (WIND_X - ix) * t;
    scratch.y = iy + (WIND_Y - iy) * t;
    scratch.z = iz + (WIND_Z - iz) * t;
    scratch.rotX = rx + (WIND_RX - rx) * t;
    scratch.rotY = ry + (WIND_RY - ry) * t;
    scratch.rotZ = rz + (WIND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WIND_X + (END_X - WIND_X) * ease;
    scratch.y = WIND_Y + (END_Y - WIND_Y) * ease;
    scratch.z = WIND_Z + (END_Z - WIND_Z) * ease;
    scratch.rotX = WIND_RX + (END_RX - WIND_RX) * ease;
    scratch.rotY = WIND_RY + (END_RY - WIND_RY) * ease;
    scratch.rotZ = WIND_RZ + (END_RZ - WIND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = END_X + (ix - END_X) * e;
  scratch.y = END_Y + (iy - END_Y) * e;
  scratch.z = END_Z + (iz - END_Z) * e;
  scratch.rotX = END_RX + (rx - END_RX) * e;
  scratch.rotY = END_RY + (ry - END_RY) * e;
  scratch.rotZ = END_RZ + (rz - END_RZ) * e;
  return scratch;
}

function whipWrapPose(phase: SwingPhase, t: number): WeaponPose {
  // Wide horizontal arc — the wrap finisher. Cocks far right, sweeps
  // across the front of the player to far left.
  return swordSweepBetween(phase, t,
    ix + 0.24, iy + 0.04, iz + 0.10,
    rx - 0.50, ry - 0.40, rz - 0.40,
    ix - 0.24, iy - 0.08, iz - 0.20,
    rx - 0.50, ry + 0.40, rz + 0.40,
  );
}

// ── Knife throw pose ───────────────────────────────────────────
// Short snappy underhand toss — the hand whips forward from the
// hip with the knife held by the blade tip, releasing on the
// strike. Combat fires 3 projectiles in a fan; this animation
// covers the gesture.

function knifeThrowPose(phase: SwingPhase, t: number): WeaponPose {
  // Wind: hand pulled back and to the hip with knife by the blade.
  const WIND_X = ix + 0.16, WIND_Y = iy + 0.04, WIND_Z = iz + 0.14;
  const WIND_RX = rx - 0.65, WIND_RY = ry - 0.15, WIND_RZ = rz - 0.30;
  // Release: hand fully extended forward.
  const END_X = ix - 0.04, END_Y = iy + 0.12, END_Z = iz - 0.28;
  const END_RX = rx - 1.20, END_RY = ry + 0.10, END_RZ = rz + 0.15;
  if (phase === 'windup') {
    scratch.x = ix + (WIND_X - ix) * t;
    scratch.y = iy + (WIND_Y - iy) * t;
    scratch.z = iz + (WIND_Z - iz) * t;
    scratch.rotX = rx + (WIND_RX - rx) * t;
    scratch.rotY = ry + (WIND_RY - ry) * t;
    scratch.rotZ = rz + (WIND_RZ - rz) * t;
    return scratch;
  }
  if (phase === 'strike') {
    const ease = 1 - (1 - t) * (1 - t);
    scratch.x = WIND_X + (END_X - WIND_X) * ease;
    scratch.y = WIND_Y + (END_Y - WIND_Y) * ease;
    scratch.z = WIND_Z + (END_Z - WIND_Z) * ease;
    scratch.rotX = WIND_RX + (END_RX - WIND_RX) * ease;
    scratch.rotY = WIND_RY + (END_RY - WIND_RY) * ease;
    scratch.rotZ = WIND_RZ + (END_RZ - WIND_RZ) * ease;
    return scratch;
  }
  const e = 1 - (1 - t) * (1 - t);
  scratch.x = END_X + (ix - END_X) * e;
  scratch.y = END_Y + (iy - END_Y) * e;
  scratch.z = END_Z + (iz - END_Z) * e;
  scratch.rotX = END_RX + (rx - END_RX) * e;
  scratch.rotY = END_RY + (ry - END_RY) * e;
  scratch.rotZ = END_RZ + (rz - END_RZ) * e;
  return scratch;
}
