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
// SHOULDER-PIVOT swing (the proven FPS technique): the main arc comes
// from `shoulder.rot.x` — the whole arm + hand + weapon swings around
// the shoulder slot, the way a real overhead smash pivots from the
// scapula, not the wrist. The weapon.pos / weapon.rot channels carry
// only fine wrist motion (lead, counter-tilt, settle bobble) on top.
// Smaller weapon-translation values + bigger shoulder rotation = the
// hammer arcs through space instead of teleporting + flopping.
export const HAMMER_SMASH_CLIP: ClipSpec = {
  duration: 1.0,
  tracks: {
    // SHOULDER PITCH — the main arc. Positive X rotates the arm chain
    // BACK (windup), negative X swings it forward and DOWN (strike).
    'shoulder.rot.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.08, v: -0.10, ease: 'easeOutCubic' },       // tiny dip — anticipation
      { t: 0.22, v:  1.10, ease: 'easeOutBack' },        // wind UP-BACK over shoulder
      { t: 0.32, v:  1.10, ease: 'easeOutCubic' },       // hold at peak
      { t: 0.45, v: -0.85, ease: 'easeInQuad' },         // SMASH down-and-forward
      { t: 0.55, v: -0.65, ease: 'easeOutCubic' },       // settle past horizontal
      { t: 0.85, v:  0.05, ease: 'easeOutCubic' },
      { t: 1.00, v:  0.00 },
    ],
    // WRIST LEAD — small lateral motion the shoulder pitch can't
    // carry. Keeps the hammer head from reading as straight-overhead
    // by giving it a slight side-to-side lead.
    'weapon.pos.x': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.04, ease: 'easeInOutCubic' },     // lean left during wind
      { t: 0.45, v:  0.00, ease: 'easeInQuad' },         // centre on impact
      { t: 1.00, v:  0.00 },
    ],
    // FINE WRIST TILT — counter-tilt on impact for the "torque-twist"
    // feel without re-doing the shoulder pitch.
    'weapon.rot.z': [
      { t: 0.00, v:  0.00 },
      { t: 0.22, v: -0.20, ease: 'easeInOutCubic' },     // tilt L during windup
      { t: 0.45, v:  0.25, ease: 'easeInQuad' },         // counter-tilt on impact
      { t: 0.55, v:  0.20, ease: 'easeOutCubic' },       // hold counter
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
