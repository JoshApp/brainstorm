// Joint-based keyframe animation — the data spine.
//
// Pose      = a snapshot of joint rotations (and optional positions). Just data.
// Keyframe  = a pose pinned to a normalized time `t` ∈ [0,1] within a clip.
// Clip      = a timeline of keyframes + a default playback duration. May loop
//             (locomotion: idle, walk) or run one-shot (ability swings).
//
// The animator interprets a clip's `t` as the FRACTION of the played
// duration — so the same authored clip can be re-stretched to fit a
// shorter or longer ability window without re-keying every pose. The
// keyframes describe the SHAPE of the motion; the play call decides
// how long it takes.
//
// Rotations are stored as Euler [x,y,z] in radians. We treat them as
// DELTAS from the joint's rest pose (the slot's authored pos/rot), so
// `pose: {}` means "rest" — not "slam everything to identity."

import type { Vec3 } from '../ecs/model-types';
import type { EaseName } from './easing';

export interface JointPose {
  /** Euler XYZ delta from the joint's rest rotation. */
  rot?: Vec3;
  /** Position delta from the joint's rest position (rarely used — pelvis bob). */
  pos?: Vec3;
}

export type Pose = Record<string, JointPose>;

export interface Keyframe {
  /** Normalized time within the clip (0..1). */
  t: number;
  pose: Pose;
  /** Easing across the segment ENDING at this keyframe — the per-segment curve
   *  that makes an attack SNAP: 'easeInQuad'/'easeInCubic' on the strike keyframe
   *  accelerates the limb into the hit; 'easeOutBack' overshoots then settles.
   *  Omitted → the clip's `smooth` setting (smoothstep or linear). */
  ease?: EaseName;
}

export interface Clip {
  id: string;
  /** Default playback duration in seconds. Override at play time
   *  (abilities stretch their clip across windup+strike+recover). */
  duration: number;
  /** Loop or one-shot. Locomotion loops; ability swings don't. */
  loop?: boolean;
  /** Smoothstep between keyframes vs. raw linear. Default true — almost
   *  always what you want; raw linear reads as snappy/robotic. */
  smooth?: boolean;
  keyframes: Keyframe[];
}
