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

// ── POSE → CLIP table ─────────────────────────────────────────────────
// The lookup the weapon-animations.ts evaluator consults BEFORE
// falling back to POSE_SPECS (wind/end format) and the legacy
// hand-coded path. Add a new entry here to author any pose as a
// clip — no engine work required.
export const POSE_CLIPS: Partial<Record<PoseKey, ClipSpec>> = {
  'hammer-smash': HAMMER_SMASH_CLIP,
};
