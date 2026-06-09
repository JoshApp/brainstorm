import type { Clip } from './types';
import type { AnimationBundle } from '../content/enemies';
import type { Archetype } from '../content/creature-types';

// Shared per-archetype clip library (docs/CREATURE-SYSTEM.md). Authored ONCE in
// joint space; every creature of the archetype plays it — a new enemy is
// animated the moment it exists. Locomotion stays PROCEDURAL (distance-synced
// gait in enemy-animation.ts — no foot-slide); these clips own ATTACKS, which
// are one-shot and time-stretched to the ability window, so they never fight
// the procedural layers.
//
// Joint ownership is deliberately narrow: the biped bundle owns ONLY the
// shoulders, so it never clobbers spine (windup/stagger tilt), neck (head-crane),
// or the legs (gait). The legacy telegraph POSE is gated off for creatures
// (enemy.ts) so the clip is the sole driver of the attack swing.

// A near-empty base — keeps the owned joints (shoulders) at rest while not
// attacking, so arms hang naturally between swings.
const BIPED_REST: Clip = {
  id: 'biped-rest', duration: 1, loop: true,
  keyframes: [{ t: 0, pose: {} }],
};

// Author limb swings by INTENT, not Euler guesses. A limb bone hangs along its
// joint's local −Y at rest; rotating the shoulder about its local +X sweeps the
// arm in the sagittal plane. We verified the SIGN: POSITIVE pitch swings the arm
// FORWARD/UP, negative swings it BACK (the old [-2.6,…] "arm twists behind" bug).
// Single-axis on purpose — the Animator lerps Euler linearly between keyframes,
// so a planar one-axis swing tweens cleanly (orient()'s multi-axis/near-±π
// outputs can take a wrong-way path when tweened — great for static poses, risky
// for keyframes). amount in radians: ~0.8 ≈ 45°, ~1.6 ≈ 90°, ~2.4 ≈ 137°.
function limbPitch(forward: number): [number, number, number] {
  return [forward, 0, 0];
}
const ARM_REST = limbPitch(0);
const ARM_RAISED = limbPitch(2.4);  // overhead, swung FORWARD (not behind)
const ARM_SLAM = limbPitch(0.6);    // driven down + forward through the strike

// Overhead smash — the heavy two-beat: both arms wind up overhead-forward, then
// drive down on the strike, recover to rest. Stretched to the ability's full
// windup+strike+recover at play time, so t≈0.5 is the windup peak, t≈0.62 the
// strike.
const BIPED_SMASH: Clip = {
  id: 'biped-smash', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: { shoulderR: { rot: ARM_REST }, shoulderL: { rot: ARM_REST } } },
    { t: 0.50, pose: { shoulderR: { rot: ARM_RAISED }, shoulderL: { rot: ARM_RAISED } } },
    { t: 0.62, pose: { shoulderR: { rot: ARM_SLAM }, shoulderL: { rot: ARM_SLAM } } },
    { t: 1.0,  pose: { shoulderR: { rot: ARM_REST }, shoulderL: { rot: ARM_REST } } },
  ],
};

const BIPED_BUNDLE: AnimationBundle = {
  idle: BIPED_REST,
  walk: BIPED_REST,                 // locomotion is procedural; base just rests arms
  abilities: { strike: BIPED_SMASH }, // default melee ability id (see defaultAbility)
  joints: ['shoulderL', 'shoulderR'],
};

/** The clip bundle for a creature archetype, or undefined if it has none yet
 *  (those creatures animate purely procedurally). */
export const ARCHETYPE_CLIPS: Partial<Record<Archetype, AnimationBundle>> = {
  biped: BIPED_BUNDLE,
};
