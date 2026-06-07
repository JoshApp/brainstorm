import type { ClipSpec } from '../anim/keyframes';
import type { PoseKey } from './weapon-classes';

// Per-pose CLIP overrides — the new ClipSpec format. When a pose key
// has an entry here, the weapon viewmodel uses the clip's keyframes
// instead of the two-keyframe POSE_SPEC. The clip lets us add motion
// the wind/end format can't express: anticipation pulses, peak holds,
// impact overshoot, settle bobble — the things that make a heavy swing
// feel HEAVY rather than just translate.
//
// Time convention (so phase mapping is consistent across weapons):
//   t ∈ [0.00, 0.25]  — windup phase   (player's wind input)
//   t ∈ [0.25, 0.50]  — strike phase   (the active hit window)
//   t ∈ [0.50, 1.00]  — recover phase  (return to idle)
//
// Channels are weapon-local rigid-body offsets, identical to the
// WeaponPose fields the legacy POSE_SPECS evaluate to. The clip
// evaluator (weapon-animations.ts) maps current swing-phase + phase
// progress to clip time, samples each track, and writes the resulting
// pose. Springs/sway layers compose ON TOP of the clip sample, not
// instead of it.

// ── HAMMER SMASH ─ overhead two-handed slam ─────────────────────────
//
// Reads as committed weight: dips before lifting (anticipation), holds
// at the peak (read), drops with snap into impact, overshoots slightly,
// then settles with a small bobble. Every keyframe carries an EASE that
// shapes the segment ENDING at it — the bench's --anim contact sheet
// reveals each one's contribution one tile at a time.
//
// Animation drives the WEAPON's translation + rotation; the arm
// chains onto the weapon's wrist via the runtime IK (src/anim/arm-
// ik.ts + viewmodel.ts), so the bones follow the hand wherever the
// clip puts it. The previous shoulder-pivot channels are gone — that
// approach constrained the weapon to the surface of an arm-radius
// sphere, which cost the smash its full vertical reach and didn't
// match how the rest of the swing system authors.
export const HAMMER_SMASH_CLIP: ClipSpec = {
  duration: 1.0,
  tracks: {
    'weapon.pos.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.08, v:  0.02, ease: 'easeOutCubic' },        // tiny forward lead
      { t: 0.22, v: -0.10, ease: 'easeInOutCubic' },     // wind back-left
      { t: 0.30, v: -0.10, ease: 'easeOutCubic' },        // peak hold
      { t: 0.45, v:  0.00, ease: 'easeInQuad' },         // snap to centre on impact
      { t: 0.55, v:  0.02, ease: 'easeOutCubic' },        // overshoot
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },       // settle
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.08, v: -0.10, ease: 'easeOutCubic' },        // ANTICIPATION dip
      { t: 0.22, v:  0.55, ease: 'easeOutBack' },        // raise high — overshoot top
      { t: 0.32, v:  0.55, ease: 'easeOutCubic' },        // hold at peak (read time)
      { t: 0.45, v: -0.30, ease: 'easeInQuad' },         // SMASH DOWN
      { t: 0.55, v: -0.20, ease: 'easeOutCubic' },        // bounce-back
      { t: 0.78, v: -0.05, ease: 'easeOutCubic' },       // settle low
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.08, ease: 'easeInOutCubic' },     // wind back
      { t: 0.32, v:  0.08, ease: 'easeOutCubic' },        // hold
      { t: 0.45, v: -0.12, ease: 'easeInQuad' },         // smash forward
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },       // settle
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.08, v: -0.10, ease: 'easeOutCubic' },        // dip down at anticipation
      { t: 0.22, v:  1.40, ease: 'easeOutBack' },        // big cock-back tilt
      { t: 0.32, v:  1.40, ease: 'easeOutCubic' },        // hold at peak
      { t: 0.45, v: -1.10, ease: 'easeInQuad' },         // SMASH forward
      { t: 0.55, v: -0.95, ease: 'easeOutCubic' },        // settle past horizontal
      { t: 0.85, v:  0.05, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.20, ease: 'easeInOutCubic' },     // tilt L during windup
      { t: 0.45, v:  0.25, ease: 'easeInQuad' },         // counter-tilt on impact
      { t: 0.55, v:  0.20, ease: 'easeOutCubic' },        // hold counter
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },       // back to neutral
      { t: 1.00, v:  0.00 },
    ],
  },
};

// ── SWORD COMBO ─ 1-2-3 ────────────────────────────────────────────
//
// Three clips making one continuous routine: a quick diagonal slash
// (step 1), a counter rising slice (step 2), and a committed thrust
// finisher (step 3). Authored with the same anticipation / peak hold
// / impact snap / settle envelope as HAMMER_SMASH — what makes a
// swing FEEL like a swing rather than two endpoints interpolated.
//
// Channels are deltas off the weapon's idle pose (CONFIG.SWORD_IDLE_*),
// so dropping the idle Y to lower the rest pose drops every keyframe
// here with it — no per-clip retune needed when the idle moves.

// Step 1 — quick diagonal cut from upper-right to lower-left. Opens
// the chain; minimal commit, fast reset to invite chaining.
export const SWORD_SLASH_LEFT_CLIP: ClipSpec = {
  duration: 1.0,
  tracks: {
    'weapon.pos.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.06, ease: 'easeOutCubic' },   // cock right
      { t: 0.30, v:  0.06 },                          // peak hold (load)
      { t: 0.45, v: -0.16, ease: 'easeInQuad' },     // SLASH through to left
      { t: 0.55, v: -0.10, ease: 'easeOutCubic' },   // overshoot back
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },   // settle
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.05, v: -0.03, ease: 'easeOutCubic' },   // anticipation dip
      { t: 0.22, v:  0.18, ease: 'easeOutBack' },    // raise + overshoot top
      { t: 0.30, v:  0.15, ease: 'easeOutCubic' },   // peak hold
      { t: 0.45, v: -0.28, ease: 'easeInQuad' },     // CHOP down
      { t: 0.55, v: -0.20, ease: 'easeOutCubic' },   // bounce
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.06, ease: 'easeOutCubic' },   // pulled back
      { t: 0.30, v:  0.06 },
      { t: 0.45, v: -0.10, ease: 'easeInQuad' },     // pushed through cut
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.05, v:  0.05 },                          // tiny opposite tilt
      { t: 0.22, v: -0.95, ease: 'easeOutBack' },    // big cock-back
      { t: 0.30, v: -0.95 },                          // peak hold
      { t: 0.45, v:  0.70, ease: 'easeInQuad' },     // chop through arc
      { t: 0.55, v:  0.55, ease: 'easeOutCubic' },   // settle past horizontal
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.10, ease: 'easeOutCubic' },   // edge cocked
      { t: 0.45, v:  0.30, ease: 'easeInQuad' },     // edge leads slice
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
  },
};

// Step 2 — counter rising slice from lower-right to upper-right,
// pushing forward. The X-cut completion of step 1.
export const SWORD_SLASH_RIGHT_CLIP: ClipSpec = {
  duration: 1.0,
  tracks: {
    'weapon.pos.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.05, v: -0.02 },                          // tiny opposite anticipation
      { t: 0.22, v:  0.10, ease: 'easeOutCubic' },   // cock low-right
      { t: 0.30, v:  0.10 },                          // peak hold
      { t: 0.45, v:  0.18, ease: 'easeInQuad' },     // sweep right-up
      { t: 0.55, v:  0.20, ease: 'easeOutCubic' },   // slight overshoot
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.15, ease: 'easeOutCubic' },   // dip low to load
      { t: 0.30, v: -0.15 },                          // peak hold (low)
      { t: 0.45, v:  0.10, ease: 'easeInQuad' },     // RISING slice
      { t: 0.55, v:  0.13, ease: 'easeOutCubic' },   // overshoot up
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.08, ease: 'easeOutCubic' },   // pulled back
      { t: 0.30, v:  0.08 },
      { t: 0.45, v: -0.24, ease: 'easeInQuad' },     // push forward through cut
      { t: 0.55, v: -0.20, ease: 'easeOutCubic' },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.55, ease: 'easeOutCubic' },   // pitch fwd, tip down
      { t: 0.30, v:  0.55 },
      { t: 0.45, v: -0.45, ease: 'easeInQuad' },     // rotate up-forward
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.45, v: -0.10, ease: 'easeInQuad' },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.10, ease: 'easeOutCubic' },
      { t: 0.45, v:  0.50, ease: 'easeInQuad' },     // edge leads slice
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
  },
};

// Step 3 — committed thrust finisher. Centerline pull, brief held
// read at the peak windup ("the look"), then a snap forward + small
// peak hold inside the target, then a smooth retract.
export const SWORD_THRUST_CLIP: ClipSpec = {
  duration: 1.0,
  tracks: {
    'weapon.pos.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.08, ease: 'easeOutCubic' },   // pull to centerline
      { t: 0.50, v: -0.08 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.05, v: -0.02 },                          // anticipation dip
      { t: 0.22, v:  0.10, ease: 'easeOutCubic' },   // raise to eye-line
      { t: 0.50, v:  0.10 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.05, v:  0.04 },                          // tiny load
      { t: 0.22, v:  0.12, ease: 'easeOutCubic' },   // cocked back
      { t: 0.32, v:  0.12 },                          // HOLD (read time)
      { t: 0.42, v: -0.43, ease: 'easeInQuad' },     // SNAP forward
      { t: 0.48, v: -0.43 },                          // peak hold (inside target)
      { t: 0.56, v: -0.36, ease: 'easeOutCubic' },   // begin retract
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -1.15, ease: 'easeOutCubic' },   // tip points forward
      { t: 0.50, v: -1.15 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.15, ease: 'easeOutCubic' },
      { t: 0.50, v:  0.15 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.40, ease: 'easeOutCubic' },
      { t: 0.50, v: -0.40 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
  },
};

// Forward-step lunge — fires when the player presses with the
// joystick pushed forward. A bigger thrust + step-in commit, but the
// previous spec extended to z=−0.64 which felt like jamming the blade
// halfway through the wall. Reined in to z=−0.42 — still more reach
// than the combo thrust (0.43), small but visible commit.
export const SWORD_LUNGE_FORWARD_CLIP: ClipSpec = {
  duration: 1.0,
  tracks: {
    'weapon.pos.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.10, ease: 'easeOutCubic' },
      { t: 0.50, v: -0.10 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.14, ease: 'easeOutCubic' },
      { t: 0.50, v:  0.14 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.pos.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.08, v:  0.06 },                          // tiny load
      { t: 0.22, v:  0.16, ease: 'easeOutCubic' },   // wind back (deep — it's a commit)
      { t: 0.32, v:  0.16 },                          // HOLD (read — "I am stepping in")
      { t: 0.42, v: -0.42, ease: 'easeInQuad' },     // SNAP forward — REDUCED from -0.64
      { t: 0.50, v: -0.42 },                          // peak hold
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -1.30, ease: 'easeOutCubic' },
      { t: 0.50, v: -1.30 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.y': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v:  0.18, ease: 'easeOutCubic' },
      { t: 0.50, v:  0.18 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    'weapon.rot.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.45, ease: 'easeOutCubic' },
      { t: 0.50, v: -0.45 },
      { t: 0.85, v:  0.00, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
  },
};

// ── POSE → CLIP table ─────────────────────────────────────────────────
// The lookup the weapon-animations.ts evaluator consults BEFORE
// falling back to POSE_SPECS (wind/end format) and the legacy
// hand-coded path. Add a new entry here to author any pose as a
// clip — no engine work required.
export const POSE_CLIPS: Partial<Record<PoseKey, ClipSpec>> = {
  'hammer-smash': HAMMER_SMASH_CLIP,
  'sword-slash-left': SWORD_SLASH_LEFT_CLIP,
  'sword-slash-right': SWORD_SLASH_RIGHT_CLIP,
  'sword-thrust': SWORD_THRUST_CLIP,
  'sword-lunge-forward': SWORD_LUNGE_FORWARD_CLIP,
};
