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
  | 'sword-sweep-left'
  | 'sword-sweep-right'
  | 'sword-retreat-slash'
  | 'sword-ward-back'
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
  /** Resolved directional move steps (lunge/sweeps/retreat) — the
   *  same speed multipliers as the combo are applied. Optional;
   *  not every weapon has movement variants. */
  directionalMoves?: {
    forward?: ResolvedComboStep;
    strafeLeft?: ResolvedComboStep;
    strafeRight?: ResolvedComboStep;
    back?: ResolvedComboStep;
  };
  /** Resolved charged-release special moves. Same shape as directional
   *  moves; fires only when releasing a charge in the matching
   *  direction. If absent for a direction, the regular directional
   *  (or combo) step fires with the standard charge modifiers
   *  stacked. */
  chargedMoves?: {
    forward?: ResolvedComboStep;
    strafe?: ResolvedComboStep;
    back?: ResolvedComboStep;
  };
}

/** Movement-driven attack variants. When the joystick is held past a
 *  small deadzone at the moment of a press, the swing OVERRIDES the
 *  normal combo with one of these — picked by the dominant direction.
 *  Forward = lunge (commit-and-step-in), strafe-L/R = directional
 *  sweeps (wide cone, mirrored arc), back = retreat-slash (quick
 *  poke + repositioning recovery).
 *
 *  Firing a directional move RESETS the normal combo to step 0 — it
 *  doesn't advance the chain. Players who want the 1-2-3 keep the
 *  joystick centred; players who want intent-driven moves point. */
export interface DirectionalMoves {
  forward?: ComboStep;
  strafeLeft?: ComboStep;
  strafeRight?: ComboStep;
  back?: ComboStep;
}

/** Charged-release SPECIAL moves — only accessible by HOLDING to
 *  charge AND releasing in a direction. These are distinct moves
 *  the player can't reach with a tap. If a charged release in a
 *  given direction has NO entry here, the regular directional (or
 *  combo) step fires with the standard +30% reach / +40% cone /
 *  +80% damage charge modifiers stacked on top — i.e. directional
 *  moves are still "chargeable" by default; ChargedMoves adds the
 *  next tier of expression on top.
 *
 *  Today: sword has a chargedMoves.back ("ward") — a defensive
 *  push that creates space when the player is on the back foot.
 *  Spin sweep (chargedMoves.strafe) is teed up for the next pass. */
export interface ChargedMoves {
  forward?: ComboStep;
  strafe?: ComboStep;       // shared between strafe-left and strafe-right
  back?: ComboStep;
}

interface ClassDefaults {
  combo: ComboStep[];
  comboWindowMs: number;
  directionalMoves?: DirectionalMoves;
  chargedMoves?: ChargedMoves;
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
    // Dagger directional moves — reuse existing combo poses to keep
    // pose-authoring tight; movement intent reshapes the swing's
    // stats (reach / cone / damage) rather than the animation.
    directionalMoves: {
      // FORWARD: a longer thrusting stab. Reuses the basic stab pose
      // but with extended reach and a faster snap — the assassin's
      // "I see an opening" beat.
      forward:     { pose: 'dagger-stab',        windup: 0.06, strike: 0.12, recover: 0.30,
                     reachMul: 1.30, coneHalfAngleMul: 0.5, maxTargets: 1 },
      // STRAFE: double-stab — two rapid cuts as the body weaves
      // sideways. Same pose as the combo finisher with strafe-fit
      // timing and a slightly wider catch.
      strafeLeft:  { pose: 'dagger-slash', windup: 0.08, strike: 0.18, recover: 0.26,
                     reachMul: 1.0,  coneHalfAngleMul: 1.5, maxTargets: 2 },
      strafeRight: { pose: 'dagger-slash', windup: 0.08, strike: 0.18, recover: 0.26,
                     reachMul: 1.0,  coneHalfAngleMul: 1.5, maxTargets: 2 },
      // BACK: a defensive slash on the retreat — short windup, short
      // recover, modest reach. The dagger's answer to a charging mob.
      back:        { pose: 'dagger-slash', windup: 0.06, strike: 0.10, recover: 0.18,
                     reachMul: 1.0,  coneHalfAngleMul: 0.9, maxTargets: 1 },
    },
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
      // STRAFE-LEFT sweep — wide horizontal arc that follows the
      // body's leftward momentum. Sword cocks behind the right
      // shoulder, sweeps across to the lower left. Crowd-clearance
      // when a mob is on your right side.
      strafeLeft:  { pose: 'sword-sweep-left', windup: 0.16, strike: 0.18, recover: 0.40,
                     reachMul: 1.0, coneHalfAngleMul: 1.7, maxTargets: 3 },
      // STRAFE-RIGHT sweep — mirror. Cocks behind the left shoulder,
      // sweeps to the lower right.
      strafeRight: { pose: 'sword-sweep-right', windup: 0.16, strike: 0.18, recover: 0.40,
                     reachMul: 1.0, coneHalfAngleMul: 1.7, maxTargets: 3 },
      // BACK retreating slash — fast poke as the player backs off.
      // Modest damage, but the SHORT recover lets you reposition
      // immediately. The "fighting retreat" answer to a charge.
      back:    { pose: 'sword-retreat-slash', windup: 0.08, strike: 0.10, recover: 0.22,
                 reachMul: 1.1, coneHalfAngleMul: 0.7, maxTargets: 1 },
    },
    chargedMoves: {
      // CHARGED + BACK = WARD strike. The player held to charge, then
      // released backwards — they're not retreating, they're winding
      // up to KICK SPACE OPEN. A horizontal shove with the flat of
      // the blade. Wider cone than the retreat, much harder push, the
      // long recover sells the commit. Pairs with the charge's +80%
      // damage bonus to make it the punisher of an over-extended foe.
      back: { pose: 'sword-ward-back', windup: 0.18, strike: 0.20, recover: 0.55,
              reachMul: 1.25, coneHalfAngleMul: 1.3, maxTargets: 3 },
      // (Future: chargedMoves.strafe = spinning 360° sweep, and
      // chargedMoves.forward = an even bigger plunging strike. For
      // V1 those fall back to the regular directional move with the
      // standard charge modifiers stacked.)
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
    // Hammer directional moves — the overhead smash and the directional
    // swings carry the body's momentum into the strike.
    directionalMoves: {
      // FORWARD: a commit-and-step overhead smash. Bigger reach + the
      // smash's wide AoE catches up to 3 mobs in front of you.
      forward:     { pose: 'hammer-smash', windup: 0.26, strike: 0.16, recover: 0.55,
                     reachMul: 1.35, coneHalfAngleMul: 1.5, maxTargets: 3 },
      // STRAFE: the directional swing IN the strafe direction —
      // body's momentum drives the cut. Sweep that catches 2 to your side.
      strafeLeft:  { pose: 'hammer-swing-left', windup: 0.18, strike: 0.14, recover: 0.34,
                     reachMul: 1.05, coneHalfAngleMul: 1.4, maxTargets: 2 },
      strafeRight: { pose: 'hammer-swing-right', windup: 0.18, strike: 0.14, recover: 0.34,
                     reachMul: 1.05, coneHalfAngleMul: 1.4, maxTargets: 2 },
      // BACK: defensive horizontal swing as the player backs off.
      back:        { pose: 'hammer-swing-right', windup: 0.16, strike: 0.12, recover: 0.30,
                     reachMul: 1.05, coneHalfAngleMul: 1.2, maxTargets: 2 },
    },
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
    // Spear directional moves — the long-reach poker. Forward = an
    // even-longer lunge; strafe = a quick poke that pivots; back =
    // a fast brace.
    directionalMoves: {
      // FORWARD: the spear's signature long thrust, even further.
      forward:     { pose: 'spear-lunge', windup: 0.14, strike: 0.16, recover: 0.42,
                     reachMul: 1.60, coneHalfAngleMul: 0.6, maxTargets: 1 },
      // STRAFE: pivot thrust — same pose, slight cone widening to
      // catch a flanker.
      strafeLeft:  { pose: 'spear-thrust', windup: 0.10, strike: 0.12, recover: 0.24,
                     reachMul: 1.1, coneHalfAngleMul: 1.2, maxTargets: 2 },
      strafeRight: { pose: 'spear-thrust', windup: 0.10, strike: 0.12, recover: 0.24,
                     reachMul: 1.1, coneHalfAngleMul: 1.2, maxTargets: 2 },
      // BACK: short defensive jab + step.
      back:        { pose: 'spear-thrust', windup: 0.08, strike: 0.10, recover: 0.20,
                     reachMul: 1.1, coneHalfAngleMul: 0.9, maxTargets: 1 },
    },
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
    forward:     baseT.directionalMoves.forward     && resolveStep(baseT.directionalMoves.forward),
    strafeLeft:  baseT.directionalMoves.strafeLeft  && resolveStep(baseT.directionalMoves.strafeLeft),
    strafeRight: baseT.directionalMoves.strafeRight && resolveStep(baseT.directionalMoves.strafeRight),
    back:        baseT.directionalMoves.back        && resolveStep(baseT.directionalMoves.back),
  } : undefined;
  const chargedMoves = baseT.chargedMoves ? {
    forward: baseT.chargedMoves.forward && resolveStep(baseT.chargedMoves.forward),
    strafe:  baseT.chargedMoves.strafe  && resolveStep(baseT.chargedMoves.strafe),
    back:    baseT.chargedMoves.back    && resolveStep(baseT.chargedMoves.back),
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
    chargedMoves,
  };
}
