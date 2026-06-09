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

// Overhead smash — the heavy two-beat: wind the weapon arm up and back, then
// drive it down and forward on the strike, recover to rest. Stretched to the
// ability's full windup+strike+recover at play time, so t≈0.5 lands at the
// windup peak and t≈0.62 at the strike for a typical heavy.
const BIPED_SMASH: Clip = {
  id: 'biped-smash', duration: 1, loop: false,
  keyframes: [
    { t: 0.0,  pose: { shoulderR: { rot: [0, 0, 0] }, shoulderL: { rot: [0, 0, 0] } } },
    { t: 0.50, pose: { shoulderR: { rot: [-2.6, 0, 0] }, shoulderL: { rot: [-0.5, 0, 0] } } }, // raised overhead
    { t: 0.62, pose: { shoulderR: { rot: [0.7, 0, 0] }, shoulderL: { rot: [0.1, 0, 0] } } },    // slam down/forward
    { t: 1.0,  pose: { shoulderR: { rot: [0, 0, 0] }, shoulderL: { rot: [0, 0, 0] } } },
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
