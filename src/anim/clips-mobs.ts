// PER-MOB attack clips — each common mob's signature melee, authored in joint
// space so it reads as ITS OWN move, not a shared archetype swing. This is the
// identity layer: assign a bundle to spec.animation and the mob plays its own
// attack (clip is time-stretched to the ability's windup+strike+recover at play
// time — see Animator.playOverride). The shared BIPED_SMASH is retired.
//
// THE SNAP RECIPE (cock → hold → strike): wind the limb to its wound pose
// EARLY, HOLD it (the held pose IS the telegraph), then drive to the strike
// pose on a keyframe tagged `ease: 'easeInCubic'` so the limb ACCELERATES into
// the hit. Recover settles back. Slow heavies just give the ability a long
// `strike` duration — the same curve reads as a big committed blow.

import type { Clip } from './types';
import type { AnimationBundle } from '../content/enemies';

const REST: Clip = { id: 'rest', duration: 1, loop: true, keyframes: [{ t: 0, pose: {} }] };

// GHOUL — a two-claw OVERHEAD RAKE. Arms wind way overhead with the talons
// drawn back (cock), HOLD, then rake down: shoulders slam, elbows FLICK the
// claws out, the spine pitches into it — all accelerating into contact. The
// elbow flick + spine pitch are what make it a clawed rake, not a plain swing.
const GHOUL_RAKE: Clip = {
  id: 'ghoul-rake', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: {} },
    // Cock — overhead, talons drawn, rear back.
    { t: 0.34, pose: {
      shoulderL: { rot: [2.3, 0, 0] }, shoulderR: { rot: [2.3, 0, 0] },
      elbowL:    { rot: [0.9, 0, 0] }, elbowR:    { rot: [0.9, 0, 0] },
      spine:     { rot: [-0.22, 0, 0] },
    } },
    // HOLD the wound pose — the telegraph.
    { t: 0.52, pose: {
      shoulderL: { rot: [2.3, 0, 0] }, shoulderR: { rot: [2.3, 0, 0] },
      elbowL:    { rot: [0.9, 0, 0] }, elbowR:    { rot: [0.9, 0, 0] },
      spine:     { rot: [-0.22, 0, 0] },
    } },
    // RAKE down — accelerate into the hit (easeInCubic on this segment).
    { t: 0.62, ease: 'easeInCubic', pose: {
      shoulderL: { rot: [0.5, 0, 0] }, shoulderR: { rot: [0.5, 0, 0] },
      elbowL:    { rot: [-0.2, 0, 0] }, elbowR:   { rot: [-0.2, 0, 0] },
      spine:     { rot: [0.32, 0, 0] },
    } },
    // Settle.
    { t: 1.0, pose: {} },
  ],
};

export const GHOUL_BUNDLE: AnimationBundle = {
  idle: REST,
  walk: REST,                  // locomotion is procedural (gait); base just rests the owned joints
  abilities: { strike: GHOUL_RAKE },
  joints: ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'spine'],
};
