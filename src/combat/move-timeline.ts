// MoveTimeline — the unified attack-move runtime (docs/MOVE-TIMELINE.md).
//
// An attack MOVE is ONE authored timeline read by BOTH the animation and the
// hits, so they can never desync (the flaw that made flurries invisible). Three
// separated concerns:
//
//   - MOTION  (how it LOOKS): normalized pose keyframes — an `intro`, a
//             repeatable `loop` cycle (one stab out-and-back), and an `outro`.
//   - TIMING  (how FAST): real-second durations, scaled by the `attackSpeed` stat.
//   - HITS    (what/WHEN): a strike lands at `hitAt` within each loop; the loop
//             COUNT is the flurry size, grown by the `flurryHits` stat.
//
// Two item stats reshape a move WITHOUT re-authoring it, and they're deliberately
// distinct (they feel different): `attackSpeed` compresses the whole clock
// (motion + hits stay synced), `flurryHits` adds loop iterations (more stabs,
// more hits — the animation just repeats its cycle more). Balance lives in the
// payload (owned by the caller), separate from motion + timing here.
//
// Pure + deterministic — no THREE, no globals. See tests/move-timeline.test.ts.

export interface MovePose { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; }

/** Easing applied FROM a keyframe to the next.
 *  - `smooth` (default): ease-in-out. Soft, for settles/holds.
 *  - `out`: ease-OUT — leaps then decelerates. The SNAP; use on a thrust/sweep so
 *    the strike drives out fast (matches the hand-tuned dagger's `1-(1-t)²`).
 *  - `in`: ease-in — slow build (a windup). `linear`: constant. */
export type EaseKind = 'smooth' | 'out' | 'in' | 'linear';

/** A pose keyframe. `t` is normalized 0..1 WITHIN its segment (intro/loop/outro).
 *  `ease` shapes the interpolation to the NEXT frame (default `smooth`). */
export interface Keyframe { t: number; pose: MovePose; ease?: EaseKind }

function applyEase(kind: EaseKind | undefined, t: number): number {
  switch (kind) {
    case 'out':    return 1 - (1 - t) * (1 - t);   // snappy — leaps then settles
    case 'in':     return t * t;
    case 'linear': return t;
    default:       return t * t * (3 - 2 * t);     // smoothstep
  }
}

export interface MoveSpec {
  motion: {
    intro: Keyframe[];   // windup, plays once
    loop: Keyframe[];    // ONE stab cycle (out→back) — repeated per hit
    outro: Keyframe[];   // recover, plays once
  };
  timing: { introS: number; loopS: number; outroS: number };   // real seconds at 1× speed
  loopCount: number;     // base flurry size (rips per press), >= 1
  hitAt: number;         // normalized point WITHIN a loop where the strike lands (0..1)
  /** Damage each rip deals, as a fraction of the weapon's resolved damage. So a
   *  combo can vary per move (a wide cut hits harder than one flurry rip). Default 1. */
  damageMul?: number;
  /** Reach multiplier for this move's hits — a lunge reaches further. Default 1. */
  reachMul?: number;
  /** Max targets this move's hits cleave — a sweep catches several. Default 1. */
  maxTargets?: number;
}

/** A combo step is EITHER a plain move (same regardless of movement) OR a
 *  DIRECTIONAL SET: the variant for the held movement direction, falling back to
 *  `neutral`. Authored per direction (the body genuinely differs — a forward
 *  lunge is not a side cut shoved sideways); the neutral is the default, so a
 *  step that only sets `neutral` behaves exactly like a plain move. Enrich the
 *  OPENER; keep deeper steps plain to hold the branching factor down. */
export interface DirectionalMoves {
  neutral: MoveSpec;
  forward?: MoveSpec;
  back?: MoveSpec;
  left?: MoveSpec;
  right?: MoveSpec;
  /** DASH attack — served when you strike right out of a dodge (Souls-style).
   *  Takes priority over the movement direction. */
  dash?: MoveSpec;
}
export type MoveStep = MoveSpec | DirectionalMoves;
export type MoveDir = 'forward' | 'back' | 'left' | 'right' | null;

/** Resolve a combo step against context: a DASH attack (if you just dodged and
 *  the step authors one) wins over the movement direction, which wins over the
 *  neutral/base move. A plain move ignores all context. */
export function pickMove(step: MoveStep, dir: MoveDir, dashed = false): MoveSpec {
  if ('motion' in step) return step;                 // a plain move — no variants
  if (dashed && step.dash) return step.dash;
  if (dir === 'forward' && step.forward) return step.forward;
  if (dir === 'back' && step.back) return step.back;
  if (dir === 'left' && step.left) return step.left;
  if (dir === 'right' && step.right) return step.right;
  return step.neutral;
}

/** The move a step plays at REST — for the viewmodel's directional PRIMING (it
 *  leans toward this variant's opening pose while you move that way). */
export function stepMoveFor(step: MoveStep, dir: MoveDir): MoveSpec {
  return pickMove(step, dir);
}

export interface MoveModifiers {
  /** >1 = faster (shorter durations). Compresses motion AND hits together. Default 1. */
  attackSpeed?: number;
  /** ADDED to loopCount — extra rips per press. Default 0. */
  flurryHits?: number;
}

export interface ResolvedMove {
  duration: number;      // total real seconds
  loops: number;         // effective loop count after flurryHits
  hitTimes: number[];    // real-time (s) at which each strike lands, ascending
  damageMul: number;     // per-rip damage fraction (from the move)
  reachMul: number;      // reach multiplier (from the move)
  maxTargets: number;    // cleave count (from the move)
  poseAt(t: number): MovePose;   // weapon pose at real-time t (seconds since move start)
}

const REST: MovePose = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };

/** How much of an `attackSpeed` boost applies to the ACTIVE strike (vs the
 *  recovery, which gets it in full). 0 = the strike never speeds up (only
 *  cadence does); 1 = everything scales together (ARPG-style, the swing blurs).
 *  ~0.4 = a faster weapon mostly attacks more OFTEN, the swing stays readable. */
const ACTIVE_SPEED_SHARE = 0.4;

function lerpPose(a: MovePose, b: MovePose, k: number): MovePose {
  return {
    x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
    rotX: a.rotX + (b.rotX - a.rotX) * k,
    rotY: a.rotY + (b.rotY - a.rotY) * k,
    rotZ: a.rotZ + (b.rotZ - a.rotZ) * k,
  };
}

/** Sample a keyframe track by normalized u (0..1), smoothstepped between frames. */
function sampleTrack(frames: Keyframe[], u: number): MovePose {
  if (frames.length === 0) return REST;
  if (u <= frames[0].t) return frames[0].pose;
  const last = frames[frames.length - 1];
  if (u >= last.t) return last.pose;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    if (u >= a.t && u <= b.t) {
      const span = b.t - a.t || 1;
      const raw = (u - a.t) / span;
      return lerpPose(a.pose, b.pose, applyEase(a.ease, raw));   // FROM-frame's easing
    }
  }
  return last.pose;
}

/** Resolve a move against the player's stats into a played timeline: total
 *  duration, the loop count, the real-times each strike lands, and a pose
 *  sampler. The animation calls poseAt() each frame; the combat resolver fires a
 *  strike as real-time crosses each hitTimes[] — same clock, guaranteed in sync. */
export function resolveMove(spec: MoveSpec, mods?: MoveModifiers): ResolvedMove {
  const speed = Math.max(0.1, mods?.attackSpeed ?? 1);
  const loops = Math.max(1, Math.round(spec.loopCount + (mods?.flurryHits ?? 0)));
  // attackSpeed is a RATE dial, NOT an animation-blur dial (docs/MOVE-TIMELINE.md):
  // it scales the RECOVERY (dead time — how soon you can act again) in full, but
  // the WINDUP + ACTIVE strike only partially (ACTIVE_SPEED_SHARE). So a faster
  // weapon attacks more OFTEN while the swing stays readable — the "attack speed
  // and animation speed are correlated but not the same" split. At speed 1 this
  // is identity, so it's inert until an attackSpeed item exists.
  const animRate = 1 + (speed - 1) * ACTIVE_SPEED_SHARE;
  const introReal = spec.timing.introS / animRate;
  const loopReal = spec.timing.loopS / animRate;
  const outroReal = spec.timing.outroS / speed;
  const loopsEnd = introReal + loops * loopReal;
  const duration = loopsEnd + outroReal;

  const hitTimes: number[] = [];
  for (let i = 0; i < loops; i++) hitTimes.push(introReal + i * loopReal + spec.hitAt * loopReal);

  function poseAt(t: number): MovePose {
    if (t <= 0) return spec.motion.intro[0]?.pose ?? REST;
    if (t < introReal) return sampleTrack(spec.motion.intro, t / introReal);
    if (t < loopsEnd) {
      const into = (t - introReal) % loopReal;   // where we are WITHIN the current loop
      return sampleTrack(spec.motion.loop, into / loopReal);
    }
    if (t < duration) return sampleTrack(spec.motion.outro, (t - loopsEnd) / outroReal);
    return spec.motion.outro[spec.motion.outro.length - 1]?.pose ?? REST;
  }

  return {
    duration, loops, hitTimes, poseAt,
    damageMul: spec.damageMul ?? 1,
    reachMul: spec.reachMul ?? 1,
    maxTargets: spec.maxTargets ?? 1,
  };
}
