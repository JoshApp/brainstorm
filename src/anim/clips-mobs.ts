// ATTACK-VERB LIBRARY + per-mob bundles. The "simple but distinct + readable"
// answer (Minecraft economy / Darkest-Dungeon pose-reads): a small set of
// readable melee VERBS — chop, thrust, sweep, pound, lunge, cast — each a tight
// 3-pose COCK → HOLD → SNAP clip. A normal mob just picks a verb per ability;
// its identity comes from its SILHOUETTE + which verb + the held telegraph, not
// from bespoke animation. Signature mobs (the ghoul rake) author a custom clip.
//
// THE SNAP RECIPE: wind the limb to its wound pose by ~t0.34, HOLD it to ~t0.52
// (the held pose IS the telegraph), then drive to the strike pose on a keyframe
// tagged `ease: 'easeInCubic'` so the limb ACCELERATES into the hit. Recover
// settles. The clip is time-stretched to the ability's windup+strike+recover at
// play time, so the same verb reads snappy on a fast slash and heavy on a slow
// pound — duration does the rest.
//
// Joints are biped (shoulders / elbows / spine); a model missing a slot just
// skips it (the Animator silently no-ops). POSITIVE shoulder rot.x = forward/up.

import type { Clip } from './types';
import type { AnimationBundle } from '../content/enemies';

const REST: Clip = { id: 'rest', duration: 1, loop: true, keyframes: [{ t: 0, pose: {} }] };
const BIPED_JOINTS = ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'spine'] as const;

/** Build a biped attack bundle from a verb-per-ability map. Locomotion stays
 *  procedural; the base just rests the owned joints between swings. */
function bipedBundle(abilities: Record<string, Clip>): AnimationBundle {
  return { idle: REST, walk: REST, abilities, joints: [...BIPED_JOINTS] };
}

// ── The verbs ────────────────────────────────────────────────────────

// CHOP — a one-arm OVERHEAD chop (the armed hand). Raise high, hold, slam
// down-forward. The workhorse swing for armed bipeds (skeleton).
const CHOP: Clip = {
  id: 'chop', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.34, pose: { shoulderR: { rot: [2.4, 0, 0] }, shoulderL: { rot: [0.7, 0, 0] }, elbowR: { rot: [0.6, 0, 0] }, spine: { rot: [-0.2, 0, 0] } } },
    { t: 0.52, pose: { shoulderR: { rot: [2.4, 0, 0] }, shoulderL: { rot: [0.7, 0, 0] }, elbowR: { rot: [0.6, 0, 0] }, spine: { rot: [-0.2, 0, 0] } } },
    { t: 0.62, ease: 'easeInCubic', pose: { shoulderR: { rot: [0.4, 0, 0] }, shoulderL: { rot: [0.3, 0, 0] }, elbowR: { rot: [0.05, 0, 0] }, spine: { rot: [0.3, 0, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

// THRUST — a fencer's STAB. Draw the arm back with the elbow cocked, hold, then
// drive shoulder + elbow straight FORWARD (the blade lances out). Skirmisher.
const THRUST: Clip = {
  id: 'thrust', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.34, pose: { shoulderR: { rot: [-0.25, 0, 0] }, elbowR: { rot: [1.5, 0, 0] }, spine: { rot: [-0.1, 0.22, 0] } } },
    { t: 0.52, pose: { shoulderR: { rot: [-0.25, 0, 0] }, elbowR: { rot: [1.5, 0, 0] }, spine: { rot: [-0.1, 0.22, 0] } } },
    { t: 0.62, ease: 'easeInCubic', pose: { shoulderR: { rot: [0.95, 0, 0] }, elbowR: { rot: [-0.1, 0, 0] }, spine: { rot: [0.18, -0.15, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

// SWEEP — a wide HORIZONTAL slash. Wind the arm to one side (shoulder yaw) with
// a torso twist, then whip it across. Defiler's claw-slash.
const SWEEP: Clip = {
  id: 'sweep', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.34, pose: { shoulderR: { rot: [0.7, -1.3, 0] }, elbowR: { rot: [0.4, 0, 0] }, spine: { rot: [0, -0.32, 0] } } },
    { t: 0.52, pose: { shoulderR: { rot: [0.7, -1.3, 0] }, elbowR: { rot: [0.4, 0, 0] }, spine: { rot: [0, -0.32, 0] } } },
    { t: 0.62, ease: 'easeInCubic', pose: { shoulderR: { rot: [0.7, 1.2, 0] }, elbowR: { rot: [0.2, 0, 0] }, spine: { rot: [0, 0.3, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

// POUND — a two-hand overhead GROUND-SLAM. Both arms WAY up, the longest HOLD
// (the heavy tell), then both drive straight down as the body drops. Stoneguard.
const POUND: Clip = {
  id: 'pound', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.30, pose: { shoulderR: { rot: [2.7, 0, 0] }, shoulderL: { rot: [2.7, 0, 0] }, spine: { rot: [-0.28, 0, 0] }, } },
    { t: 0.58, pose: { shoulderR: { rot: [2.7, 0, 0] }, shoulderL: { rot: [2.7, 0, 0] }, spine: { rot: [-0.28, 0, 0] }, } },
    { t: 0.66, ease: 'easeInCubic', pose: { shoulderR: { rot: [0.45, 0, 0] }, shoulderL: { rot: [0.45, 0, 0] }, spine: { rot: [0.4, 0, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

// LUNGE — the CHARGE companion: coil the arms back as the body winds, then hurl
// them forward as the dash fires. Skirmisher's charge.
const LUNGE: Clip = {
  id: 'lunge', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.34, pose: { shoulderR: { rot: [-0.6, 0, 0] }, shoulderL: { rot: [-0.6, 0, 0] }, spine: { rot: [-0.3, 0, 0] } } },
    { t: 0.52, pose: { shoulderR: { rot: [-0.6, 0, 0] }, shoulderL: { rot: [-0.6, 0, 0] }, spine: { rot: [-0.3, 0, 0] } } },
    { t: 0.62, ease: 'easeInCubic', pose: { shoulderR: { rot: [1.2, 0, 0] }, shoulderL: { rot: [1.2, 0, 0] }, spine: { rot: [0.32, 0, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

// CAST — raise/spread both arms (the channel), HOLD (the cast tell), then push
// forward as the bolt releases. A gentler snap (easeOutCubic — a push, not a
// slam). Skeleton bone-throw, defiler hex.
const CAST: Clip = {
  id: 'cast', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.30, pose: { shoulderR: { rot: [1.0, 0, -0.3] }, shoulderL: { rot: [1.0, 0, 0.3] }, spine: { rot: [-0.1, 0, 0] } } },
    { t: 0.58, pose: { shoulderR: { rot: [1.0, 0, -0.3] }, shoulderL: { rot: [1.0, 0, 0.3] }, spine: { rot: [-0.1, 0, 0] } } },
    { t: 0.68, ease: 'easeOutCubic', pose: { shoulderR: { rot: [0.7, 0, 0] }, shoulderL: { rot: [0.7, 0, 0] }, spine: { rot: [0.14, 0, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

// ── Per-mob bundles — pick a verb per ability ────────────────────────

// GHOUL — signature CUSTOM clip (not a shared verb): a two-claw overhead RAKE
// with the elbows flicking the talons out + spine pitch. Moves like a ghoul.
const GHOUL_RAKE: Clip = {
  id: 'ghoul-rake', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    { t: 0.34, pose: { shoulderL: { rot: [2.3, 0, 0] }, shoulderR: { rot: [2.3, 0, 0] }, elbowL: { rot: [0.9, 0, 0] }, elbowR: { rot: [0.9, 0, 0] }, spine: { rot: [-0.22, 0, 0] } } },
    { t: 0.52, pose: { shoulderL: { rot: [2.3, 0, 0] }, shoulderR: { rot: [2.3, 0, 0] }, elbowL: { rot: [0.9, 0, 0] }, elbowR: { rot: [0.9, 0, 0] }, spine: { rot: [-0.22, 0, 0] } } },
    { t: 0.62, ease: 'easeInCubic', pose: { shoulderL: { rot: [0.5, 0, 0] }, shoulderR: { rot: [0.5, 0, 0] }, elbowL: { rot: [-0.2, 0, 0] }, elbowR: { rot: [-0.2, 0, 0] }, spine: { rot: [0.32, 0, 0] } } },
    { t: 1.0,  pose: {} },
  ],
};

export const GHOUL_BUNDLE: AnimationBundle = bipedBundle({ strike: GHOUL_RAKE });
export const SKELETON_BUNDLE: AnimationBundle = bipedBundle({ slash: CHOP, 'bone-throw': CAST });
export const SKIRMISHER_BUNDLE: AnimationBundle = bipedBundle({ slash: THRUST, charge: LUNGE });
export const DEFILER_BUNDLE: AnimationBundle = bipedBundle({ slash: SWEEP, hex: CAST });
export const STONEGUARD_BUNDLE: AnimationBundle = bipedBundle({ strike: POUND });
