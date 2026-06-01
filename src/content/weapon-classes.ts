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
  | 'sword-lunge-forward'
  | 'sword-sweep-strafe'
  | 'sword-retreat-slash'
  | 'dagger-stab'
  | 'dagger-slash'
  | 'dagger-double-stab'
  | 'hammer-swing-left'
  | 'hammer-swing-right'
  | 'hammer-smash'
  | 'spear-thrust'
  | 'spear-lunge'
  | 'crossbow-fire'
  | 'wand-cast';

export interface ComboStep {
  pose: PoseKey;
  windup: number;
  strike: number;
  recover: number;
  /** Multiplier on the weapon's base reach for this combo step.
   *  Combo finishers usually extend further (1.15-1.25); quick
   *  jabs may shorten. Default 1.0. */
  reachMul?: number;
  /** Multiplier on the weapon's base cone half-angle. Wide
   *  sweeps go up (1.2-1.4), narrow thrusts go down (0.6-0.8).
   *  Default 1.0. */
  coneHalfAngleMul?: number;
  /** Max enemies hit by this step. Sweeping arcs cleave (2-3);
   *  thrusts and stabs land on one. Default 1.
   *  When >1, the cone-scan returns the N nearest in-cone
   *  targets in distance order and damages each. */
  maxTargets?: number;
}

export interface ResolvedComboStep {
  pose: PoseKey;
  windupTime: number;
  strikeTime: number;
  recoverTime: number;
  reachMul: number;
  coneHalfAngleMul: number;
  maxTargets: number;
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
  /** On-hit status infliction, passed through from the weapon spec. */
  onHit?: { buffId: string; chance: number; duration: number };
  /** Ranged projectile (crossbow/wand) — strike fires this instead of a
   *  melee cone hit. Passed through from the weapon spec. */
  ranged?: { projectileId: string };
  /** Resolved directional move steps (lunge/sweep/retreat) — the
   *  same speed multipliers as the combo are applied. Optional;
   *  not every weapon has movement variants. */
  directionalMoves?: {
    forward?: ResolvedComboStep;
    strafe?:  ResolvedComboStep;
    back?:    ResolvedComboStep;
  };
}

/** Movement-driven attack variants. When the joystick is held past a
 *  small deadzone at the moment of a press, the swing OVERRIDES the
 *  normal combo with one of these — picked by the dominant direction.
 *  Forward = lunge (commit-and-step-in), strafe = sweep (wide cone),
 *  back = retreat-slash (quick poke + repositioning recovery).
 *
 *  Firing a directional move RESETS the normal combo to step 0 — it
 *  doesn't advance the chain. Players who want the 1-2-3 keep the
 *  joystick centred; players who want intent-driven moves point. */
export interface DirectionalMoves {
  forward?: ComboStep;
  strafe?:  ComboStep;
  back?:    ComboStep;
}

interface ClassDefaults {
  combo: ComboStep[];
  comboWindowMs: number;
  directionalMoves?: DirectionalMoves;
}

export const WEAPON_CLASS_DEFAULTS: Record<WeaponClass, ClassDefaults> = {
  dagger: {
    // stab → slash → double-stab. Stab one, slash cleaves two,
    // double-stab finisher commits on one target with extra damage.
    combo: [
      { pose: 'dagger-stab',        windup: 0.08, strike: 0.13, recover: 0.22,
        reachMul: 0.95, coneHalfAngleMul: 0.7, maxTargets: 1 },
      { pose: 'dagger-slash',       windup: 0.10, strike: 0.15, recover: 0.24,
        reachMul: 1.0,  coneHalfAngleMul: 1.3, maxTargets: 2 },
      { pose: 'dagger-double-stab', windup: 0.08, strike: 0.26, recover: 0.30,
        reachMul: 1.05, coneHalfAngleMul: 0.7, maxTargets: 1 },
    ],
    comboWindowMs: 380,
  },
  sword: {
    // slash-left → slash-right → thrust. Two sweeping arcs that
    // cleave up to two targets, then a deep thrust on one.
    combo: [
      { pose: 'sword-slash-left',
        windup:  CONFIG.SWORD_SWING_WINDUP,
        strike:  CONFIG.SWORD_SWING_STRIKE,
        recover: CONFIG.SWORD_SWING_RECOVER,
        reachMul: 1.0, coneHalfAngleMul: 1.1, maxTargets: 2 },
      { pose: 'sword-slash-right',
        windup:  CONFIG.SWORD_SWING_WINDUP,
        strike:  CONFIG.SWORD_SWING_STRIKE,
        recover: CONFIG.SWORD_SWING_RECOVER,
        reachMul: 1.0, coneHalfAngleMul: 1.1, maxTargets: 2 },
      { pose: 'sword-thrust', windup: 0.14, strike: 0.12, recover: 0.34,
        reachMul: 1.25, coneHalfAngleMul: 0.6, maxTargets: 1 },
    ],
    comboWindowMs: 380,
    // Move-driven variants — pick by joystick direction at press time.
    // Each one is a one-off (resets combo to step 0 after firing).
    directionalMoves: {
      // FORWARD lunge — commit-and-step-in. Long reach, narrow cone,
      // single target. The "I see an opening, I take it" attack.
      // Slightly slower recover than a tap-thrust because you've
      // physically stepped in and need a beat to reset.
      forward: { pose: 'sword-lunge-forward', windup: 0.12, strike: 0.16, recover: 0.42,
                 reachMul: 1.50, coneHalfAngleMul: 0.45, maxTargets: 1 },
      // STRAFE sweep — wide horizontal arc that catches multiple
      // adjacent enemies. The crowd-clearance answer when two mobs
      // pin you on a side.
      strafe:  { pose: 'sword-sweep-strafe', windup: 0.16, strike: 0.18, recover: 0.40,
                 reachMul: 1.0,  coneHalfAngleMul: 1.7,  maxTargets: 3 },
      // BACK retreating slash — fast poke as the player backs off.
      // Modest damage, but the SHORT recover lets you reposition
      // immediately. The "fighting retreat" answer to a charge.
      back:    { pose: 'sword-retreat-slash', windup: 0.08, strike: 0.10, recover: 0.22,
                 reachMul: 1.1,  coneHalfAngleMul: 0.7,  maxTargets: 1 },
    },
  },
  hammer: {
    // swing-right → swing-left → smash. Wide horizontal sweeps
    // cleave two; the overhead smash finisher catches up to three
    // with the widest area + a longer effective reach.
    combo: [
      { pose: 'hammer-swing-right', windup: 0.20, strike: 0.12, recover: 0.36,
        reachMul: 1.0, coneHalfAngleMul: 1.2, maxTargets: 2 },
      { pose: 'hammer-swing-left',  windup: 0.20, strike: 0.12, recover: 0.36,
        reachMul: 1.0, coneHalfAngleMul: 1.2, maxTargets: 2 },
      { pose: 'hammer-smash',       windup: 0.28, strike: 0.14, recover: 0.50,
        reachMul: 1.15, coneHalfAngleMul: 1.4, maxTargets: 3 },
    ],
    comboWindowMs: 520,
  },
  spear: {
    // thrust → thrust → lunge. Spear stays narrow + single-target
    // — it pokes, it doesn't sweep. Lunge finisher extends reach.
    combo: [
      { pose: 'spear-thrust', windup: 0.12, strike: 0.12, recover: 0.26,
        reachMul: 1.0, coneHalfAngleMul: 1.0, maxTargets: 1 },
      { pose: 'spear-thrust', windup: 0.12, strike: 0.12, recover: 0.26,
        reachMul: 1.0, coneHalfAngleMul: 1.0, maxTargets: 1 },
      { pose: 'spear-lunge',  windup: 0.16, strike: 0.16, recover: 0.40,
        reachMul: 1.30, coneHalfAngleMul: 0.85, maxTargets: 1 },
    ],
    comboWindowMs: 420,
  },
  // RANGED classes — a single "fire" step (no combo chain). The strike
  // spawns the weapon's projectile (combat/attack.ts) instead of a melee
  // cone; the long recover IS the reload/draw — the cadence cost that
  // keeps ranged from obsoleting melee. comboWindowMs 0 → never chains.
  crossbow: {
    // Crossbow — level + brace (windup), snap recoil (strike), then the
    // long re-cock dip (recover IS the reload). 'crossbow-fire' pose.
    combo: [{ pose: 'crossbow-fire', windup: 0.12, strike: 0.10, recover: 0.85 }],
    comboWindowMs: 0,
  },
  wand: {
    // Wand — a channelled gather (longer windup), forward cast snap
    // (strike), settle (recover). 'wand-cast' pose.
    combo: [{ pose: 'wand-cast', windup: 0.45, strike: 0.10, recover: 0.55 }],
    comboWindowMs: 0,
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
    reachMul: step.reachMul ?? 1,
    coneHalfAngleMul: step.coneHalfAngleMul ?? 1,
    maxTargets: step.maxTargets ?? 1,
  }));

  // Directional move resolution mirrors the combo resolution — same
  // proficiency-speed multiplier, no special-case math.
  const resolveStep = (step: ComboStep): ResolvedComboStep => ({
    pose: step.pose,
    windupTime:  step.windup  * timeMul,
    strikeTime:  step.strike  * timeMul,
    recoverTime: step.recover * timeMul,
    reachMul: step.reachMul ?? 1,
    coneHalfAngleMul: step.coneHalfAngleMul ?? 1,
    maxTargets: step.maxTargets ?? 1,
  });
  const directionalMoves = baseT.directionalMoves ? {
    forward: baseT.directionalMoves.forward && resolveStep(baseT.directionalMoves.forward),
    strafe:  baseT.directionalMoves.strafe  && resolveStep(baseT.directionalMoves.strafe),
    back:    baseT.directionalMoves.back    && resolveStep(baseT.directionalMoves.back),
  } : undefined;

  return {
    reach: spec.reach,
    coneHalfAngle: spec.coneHalfAngle,
    damage: spec.damage * profDmgMul,
    critChance: (spec.critChance ?? 0.05) + acuityCrit,
    critMultiplier: spec.critMultiplier ?? 2.0,
    class: cls,
    combo,
    comboWindowMs: baseT.comboWindowMs,
    onHit: spec.onHit,
    ranged: spec.ranged,
    directionalMoves,
  };
}
