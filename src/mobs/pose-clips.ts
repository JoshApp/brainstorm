// Telegraph pose clips — the crude, moody animation layer keyed to an
// ability's phase + flavour. Data-driven so each telegraph style reads
// as a distinct silhouette (a charge coils then lunges; a swing leans
// back then slams; a cast rises then thrusts) without per-enemy code.
//
// Each pose is a few additive offsets on named rig nodes, interpreted by
// applyTelegraph in enemy.ts:
//   - windup  : lerp 0 → .windup over the phase progress t
//   - strike  : hold .strike
//   - recover : lerp .strike → 0 over t
//
// Nodes (all optional per model — a node that doesn't exist no-ops, so
// the same clip works on a fully-rigged humanoid and a limbless blob):
//   rigTilt  — the body lean (rig slot rotation.x)
//   bob      — the body rise (model-root position.y)
//   armSwing — both shoulder pivots' rotation.x (jointed-arm models only)
//
// Positive rigTilt / armSwing pitches FORWARD (toward the player);
// negative leans/coils back. bob is metres of vertical rise.

export type TelegraphStyle = 'swing' | 'smash' | 'cast' | 'charge' | 'lash';

interface Phased { windup: number; strike: number; }
export interface TelegraphPose {
  rigTilt: Phased;
  bob: Phased;
  armSwing: Phased;
}

export const TELEGRAPH_POSES: Record<TelegraphStyle, TelegraphPose> = {
  // Baseline melee — raise the arm then chop down-FORWARD through the target.
  // POSITIVE armSwing = forward/up (rig convention); the old strike −1.05
  // swung the arm BEHIND the back (it was never tested on a real shoulder —
  // only armless pose-mobs used 'swing'). Now: wind up high, chop down in front.
  swing: {
    rigTilt:  { windup:  0.35, strike:  0.25 },   // rear slightly, lean into the chop
    bob:      { windup:  0.10, strike:  0.0  },
    armSwing: { windup:  1.60, strike:  0.30 },   // raise overhead-ish → chop down-forward
  },
  // Heavy overhead SMASH (bipeds — ghoul, stoneguard, …). Arms wind WAY up
  // overhead and HOLD (the big tell), then slam down through the target. The
  // poseValue ease supplies the cock-and-hold + snap; this replaces the old
  // hand-keyed BIPED_SMASH clip so every mob now telegraphs via one pose path.
  smash: {
    rigTilt:  { windup:  0.20, strike:  0.45 },   // rear slightly, then drive forward into the slam
    bob:      { windup:  0.10, strike:  0.0  },    // rise on the wind-up, drop on the slam
    armSwing: { windup:  2.20, strike:  0.50 },    // arms overhead → driven down-forward (≈ old ARM_RAISED→SLAM)
  },
  // Caster — a smaller, steadier lean; arms spread out then push the
  // bolt/hex forward. No big body slam (it's not a physical blow).
  cast: {
    rigTilt:  { windup:  0.18, strike:  0.0  },
    bob:      { windup:  0.06, strike:  0.0  },
    armSwing: { windup: -0.15, strike:  0.45 },   // draw back, then push the bolt FORWARD (was −0.35 = behind)
  },
  // Charger — COIL back hard (negative), then a deep forward lunge.
  // The big rig pitch + arm thrust sells the "springs across the gap."
  charge: {
    rigTilt:  { windup: -0.45, strike: -0.55 },
    bob:      { windup:  0.04, strike:  0.0  },
    armSwing: { windup: -0.45, strike:  1.10 },   // COIL arms back, then HURL forward (was +0.9/−1.3 = backwards)
  },
  // Slime tentacle lash — the body LEANS slowly over toward the player
  // (positive = forward) through the windup, then pitches hard into the
  // lash on strike. Pairs with the body-elongation deform in enemy.ts
  // (keyed on pose 'lash') so the slime visibly rears + reaches at you.
  lash: {
    rigTilt:  { windup:  0.55, strike:  0.95 },
    bob:      { windup:  0.0,  strike:  0.0  },
    armSwing: { windup:  0.0,  strike:  0.0  },
  },
};

/** Value for a node at the given phase + progress — SNAPPY BY DEFAULT, so any
 *  attack authored as {windup, strike} poses reads as anticipation → snap →
 *  follow-through without the author tuning a single curve:
 *   • windup : easeOutCubic — the limb cocks to its wound pose FAST then HOLDS
 *              there for the rest of the wind-up. The hold IS the telegraph.
 *   • strike : the wound pose JUMPS to the strike pose (1-frame snap — the hit),
 *              held for the strike beat.
 *   • recover: eases back to neutral.
 *  A "slow heavy" needs no special curve — give it a long `strike` duration in
 *  the ability and the same snap reads as a big committed swing. */
export function poseValue(p: Phased, phase: 'windup' | 'strike' | 'recover', t: number): number {
  if (phase === 'windup') return p.windup * ease('easeOutCubic', t);
  if (phase === 'strike') {
    // SWING TRAVEL — the limb drives from the held wound pose (p.windup) to the
    // struck pose (p.strike) over the first CONTACT_FRAC of the strike, easing
    // IN (accelerates into the blow), then holds struck for the rest. Replaces
    // the old 1-frame teleport, so the hit reads as a swing that ARRIVES — and
    // the damage frame (enemy.ts, same frac) lands when the blade gets there.
    const frac = CONFIG.MOB_STRIKE_CONTACT_FRAC;
    const k = frac > 0 ? Math.min(1, t / frac) : 1;
    return p.windup + (p.strike - p.windup) * ease('easeInCubic', k);
  }
  return p.strike * ease('easeOutQuad', 1 - t);
}

// ── Shared telegraph applicator ──────────────────────────────────────
// The node-level application of a telegraph pose, extracted so the live mob
// (mobs/enemy.ts) and the asset bench drive animation through ONE code path —
// the bench never drifts from the game. Operates on explicitly-passed rig
// nodes (all optional: a limbless blob has no shoulders) so it needs nothing
// from the enemy AI or the scene.

import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import type { EnemySpec } from '../content/enemies';
import { ease } from '../anim/easing';
import { CONFIG } from '../config';

export interface TelegraphNodes {
  /** Body part pitched on windup/strike (rotation.x). spec.tiltPartName. */
  tiltPart?: THREE.Object3D | null;
  /** Model root — owns the vertical bob (position.y). */
  root: THREE.Object3D;
  shoulderL?: THREE.Object3D | null;
  shoulderR?: THREE.Object3D | null;
  /** Resting shoulder pitch, so armSwing is additive (not absolute). */
  shoulderBaseLX: number;
  shoulderBaseRX: number;
}

/** Resolve the rig nodes a telegraph drives from a built model + its spec.
 *  Mirrors the lookups mobs/enemy.ts caches at spawn. */
export function telegraphNodesFor(built: BuiltModel, spec: EnemySpec): TelegraphNodes {
  const shoulderL = built.slots.get('shoulderL');
  const shoulderR = built.slots.get('shoulderR');
  return {
    tiltPart: built.parts.get(spec.tiltPartName) ?? built.slots.get(spec.tiltPartName),
    root: built.group,
    shoulderL,
    shoulderR,
    shoulderBaseLX: shoulderL ? shoulderL.rotation.x : 0,
    shoulderBaseRX: shoulderR ? shoulderR.rotation.x : 0,
  };
}

/** Apply a telegraph pose to the rig: body tilt + vertical bob + arm swing.
 *  Reads the shared TELEGRAPH_POSES data, so the silhouette is identical
 *  whether driven by the AI or the bench. */
export function applyTelegraphPose(
  n: TelegraphNodes,
  style: TelegraphStyle | undefined,
  phase: 'windup' | 'strike' | 'recover',
  t: number,
): void {
  const pose = TELEGRAPH_POSES[(style ?? 'swing') as TelegraphStyle];
  if (n.tiltPart) n.tiltPart.rotation.x = poseValue(pose.rigTilt, phase, t);
  n.root.position.y = poseValue(pose.bob, phase, t);
  const arm = poseValue(pose.armSwing, phase, t);
  if (n.shoulderL) n.shoulderL.rotation.x = n.shoulderBaseLX + arm;
  if (n.shoulderR) n.shoulderR.rotation.x = n.shoulderBaseRX + arm;
}

/** Neutralize the telegraph rig — call every frame a pose-system mob is NOT
 *  mid-attack (chasing / idle / staggered / …). applyTelegraphPose only runs
 *  during the attack phases, so without this a biped's SHOULDERS would freeze
 *  mid-swing if the attack is cut short (stagger, interrupt). Tilt/bob are
 *  already reset by the per-state code; this is the missing arm reset. */
export function restTelegraphPose(n: TelegraphNodes): void {
  if (n.shoulderL) n.shoulderL.rotation.x = n.shoulderBaseLX;
  if (n.shoulderR) n.shoulderR.rotation.x = n.shoulderBaseRX;
}
