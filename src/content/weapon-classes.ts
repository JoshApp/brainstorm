import { CONFIG } from '../config';
import type { WeaponStats, WeaponClass, WeaponScaling, ProficiencyProfile, FlurrySpec } from './items';
import { getCharacter, type AttributeKind } from '../state/character';
import { DAGGER_DEFAULT_MOVES } from './weapon-moves';

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
  | 'dagger-slash-left'
  | 'dagger-double-stab'
  | 'hammer-swing-left'
  | 'hammer-swing-right'
  | 'hammer-smash'
  | 'spear-thrust'
  | 'spear-lunge'
  | 'crossbow-fire'
  | 'wand-cast'
  // New weapon classes:
  | 'scythe-reap-right'
  | 'scythe-reap-left'
  | 'scythe-spin'
  | 'whip-crack-right'
  | 'whip-crack-left'
  | 'whip-wrap'
  | 'knife-throw'
  // Unarmed:
  | 'fist-jab'
  | 'fist-cross'
  | 'fist-hook';

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
  /** Vertical 3D shaping (metres): how far the FAR end of the swing capsule
   *  drops below (negative) or rises above (positive) the look line, in world
   *  up. An overhead smash dips its reach toward the floor in front (≈ -0.4) so
   *  it crushes what's at your feet without aiming down; an uppercut rises.
   *  Default 0 (a level swing — the current behaviour). The KEY knob that makes
   *  a move's hit volume match its animation in 3D. See docs/COMBAT-HIT-SYSTEM.md. */
  rise?: number;
  /** Damage as a fraction of the weapon's resolved damage for THIS step (the
   *  "% of weapon damage" model). Default 1.0 = one clean hit. A finisher
   *  exceeds 1 (1.3 = 130%); a quick jab dips below. Authored per ARCHETYPE
   *  here; a weapon overrides per step via spec.comboTuning. Ignored when
   *  `hits` (a flurry) is set — the flurry's own damageMul is used. */
  damageMul?: number;
  /** Poise/stagger multiplier for this step. Default 1.0 — light openers chip
   *  (<1), heavy finishers crack (>1). */
  staggerMul?: number;
  /** Multi-hit FLURRY: this step lands several fast hits, each rolling crit +
   *  on-hit procs independently (the dagger identity). */
  hits?: FlurrySpec;
}

export interface ResolvedComboStep {
  pose: PoseKey;
  windupTime: number;
  strikeTime: number;
  recoverTime: number;
  reachMul: number;
  coneHalfAngleMul: number;
  maxTargets: number;
  rise: number;
  damageMul: number;
  staggerMul: number;
  hits?: FlurrySpec;
}

export interface ResolvedWeaponStats {
  reach: number;
  coneHalfAngle: number;
  damage: number;
  critChance: number;
  critMultiplier: number;
  /** Stagger power per hit (weapon weight × Might). The combat cone
   *  passes this to the target's applyStaggerDamage on a heavy hit;
   *  accumulated past the enemy's poise → stagger. */
  staggerPower: number;
  class: WeaponClass;
  /** Attack commitment 0..1 — drives how much movement/turn agency is lost
   *  during a swing (swing-agency.ts). 0 = weightless (no lock), 1 = fully
   *  committed (hammer). */
  commitment: number;
  /** Ordered combo steps. A press while idle within comboWindowMs of
   *  the previous step's recover-end advances to the next step;
   *  outside the window, the combo resets to step 0. The array wraps
   *  — pressing past the last step starts over at 0. */
  combo: ResolvedComboStep[];
  comboWindowMs: number;
  /** Resolved lateral swing-arc width (weapon override → class default → 1).
   *  The viewmodel scales a swing pose's sideways deviation by this. */
  swingArc: number;
  /** Timeline move COMBO — routes this weapon through the move runtime instead of
   *  the phase machine (docs/MOVE-TIMELINE.md). Passthrough from the weapon spec. */
  moves?: import('../combat/move-timeline').MoveStep[];
  /** Attack-speed multiplier (>1 = faster). Passthrough; scales a move's timing. */
  attackSpeed: number;
  /** On-hit status infliction, passed through from the weapon spec. */
  onHit?: { buffId: string; chance: number; duration: number };
  /** Ranged projectile (crossbow/wand/throwing-knives) — strike fires
   *  this instead of a melee cone hit. Passed through from the weapon
   *  spec. count + spread carry the fan parameters for multi-shot
   *  weapons. */
  ranged?: { projectileId: string; count?: number; spread?: number };
  /** Signature charged-attack effect. Passed through from the weapon
   *  spec; attack.ts reads this when a charged swing lands to trigger
   *  the weapon's bonus effect (projectile, AoE, lifesteal, ...). */
  chargedEffect?:
    | { kind: 'projectile'; projectileId: string; minCharge?: number; damageMul?: number };
  /** Per-weapon parry poise chip + reactive verbs (riposte / perfect-dodge /
   *  empowered-hit), passed through from the weapon spec. The combat layer
   *  reads these at the matching event hooks. */
  parryPoise?: number;
  onRiposte?: import('./items').CombatVerb;
  onPerfectDodge?: import('./items').CombatVerb;
  onEmpoweredHit?: import('./items').CombatVerb;
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
  /** Resolved HEAVY combo chain — an escalating heavy 1-2-3 walked by repeated
   *  CHARGED releases (hold→hold→hold), separate from the light tap combo. Each
   *  step is more committed; the last is the finisher. Optional (only weapons
   *  built for it). */
  heavyCombo?: ResolvedComboStep[];
  /** Resolved ENDER — a special finisher fired by cashing out a LIGHT chain with
   *  a charged release (tap, tap → hold). Stronger than a cold heavy. Optional. */
  ender?: ResolvedComboStep;
}

/** Movement-driven attack variants. When the joystick is held past a
 *  small deadzone at the moment of a press, the swing OVERRIDES the
 *  normal combo with one of these — picked by the dominant direction.
 *  Forward = lunge (commit-and-step-in), strafe-L/R = directional
 *  sweeps (wide cone, mirrored arc), back = retreat-slash (quick
 *  poke + repositioning recovery).
 *
 *  A held direction flavors the combo OPENER only: a TAP in a direction
 *  swaps step 0 for that directional move, but the chain still ADVANCES
 *  (so moving never breaks your 1-2-3 — the second step + finisher are
 *  always the fixed combo). The same moves also fire as deliberate
 *  CHARGED specials (charge + direction), telegraphed during the hold. */
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
  /** DEFAULT timeline moveset for the class (docs/MOVE-TIMELINE.md). Generic
   *  weapons of the class inherit this; a signature weapon overrides via
   *  WeaponStats.moves. Omitted → the class is still on the legacy phase-pose
   *  path (migration in progress). */
  moves?: import('../combat/move-timeline').MoveStep[];
  directionalMoves?: DirectionalMoves;
  chargedMoves?: ChargedMoves;
  /** HEAVY combo chain (hold→hold→hold) — an escalating heavy 1-2-3 walked by
   *  charged releases. Optional; only weapons designed for it. */
  heavyCombo?: ComboStep[];
  /** ENDER — the special finisher a charged release fires at the end of a light
   *  chain (tap, tap → hold). Optional. */
  ender?: ComboStep;
  /** WEIGHT multiplier on windup + recover (NOT strike). 1.0 = as
   *  authored (light/fast); >1 = heavier, more committal. Heavies
   *  (hammer/scythe) sit high; the baseline sword + spear get a modest
   *  bump; daggers/whip/ranged stay at 1.0. The single knob to tune a
   *  class's felt weight. */
  timingMul?: number;
  /** Attack COMMITMENT (0..1): how much movement/turn agency you lose mid-swing
   *  (see CONFIG.COMMITMENT + swing-agency.ts). Optional — defaults to a value
   *  DERIVED from timingMul so weight is one knob (a heavier weapon commits
   *  harder). Set explicitly only to decouple a class's commitment from its
   *  animation weight. */
  commitment?: number;
  /** Lateral SWING-ARC width: the fraction of a swing pose's SIDEWAYS deviation
   *  (x / rotY / rotZ) the viewmodel keeps when applying it. 1 = the full
   *  authored arc; <1 narrows it so a wide haymaker (hammer / scythe) doesn't
   *  wrap almost behind the player. Forward depth + pitch are untouched, so
   *  reach/thrusts are unaffected. Omitted → 1. Per-CLASS default; a single
   *  weapon overrides via WeaponStats.swingArc. */
  swingArc?: number;
}

export const WEAPON_CLASS_DEFAULTS: Record<WeaponClass, ClassDefaults> = {
  // FIST — unarmed. The floor of the weapon system: no weapon equipped
  // resolves to this. Short reach, low damage, fast cadence. Boxing
  // 1-2-3 combo (jab → cross → hook). The cross is the finisher.
  // No directional moves and no charged variants for v1 — the punch
  // pool is intentionally tight.
  fist: {
    combo: [
      // jab — light, snappy, leads the chain. Narrow cone.
      { pose: 'fist-jab',   windup: 0.06, strike: 0.10, recover: 0.18,
        reachMul: 0.85, coneHalfAngleMul: 0.7, maxTargets: 1 },
      // cross — straight, longer reach as the body rotates into it.
      { pose: 'fist-cross', windup: 0.08, strike: 0.12, recover: 0.22,
        reachMul: 1.05, coneHalfAngleMul: 0.8, maxTargets: 1 },
      // hook — wide arc, the finisher; clips a second target if close.
      { pose: 'fist-hook',  windup: 0.10, strike: 0.14, recover: 0.30,
        reachMul: 1.00, coneHalfAngleMul: 1.4, maxTargets: 2 },
    ],
    comboWindowMs: 320,
    timingMul: 0.9,         // a touch quicker than the baseline sword
  },
  dagger: {
    // Timeline moveset (docs/MOVE-TIMELINE.md) — every generic dagger inherits
    // this thrust→cut→double-stab. The legacy `combo` below is now only the
    // fallback shaping (reach/cone/maxTargets) the timeline hit still borrows.
    moves: DAGGER_DEFAULT_MOVES,
    // stab → slash → double-stab. Stab one, slash cleaves two,
    // double-stab finisher commits on one target with extra damage.
    combo: [
      // FLURRY opener — one tap lands three fast stabs (3 × 40% = 120%), each
      // rolling crit + on-hit procs independently: the dagger as the proc / crit
      // / %-effect weapon. Strike is widened to 0.18s so all three fit. Weak
      // per-hit poise (staggerMul) — daggers bleed, they don't break guards.
      { pose: 'dagger-stab',        windup: 0.08, strike: 0.18, recover: 0.22,
        reachMul: 0.95, coneHalfAngleMul: 0.7, maxTargets: 1, staggerMul: 0.6,
        hits: { count: 3, interval: 0.05, damageMul: 0.4 } },
      { pose: 'dagger-slash',       windup: 0.10, strike: 0.15, recover: 0.24,
        reachMul: 1.0,  coneHalfAngleMul: 1.3, maxTargets: 1, damageMul: 0.9 },
      // FLURRY finisher — three rapid double-stabs (3 × 50% = 150%).
      { pose: 'dagger-double-stab', windup: 0.08, strike: 0.26, recover: 0.30,
        reachMul: 1.05, coneHalfAngleMul: 0.7, maxTargets: 1, staggerMul: 0.7,
        hits: { count: 3, interval: 0.05, damageMul: 0.5 } },
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
      strafeLeft:  { pose: 'dagger-slash-left', windup: 0.08, strike: 0.18, recover: 0.26,
                     reachMul: 1.0,  coneHalfAngleMul: 1.5, maxTargets: 1 },
      strafeRight: { pose: 'dagger-slash', windup: 0.08, strike: 0.18, recover: 0.26,
                     reachMul: 1.0,  coneHalfAngleMul: 1.5, maxTargets: 1 },
      // BACK: a defensive slash on the retreat — short windup, short
      // recover, modest reach. The dagger's answer to a charging mob.
      back:        { pose: 'dagger-slash', windup: 0.06, strike: 0.10, recover: 0.18,
                     reachMul: 1.0,  coneHalfAngleMul: 0.9, maxTargets: 1 },
    },
    // HEAVY combo (hold→hold→hold) — a committed assassin's flurry into the
    // double-stab finisher. Drains hard (each step is a charged pour).
    heavyCombo: [
      { pose: 'dagger-stab',        windup: 0.12, strike: 0.14, recover: 0.28,
        reachMul: 1.25, coneHalfAngleMul: 0.6, maxTargets: 1 },
      { pose: 'dagger-slash',       windup: 0.12, strike: 0.16, recover: 0.30,
        reachMul: 1.10, coneHalfAngleMul: 1.4, maxTargets: 2 },
      { pose: 'dagger-double-stab', windup: 0.10, strike: 0.30, recover: 0.40,
        reachMul: 1.20, coneHalfAngleMul: 0.7, maxTargets: 1 },
    ],
    ender: { pose: 'dagger-double-stab', windup: 0.10, strike: 0.28, recover: 0.36,
             reachMul: 1.20, coneHalfAngleMul: 0.8, maxTargets: 2 },
  },
  sword: {
    // slash-left → slash-right → thrust. The basic chain is SINGLE-TARGET
    // (playtest: blanket cleave was OP). Cleave is reserved for the
    // directional STRAFE sweeps below + the charged ward.
    combo: [
      { pose: 'sword-slash-left',
        windup:  CONFIG.SWORD_SWING_WINDUP,
        strike:  CONFIG.SWORD_SWING_STRIKE,
        recover: CONFIG.SWORD_SWING_RECOVER,
        reachMul: 1.0, coneHalfAngleMul: 1.1, maxTargets: 1 },
      { pose: 'sword-slash-right',
        windup:  CONFIG.SWORD_SWING_WINDUP,
        strike:  CONFIG.SWORD_SWING_STRIKE,
        recover: CONFIG.SWORD_SWING_RECOVER,
        reachMul: 1.0, coneHalfAngleMul: 1.1, maxTargets: 1 },
      { pose: 'sword-thrust', windup: 0.14, strike: 0.12, recover: 0.34,
        reachMul: 1.25, coneHalfAngleMul: 0.6, maxTargets: 1, damageMul: 1.3 },
    ],
    comboWindowMs: 380,
    timingMul: 1.25,   // baseline blade — a touch more committal than before
    swingArc: 0.85,    // mild trim — slashes read forward; tames the wide sweep variant
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
                     reachMul: 1.0, coneHalfAngleMul: 1.7, maxTargets: 2 },
      // STRAFE-RIGHT sweep — mirror. Cocks behind the left shoulder,
      // sweeps to the lower right.
      strafeRight: { pose: 'sword-sweep-right', windup: 0.16, strike: 0.18, recover: 0.40,
                     reachMul: 1.0, coneHalfAngleMul: 1.7, maxTargets: 2 },
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
              reachMul: 1.25, coneHalfAngleMul: 1.3, maxTargets: 2 },
      // (Future: chargedMoves.strafe = spinning 360° sweep, and
      // chargedMoves.forward = an even bigger plunging strike. For
      // V1 those fall back to the regular directional move with the
      // standard charge modifiers stacked.)
    },
    // HEAVY combo — a committed power-slash → wide sweep → driving lunge finisher.
    heavyCombo: [
      { pose: 'sword-slash-right',   windup: 0.18, strike: 0.12, recover: 0.40,
        reachMul: 1.20, coneHalfAngleMul: 1.2, maxTargets: 2 },
      { pose: 'sword-sweep-left',    windup: 0.18, strike: 0.14, recover: 0.42,
        reachMul: 1.25, coneHalfAngleMul: 1.5, maxTargets: 2 },
      { pose: 'sword-lunge-forward', windup: 0.22, strike: 0.16, recover: 0.52,
        reachMul: 1.50, coneHalfAngleMul: 0.7, maxTargets: 2 },
    ],
    ender: { pose: 'sword-thrust', windup: 0.20, strike: 0.14, recover: 0.46,
             reachMul: 1.40, coneHalfAngleMul: 0.9, maxTargets: 2 },
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
      { pose: 'hammer-smash',       windup: 0.28, strike: 0.14, recover: 0.44,
        reachMul: 1.15, coneHalfAngleMul: 1.4, maxTargets: 3, rise: -0.45, damageMul: 1.5 },
    ],
    comboWindowMs: 520,
    timingMul: 1.6,   // HEAVY — wind up, commit, recover; the slow brute (tail
                      // trimmed from 1.7; the commitment ARC now carries the
                      // weight, so the animation needn't run as long)
    swingArc: 0.6,    // wide haymaker (rotZ ±1.45) was wrapping behind — pull it forward
    // Hammer directional moves — the overhead smash and the directional
    // swings carry the body's momentum into the strike.
    directionalMoves: {
      // FORWARD: a commit-and-step overhead smash. Bigger reach + the
      // smash's wide AoE catches up to 3 mobs in front of you.
      forward:     { pose: 'hammer-smash', windup: 0.26, strike: 0.16, recover: 0.48,
                     reachMul: 1.35, coneHalfAngleMul: 1.5, maxTargets: 3, rise: -0.5 },
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
    // HEAVY combo — hold→hold→hold for an escalating heavy 1-2-3, walked by
    // charged releases (each pours stamina, so the chain drains hard). The third
    // is the finisher (gets finisherDamageMultiplier via isFinisherStrike).
    heavyCombo: [
      // H1 — overhead smash: single target, big stagger, the opener.
      { pose: 'hammer-smash', windup: 0.26, strike: 0.16, recover: 0.50,
        reachMul: 1.20, coneHalfAngleMul: 1.0, maxTargets: 1 },
      // H2 — wide horizontal sweep: cleaves, knockback, momentum into the third.
      { pose: 'hammer-swing-left', windup: 0.22, strike: 0.14, recover: 0.46,
        reachMul: 1.10, coneHalfAngleMul: 1.5, maxTargets: 2 },
      // H3 — ground-slam finisher: widest hammer AoE, longest commit, devastating.
      { pose: 'hammer-smash', windup: 0.34, strike: 0.18, recover: 0.62,
        reachMul: 1.45, coneHalfAngleMul: 1.7, maxTargets: 3, rise: -0.55 },
    ],
    // ENDER — a light tap chain cashed out with a charged release: a big
    // committed smash, stronger than a cold heavy (a finisher).
    ender: { pose: 'hammer-smash', windup: 0.28, strike: 0.16, recover: 0.52,
             reachMul: 1.35, coneHalfAngleMul: 1.5, maxTargets: 3, rise: -0.5 },
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
    timingMul: 1.15,   // long poke — slightly more deliberate than a dagger
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
                     reachMul: 1.1, coneHalfAngleMul: 1.2, maxTargets: 1 },
      strafeRight: { pose: 'spear-thrust', windup: 0.10, strike: 0.12, recover: 0.24,
                     reachMul: 1.1, coneHalfAngleMul: 1.2, maxTargets: 1 },
      // BACK: short defensive jab + step.
      back:        { pose: 'spear-thrust', windup: 0.08, strike: 0.10, recover: 0.20,
                     reachMul: 1.1, coneHalfAngleMul: 0.9, maxTargets: 1 },
    },
    // HEAVY combo — braced thrusts at escalating reach into a deep driving lunge.
    heavyCombo: [
      { pose: 'spear-thrust', windup: 0.16, strike: 0.14, recover: 0.40,
        reachMul: 1.40, coneHalfAngleMul: 0.7, maxTargets: 1 },
      { pose: 'spear-thrust', windup: 0.16, strike: 0.14, recover: 0.40,
        reachMul: 1.50, coneHalfAngleMul: 0.9, maxTargets: 1 },
      { pose: 'spear-lunge',  windup: 0.22, strike: 0.18, recover: 0.56,
        reachMul: 1.80, coneHalfAngleMul: 0.7, maxTargets: 2 },
    ],
    ender: { pose: 'spear-lunge', windup: 0.20, strike: 0.16, recover: 0.50,
             reachMul: 1.70, coneHalfAngleMul: 0.8, maxTargets: 2 },
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
  // ── NEW MELEE: SCYTHE ───────────────────────────────────────────────
  // Reaper aesthetic. Very wide horizontal arcs, slower than sword,
  // multi-target by default. The combo finisher is a spin — full
  // 360° (visual) clearance. Built around "wade into the swarm and
  // sweep them down." Future: lifesteal on hit hook lands cleanly
  // when we add that effect kind.
  scythe: {
    combo: [
      { pose: 'scythe-reap-right', windup: 0.22, strike: 0.18, recover: 0.40,
        reachMul: 1.10, coneHalfAngleMul: 1.5, maxTargets: 2 },
      { pose: 'scythe-reap-left',  windup: 0.22, strike: 0.18, recover: 0.40,
        reachMul: 1.10, coneHalfAngleMul: 1.5, maxTargets: 2 },
      { pose: 'scythe-spin',       windup: 0.28, strike: 0.22, recover: 0.48,
        reachMul: 1.15, coneHalfAngleMul: 1.9, maxTargets: 3 },
    ],
    comboWindowMs: 460,
    timingMul: 1.45,  // HEAVY — big sweeping reaps, slow to wind + recover (tail
                      // trimmed from 1.5; the commitment ARC carries the weight)
    swingArc: 0.65,   // big reaps (rotZ ±1.10) swept behind — narrow to a forward arc
    directionalMoves: {
      // Forward: a downward chop with the curved tip. Single target,
      // big damage commit.
      forward:     { pose: 'scythe-spin', windup: 0.18, strike: 0.18, recover: 0.44,
                     reachMul: 1.40, coneHalfAngleMul: 0.8, maxTargets: 1, rise: -0.4 },
      // Strafe: directional reap following the body's momentum.
      strafeLeft:  { pose: 'scythe-reap-left',  windup: 0.18, strike: 0.16, recover: 0.36,
                     reachMul: 1.15, coneHalfAngleMul: 1.7, maxTargets: 3 },
      strafeRight: { pose: 'scythe-reap-right', windup: 0.18, strike: 0.16, recover: 0.36,
                     reachMul: 1.15, coneHalfAngleMul: 1.7, maxTargets: 3 },
      // Back: a quick defensive reap as you retreat.
      back:        { pose: 'scythe-reap-right', windup: 0.14, strike: 0.14, recover: 0.28,
                     reachMul: 1.05, coneHalfAngleMul: 1.3, maxTargets: 3 },
    },
    // HEAVY combo — wide reaps both sides into the clearing spin finisher.
    heavyCombo: [
      { pose: 'scythe-reap-right', windup: 0.22, strike: 0.16, recover: 0.46,
        reachMul: 1.25, coneHalfAngleMul: 1.7, maxTargets: 3 },
      { pose: 'scythe-reap-left',  windup: 0.22, strike: 0.16, recover: 0.46,
        reachMul: 1.30, coneHalfAngleMul: 1.8, maxTargets: 3 },
      { pose: 'scythe-spin',       windup: 0.32, strike: 0.22, recover: 0.62,
        reachMul: 1.40, coneHalfAngleMul: 2.0, maxTargets: 4 },
    ],
    ender: { pose: 'scythe-spin', windup: 0.28, strike: 0.20, recover: 0.56,
             reachMul: 1.35, coneHalfAngleMul: 1.9, maxTargets: 4 },
  },
  // ── NEW MELEE: WHIP ─────────────────────────────────────────────────
  // Long reach, narrow cone, snappy timings. Built around "I can
  // touch enemies from across the room." The wrap finisher catches a
  // wider arc. Future: chargedEffect = pull-toward-player slot lands
  // cleanly when we add that effect kind.
  whip: {
    combo: [
      { pose: 'whip-crack-right', windup: 0.10, strike: 0.14, recover: 0.26,
        reachMul: 1.35, coneHalfAngleMul: 0.55, maxTargets: 1 },
      { pose: 'whip-crack-left',  windup: 0.10, strike: 0.14, recover: 0.26,
        reachMul: 1.35, coneHalfAngleMul: 0.55, maxTargets: 1 },
      { pose: 'whip-wrap',        windup: 0.16, strike: 0.22, recover: 0.42,
        reachMul: 1.45, coneHalfAngleMul: 1.1, maxTargets: 2 },
    ],
    comboWindowMs: 380,
    directionalMoves: {
      forward:     { pose: 'whip-crack-right', windup: 0.08, strike: 0.14, recover: 0.30,
                     reachMul: 1.65, coneHalfAngleMul: 0.45, maxTargets: 1 },
      strafeLeft:  { pose: 'whip-crack-left',  windup: 0.12, strike: 0.16, recover: 0.28,
                     reachMul: 1.30, coneHalfAngleMul: 0.85, maxTargets: 2 },
      strafeRight: { pose: 'whip-crack-right', windup: 0.12, strike: 0.16, recover: 0.28,
                     reachMul: 1.30, coneHalfAngleMul: 0.85, maxTargets: 2 },
      back:        { pose: 'whip-crack-right', windup: 0.08, strike: 0.10, recover: 0.20,
                     reachMul: 1.25, coneHalfAngleMul: 0.65, maxTargets: 1 },
    },
    // HEAVY combo — long cracks into the wide wrap finisher.
    heavyCombo: [
      { pose: 'whip-crack-right', windup: 0.12, strike: 0.14, recover: 0.30,
        reachMul: 1.50, coneHalfAngleMul: 0.6, maxTargets: 1 },
      { pose: 'whip-crack-left',  windup: 0.12, strike: 0.14, recover: 0.30,
        reachMul: 1.50, coneHalfAngleMul: 0.6, maxTargets: 1 },
      { pose: 'whip-wrap',        windup: 0.18, strike: 0.24, recover: 0.46,
        reachMul: 1.60, coneHalfAngleMul: 1.3, maxTargets: 2 },
    ],
    ender: { pose: 'whip-wrap', windup: 0.16, strike: 0.22, recover: 0.42,
             reachMul: 1.55, coneHalfAngleMul: 1.2, maxTargets: 2 },
  },
  // ── NEW RANGED: THROWING KNIVES ─────────────────────────────────────
  // Multi-projectile fan. Spawns COUNT projectiles per shot with
  // angular spread — coverage instead of precision. Faster cadence
  // than crossbow + wand because the volley IS the damage. Combat
  // resolves the fan in fireRanged.
  'throwing-knives': {
    combo: [{ pose: 'knife-throw', windup: 0.08, strike: 0.08, recover: 0.50 }],
    comboWindowMs: 0,
  },
};

// Per-proficiency bonus tuning. Each point of weapon-class proficiency
// shaves a small percentage off the timings AND adds the same to the
// damage. Capped at PROFICIENCY_CAP so a long run doesn't trivialise
// floor 1 — at the cap one weapon class is ~25% faster + 25% harder
// hitting than its baseline.
const PROFICIENCY_CAP_PCT  = 0.25;       // hard cap on %-ish prof bonuses (25%)
const PROFICIENCY_CRIT_CAP = 0.15;       // hard cap on the flat crit prof bonus

// What each weapon class's PROFICIENCY improves (per-point), reinforcing
// its identity instead of the old one-size speed+damage. Heavies get
// stagger+damage but NOT speed — mastery breaks poise harder without
// un-heavying the swing. Override per weapon via WeaponStats.proficiency.
// See docs/HARBOR-AND-PROGRESSION.md.
const PROFICIENCY_PROFILE_BY_CLASS: Record<WeaponClass, ProficiencyProfile> = {
  // FIST mastery — punching more makes you punch faster + harder. No
  // crit fishing, no combo window — it's the bare-hands floor of the
  // system, not a deep skill expression.
  fist:   { speed: 0.005, damage: 0.005 },
  dagger: { speed: 0.005, crit: 0.003 },      // fast hands
  whip:   { speed: 0.005, reach: 0.004 },     // snap + extend
  sword:  { comboWindow: 0.006, damage: 0.005 }, // flow + bite
  spear:  { reach: 0.004, damage: 0.005 },    // poke deeper, harder
  hammer: { stagger: 0.010, damage: 0.005 },  // break poise harder (NO speed)
  scythe: { stagger: 0.010, damage: 0.005 },  // ditto, the reaper
  crossbow:        { damage: 0.006, speed: 0.004 },  // speed = faster re-cock
  wand:            { damage: 0.006, speed: 0.004 },  // speed = faster cast/settle
  'throwing-knives': { damage: 0.005, speed: 0.004 },
};

const ATTR_LABEL: Record<AttributeKind, string> = {
  might: 'Might', finesse: 'Finesse', lore: 'Lore', grit: 'Grit',
};

/** Human-readable scaling summary for a weapon, e.g. "Might B" or
 *  "Lore A · Finesse C" — shown on the item card so the player knows which
 *  attribute powers this weapon (playtest: scaling wasn't explained). */
export function weaponScalingSummary(spec: WeaponStats): string {
  const cls: WeaponClass = spec.class ?? 'sword';
  const scaling: WeaponScaling = spec.scaling ?? DEFAULT_WEAPON_SCALING[cls];
  const parts = (Object.keys(scaling) as AttributeKind[])
    .map((a) => `${ATTR_LABEL[a]} ${scaling[a]}`);
  return parts.join(' · ');
}

/** Clamp a per-point proficiency bonus at its cap. */
function profBonus(points: number, perPoint: number | undefined, cap = PROFICIENCY_CAP_PCT): number {
  if (!perPoint) return 0;
  return Math.min(cap, points * perPoint);
}

// Default attribute scaling per weapon class — applied when a spec
// doesn't set its own `scaling`. Each weapon family gets grade B on its
// stat (see the attribute table in docs/HARBOR-AND-PROGRESSION.md):
//   Might   — heavy / forceful: hammer, scythe, sword, spear
//   Finesse — quick / precise / ranged: dagger, whip, crossbow, knives
//   Lore    — arcane: wand
const DEFAULT_WEAPON_SCALING: Record<WeaponClass, WeaponScaling> = {
  fist:    { might: 'C' },   // bare hands scale with strength, but weaker grade — gear is the answer
  hammer:  { might: 'B' },
  scythe:  { might: 'B' },
  sword:   { might: 'B' },
  spear:   { might: 'B' },
  dagger:  { finesse: 'B' },
  whip:    { finesse: 'B' },
  crossbow:        { finesse: 'B' },
  'throwing-knives': { finesse: 'B' },
  wand:    { lore: 'B' },
};

// Base STAGGER POWER per class — how hard a single hit chips enemy poise
// BEFORE Might scaling (resolveWeaponStats multiplies by Might). Heavy
// weapons break poise on their own (now earned by their slow swings);
// light/ranged barely dent it without Might investment. Override per
// weapon via WeaponStats.staggerPower. Tune feel here.
// Tuned for the "deliberate" poise economy (enemy poise ~ max(4, hp·1.4),
// tanks higher): a stagger weapon should EARN a break over ~2-3 hits, and a
// fully-charged heavy (×2 via CHARGE_BONUS) should break a standard trash mob
// in one committed blow — not a single light tap (the old hammer problem).
export const STAGGER_POWER_BY_CLASS: Record<WeaponClass, number> = {
  hammer: 2.2,   // the poise-breaker: ~2 light hits, 1 charged. Identity = stagger.
  scythe: 1.8,
  sword:  1.2,
  spear:  1.0,
  crossbow: 0.8,
  whip:   0.6,
  dagger: 0.5,   // barely dents poise — daggers bleed, they don't break.
  fist:   0.45,
  wand:   0.4,
  'throwing-knives': 0.35,
};

/** Flatten class defaults + per-spec overrides + attackSpeed +
 *  character proficiency (tempo) + attribute scaling (power: family +
 *  universal floor) + Finesse crit into a single resolved stat block.
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
  // PROFICIENCY (use-based mastery) — what it improves is per-class
  // (profile), overridable per weapon. Each stat clamps at its cap.
  const profPoints = char.proficiencies[cls];
  const profile: ProficiencyProfile = { ...PROFICIENCY_PROFILE_BY_CLASS[cls], ...spec.proficiency };
  const profSpeedPct   = profBonus(profPoints, profile.speed);
  const profDmgPct     = profBonus(profPoints, profile.damage);
  const profStaggerPct = profBonus(profPoints, profile.stagger);
  const profCrit       = profBonus(profPoints, profile.crit, PROFICIENCY_CRIT_CAP);
  const profComboPct   = profBonus(profPoints, profile.comboWindow);
  const profReachPct   = profBonus(profPoints, profile.reach);
  const profSpeed = 1 - profSpeedPct;      // shorter timings (only if the class profile has speed)

  // ATTRIBUTE damage (ATTRIBUTES = power). Two layers fold into one mul:
  //   family  — points in the weapon's scaling attribute(s) × grade coeff
  //   floor   — Might + Lore each add a small flat % to ALL weapon damage
  //             so no point is ever dead (see CONFIG.ATTR).
  const scaling: WeaponScaling = spec.scaling ?? DEFAULT_WEAPON_SCALING[cls];
  let familyBonus = 0;
  for (const key in scaling) {
    const attr = key as AttributeKind;
    const grade = scaling[attr];
    if (grade) familyBonus += char.attributes[attr] * CONFIG.ATTR.SCALING_GRADE[grade];
  }
  const universalBonus =
    (char.attributes.might + char.attributes.lore) * CONFIG.ATTR.UNIVERSAL_DMG_PER_POINT;
  const profDmgMul = (1 + profDmgPct) * (1 + familyBonus + universalBonus);

  const finesseCrit = char.attributes.finesse * CONFIG.ATTR.FINESSE_CRIT_PER_POINT;

  // Might SIGNATURE — stagger power = weapon weight × Might × proficiency.
  const staggerBase = spec.staggerPower ?? STAGGER_POWER_BY_CLASS[cls];
  const staggerPower =
    staggerBase * (1 + char.attributes.might * CONFIG.ATTR.MIGHT_STAGGER_PER_POINT) * (1 + profStaggerPct);

  // WEIGHT: each class carries a timingMul that stretches the COMMITTAL
  // parts of a swing — windup + recover — WITHOUT touching the strike
  // (the hit window stays stable, so detection/balance don't shift).
  // Heavy weapons (hammer/scythe) get the slow "wind up… SNAP… recover"
  // feel; light weapons stay fast. attackSpeed + proficiency still apply
  // on top. Tune the per-class numbers in WEAPON_CLASS_DEFAULTS.
  // SWING_TIME_SCALE slows windup + recover across ALL classes (global cadence
  // knob, >1 = slower); the strike/hit window stays unscaled so it doesn't
  // touch detection or per-class weight balance.
  const timingMul = baseT.timingMul ?? 1;
  const windRecMul = speedMul * profSpeed * timingMul * CONFIG.SWING_TIME_SCALE;   // windup + recover
  const strikeMul  = speedMul * profSpeed;               // strike (hit window) — unscaled by weight + cadence
  // Commitment derives from the same WEIGHT axis (timingMul) unless a class
  // overrides it: a baseline (timingMul 1.0) weapon commits 0.30; each +1.0 of
  // weight adds ~0.9, capped at 1.0. So dagger/ranged (1.0) stay nimble at 0.30,
  // sword (1.25) ≈ 0.53, scythe (1.5) ≈ 0.75, hammer (1.7) ≈ 0.93.
  const commitment = baseT.commitment ?? Math.max(0.3, Math.min(1, 0.3 + (timingMul - 1) * 0.9));
  const resolveStep = (step: ComboStep): ResolvedComboStep => ({
    pose: step.pose,
    windupTime:  step.windup  * windRecMul,
    strikeTime:  step.strike  * strikeMul,
    recoverTime: step.recover * windRecMul,
    reachMul: step.reachMul ?? 1,
    coneHalfAngleMul: step.coneHalfAngleMul ?? 1,
    maxTargets: step.maxTargets ?? 1,
    rise: step.rise ?? 0,
    damageMul: step.damageMul ?? 1,
    staggerMul: step.staggerMul ?? 1,
    hits: step.hits,
  });
  // Per-weapon override: patch the archetype's light combo per step index with
  // spec.comboTuning (damage % / poise % / flurry) before resolving. The class
  // default is the baseline; a weapon can retune any step's numbers.
  const comboSrc: ComboStep[] = spec.comboTuning
    ? baseT.combo.map((s, i) => (spec.comboTuning![i] ? { ...s, ...spec.comboTuning![i] } : s))
    : baseT.combo;
  const combo: ResolvedComboStep[] = comboSrc.map(resolveStep);
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
    // reach is filled per-weapon (derived from the model, or explicit for
    // whip/ranged) by the derive pass in items.ts before any resolve; the ?? is
    // a defensive floor for a weapon authored without a reach or anchors.
    reach: (spec.reach ?? 1.5) * (1 + profReachPct),
    coneHalfAngle: spec.coneHalfAngle,
    damage: spec.damage * profDmgMul,
    critChance: (spec.critChance ?? 0.05) + finesseCrit + profCrit,
    staggerPower,
    critMultiplier: spec.critMultiplier ?? 2.0,
    class: cls,
    commitment,
    combo,
    comboWindowMs: baseT.comboWindowMs * (1 + profComboPct),
    // Swing arc: per-weapon override, else the class default, else full (1).
    swingArc: spec.swingArc ?? baseT.swingArc ?? 1,
    moves: spec.moves ?? baseT.moves,   // weapon override → class default (inheritance)
    attackSpeed: spec.attackSpeed ?? 1,
    onHit: spec.onHit,
    ranged: spec.ranged,
    chargedEffect: spec.chargedEffect,
    parryPoise: spec.parryPoise,
    onRiposte: spec.onRiposte,
    onPerfectDodge: spec.onPerfectDodge,
    onEmpoweredHit: spec.onEmpoweredHit,
    directionalMoves,
    chargedMoves,
    heavyCombo: baseT.heavyCombo ? baseT.heavyCombo.map(resolveStep) : undefined,
    ender: baseT.ender ? resolveStep(baseT.ender) : undefined,
  };
}
