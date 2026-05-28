import { CONFIG } from '../config';
import type { WeaponStats, WeaponClass } from './items';
import { getCharacter } from '../state/character';

// Weapon classes — pick the animation archetype and seed the default
// timings. Each weapon spec can override individual fields; class is
// just the baseline + the animation routing.
//
//   dagger  fast forward stab — short reach, narrow cone, crit-fish
//   sword   diagonal slash    — medium reach + cone, the baseline
//   hammer  overhead smash    — long reach, wide cone, no crits
//
// resolveWeaponStats() flattens class defaults → spec overrides →
// attackSpeed multiplier into a single fully-populated stat block.
// Combat + the sword viewmodel both consume the RESOLVED stats so
// per-instance overrides flow through with no special cases.

// Pose keys identify a per-step animation curve in weapon-animations.ts.
// Adding a new combo step starts with adding its pose key here, then
// writing the matching pose() function over there. The string-key
// indirection lets one class reuse another's pose (e.g. a future
// "longsword" combo step could borrow 'sword-slash-left' for its first hit).
export type PoseKey =
  | 'sword-slash-left'
  | 'sword-slash-right'
  | 'sword-thrust'
  | 'dagger-stab'
  | 'dagger-slash'
  | 'dagger-double-stab'
  | 'hammer-swing-left'
  | 'hammer-swing-right'
  | 'hammer-smash';

export interface ComboStep {
  pose: PoseKey;
  windup: number;
  strike: number;
  recover: number;
}

export interface ResolvedComboStep {
  pose: PoseKey;
  windupTime: number;
  strikeTime: number;
  recoverTime: number;
}

export interface ResolvedWeaponStats {
  reach: number;
  coneHalfAngle: number;
  damage: number;
  critChance: number;
  critMultiplier: number;
  class: WeaponClass;
  /** Ordered combo steps. A press while idle within comboWindowMs of
   *  the previous step's recover-end advances to the next step;
   *  outside the window, the combo resets to step 0. The array wraps
   *  — pressing past the last step starts over at 0. */
  combo: ResolvedComboStep[];
  comboWindowMs: number;
}

interface ClassDefaults {
  combo: ComboStep[];
  comboWindowMs: number;
}

export const WEAPON_CLASS_DEFAULTS: Record<WeaponClass, ClassDefaults> = {
  dagger: {
    // stab → slash → stab-stab. Each step gets progressively beefier;
    // the finisher commits the player with the longest recover so
    // missing the third tap on a backpedalling enemy genuinely hurts.
    combo: [
      { pose: 'dagger-stab',        windup: 0.08, strike: 0.13, recover: 0.22 },
      { pose: 'dagger-slash',       windup: 0.10, strike: 0.15, recover: 0.24 },
      { pose: 'dagger-double-stab', windup: 0.08, strike: 0.26, recover: 0.30 },
    ],
    comboWindowMs: 380,
  },
  sword: {
    // slash-left → slash-right → thrust. Step 0 and step 1 use the
    // shared sword-swing timings (mirrored animations); the thrust
    // finisher gets a slightly longer recover so missing it stings.
    combo: [
      { pose: 'sword-slash-left',
        windup:  CONFIG.SWORD_SWING_WINDUP,
        strike:  CONFIG.SWORD_SWING_STRIKE,
        recover: CONFIG.SWORD_SWING_RECOVER },
      { pose: 'sword-slash-right',
        windup:  CONFIG.SWORD_SWING_WINDUP,
        strike:  CONFIG.SWORD_SWING_STRIKE,
        recover: CONFIG.SWORD_SWING_RECOVER },
      { pose: 'sword-thrust', windup: 0.14, strike: 0.12, recover: 0.34 },
    ],
    comboWindowMs: 380,
  },
  hammer: {
    // swing-left → swing-right → smash. Two horizontal side-strikes
    // then the existing overhead crash as the committing finisher.
    // Steps 0/1 are lighter than the smash so the player can chain
    // smoothly into the heavy third hit.
    combo: [
      { pose: 'hammer-swing-left',  windup: 0.20, strike: 0.12, recover: 0.36 },
      { pose: 'hammer-swing-right', windup: 0.20, strike: 0.12, recover: 0.36 },
      { pose: 'hammer-smash',       windup: 0.28, strike: 0.14, recover: 0.50 },
    ],
    // Wider window than dagger/sword — the hammer's slow recover
    // means chaining feels OK on a less twitchy press.
    comboWindowMs: 520,
  },
};

// Per-proficiency bonus tuning. Each point of weapon-class proficiency
// shaves a small percentage off the timings AND adds the same to the
// damage. Capped at PROFICIENCY_CAP so a long run doesn't trivialise
// floor 1 — at the cap one weapon class is ~25% faster + 25% harder
// hitting than its baseline.
const PROFICIENCY_PER_POINT = 0.005;     // 0.5% per point
const PROFICIENCY_CAP_PCT  = 0.25;       // hard cap at 25% (50 points)
// Acuity adds 2% crit chance per point.
const ACUITY_CRIT_PER_POINT = 0.02;

/** Flatten class defaults + per-spec overrides + attackSpeed +
 *  character proficiency + Acuity into a single resolved stat block.
 *  Cheap; called per-frame from combat + sword animation.
 *
 *  When the player has zero character points across the board (start
 *  of a fresh run, the unspent ones still in the pool), the resolved
 *  stats equal the spec exactly — no surprises in early-game balance. */
export function resolveWeaponStats(spec: WeaponStats): ResolvedWeaponStats {
  const cls: WeaponClass = spec.class ?? 'sword';
  const baseT = WEAPON_CLASS_DEFAULTS[cls];
  const speedMul = 1 / (spec.attackSpeed ?? 1);    // larger attackSpeed → SHORTER timings

  const char = getCharacter();
  const profPct = Math.min(PROFICIENCY_CAP_PCT, char.proficiencies[cls] * PROFICIENCY_PER_POINT);
  const profSpeed = 1 - profPct;      // shorter timings as proficiency rises
  const profDmgMul = 1 + profPct;     // damage scales the same direction
  const acuityCrit = char.attributes.acuity * ACUITY_CRIT_PER_POINT;

  // Same speed multipliers apply uniformly to every combo step.
  const timeMul = speedMul * profSpeed;
  const combo: ResolvedComboStep[] = baseT.combo.map(step => ({
    pose: step.pose,
    windupTime:  step.windup  * timeMul,
    strikeTime:  step.strike  * timeMul,
    recoverTime: step.recover * timeMul,
  }));

  return {
    reach: spec.reach,
    coneHalfAngle: spec.coneHalfAngle,
    damage: spec.damage * profDmgMul,
    critChance: (spec.critChance ?? 0.05) + acuityCrit,
    critMultiplier: spec.critMultiplier ?? 2.0,
    class: cls,
    combo,
    comboWindowMs: baseT.comboWindowMs,
  };
}
