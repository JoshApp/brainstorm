import type { Clip } from './types';

// Clip library for the Marrow Sovereign.
//
// Joint convention (see skeleton-boss.ts for the slot layout):
//   - pelvis             (vertical bob during walk)
//   - hipL / hipR        (leg swing, +x = forward)
//   - spine              (upper-body twist/lean, y = twist around vertical)
//   - shoulderL / shoulderR  (arm swing — +x forward, ±z up/down, ±y inward/outward)
//   - neck               (head tilt)
//
// Rotations are DELTAS from the rest pose. Pure rest = empty pose.
//
// Authoring rule of thumb: a strong silhouette pose at the windup peak
// (~t=0.55) sells the read better than a fast strike. Players see the
// pose for a long time and use it to decide where to dodge. The strike
// itself can be a single frame at t=0.70 — the eye reads the move from
// "here he comes" → "BLUR" → "follow-through."

// ── BASE LAYER (locomotion) ──────────────────────────────────────────

/** Slow ominous breath while standing still. Just neck + spine. */
export const MARROW_IDLE: Clip = {
  id: 'marrow-idle',
  duration: 3.6,
  loop: true,
  smooth: true,
  keyframes: [
    { t: 0.0, pose: {
      neck:  { rot: [0.02, 0.05, 0] },
      spine: { rot: [0.02, 0, 0] },
    } },
    { t: 0.5, pose: {
      neck:  { rot: [0.0, -0.05, 0] },
      spine: { rot: [-0.01, 0, 0] },
    } },
    { t: 1.0, pose: {
      neck:  { rot: [0.02, 0.05, 0] },
      spine: { rot: [0.02, 0, 0] },
    } },
  ],
};

/** Heavy stride. Opposing hip + shoulder swing with a vertical bob and
 *  a slight twist of the upper body. 1.2s per cycle is "slow giant." */
export const MARROW_WALK: Clip = {
  id: 'marrow-walk',
  duration: 1.2,
  loop: true,
  smooth: true,
  keyframes: [
    // Right foot planted, left foot forward (knee leads with hip).
    { t: 0.00, pose: {
      hipL:      { rot: [ 0.45, 0, 0] },
      hipR:      { rot: [-0.30, 0, 0] },
      shoulderL: { rot: [-0.30, 0, 0] },
      shoulderR: { rot: [ 0.30, 0, 0] },
      pelvis:    { pos: [0, -0.05, 0] },
      spine:     { rot: [0.04, -0.10, 0] },
      neck:      { rot: [0, 0.08, 0] },
    } },
    // Mid-step — body bobs up, legs pass.
    { t: 0.25, pose: {
      hipL:      { rot: [0, 0, 0] },
      hipR:      { rot: [0, 0, 0] },
      shoulderL: { rot: [0, 0, 0] },
      shoulderR: { rot: [0, 0, 0] },
      pelvis:    { pos: [0, 0.06, 0] },
      spine:     { rot: [0.02, 0, 0] },
    } },
    // Mirror — left planted, right forward.
    { t: 0.50, pose: {
      hipL:      { rot: [-0.30, 0, 0] },
      hipR:      { rot: [ 0.45, 0, 0] },
      shoulderL: { rot: [ 0.30, 0, 0] },
      shoulderR: { rot: [-0.30, 0, 0] },
      pelvis:    { pos: [0, -0.05, 0] },
      spine:     { rot: [0.04, 0.10, 0] },
      neck:      { rot: [0, -0.08, 0] },
    } },
    { t: 0.75, pose: {
      hipL:      { rot: [0, 0, 0] },
      hipR:      { rot: [0, 0, 0] },
      shoulderL: { rot: [0, 0, 0] },
      shoulderR: { rot: [0, 0, 0] },
      pelvis:    { pos: [0, 0.06, 0] },
      spine:     { rot: [0.02, 0, 0] },
    } },
    { t: 1.00, pose: {
      hipL:      { rot: [ 0.45, 0, 0] },
      hipR:      { rot: [-0.30, 0, 0] },
      shoulderL: { rot: [-0.30, 0, 0] },
      shoulderR: { rot: [ 0.30, 0, 0] },
      pelvis:    { pos: [0, -0.05, 0] },
      spine:     { rot: [0.04, -0.10, 0] },
      neck:      { rot: [0, 0.08, 0] },
    } },
  ],
};

/** Phase-2 crawl. Both arms drag the body forward, alternating. The hips
 *  are gone (parts hidden) but we still drive the slots — harmlessly. */
export const MARROW_CRAWL: Clip = {
  id: 'marrow-crawl',
  duration: 1.1,
  loop: true,
  smooth: true,
  keyframes: [
    // Left arm reaches forward, right arm pushes back.
    { t: 0.00, pose: {
      shoulderL: { rot: [ 0.9, 0, -0.4] },
      shoulderR: { rot: [-0.4, 0,  0.3] },
      spine:     { rot: [0.08, -0.20, 0] },
      neck:      { rot: [-0.2, 0.15, 0] },
    } },
    // Pass-through.
    { t: 0.50, pose: {
      shoulderL: { rot: [-0.4, 0, -0.3] },
      shoulderR: { rot: [ 0.9, 0,  0.4] },
      spine:     { rot: [0.08, 0.20, 0] },
      neck:      { rot: [-0.2, -0.15, 0] },
    } },
    { t: 1.00, pose: {
      shoulderL: { rot: [ 0.9, 0, -0.4] },
      shoulderR: { rot: [-0.4, 0,  0.3] },
      spine:     { rot: [0.08, -0.20, 0] },
      neck:      { rot: [-0.2, 0.15, 0] },
    } },
  ],
};

// ── OVERRIDE LAYER (abilities) ───────────────────────────────────────
// Each clip's default duration is the spec's ability total; the play
// call passes that exact total so the timeline maps 1:1. Keyframe times
// are normalized 0..1, so the windup peak sits at ~t=(windup/total).

/** Bone-arm sweep — the old greatscythe sweep, now a clawed arm cleave.
 *  Right shoulder windbacks across the chest, the body coils LEFT, then
 *  the arm cleaves RIGHT across the strike frame with a body uncoil. */
export const MARROW_BONE_ARM_SWEEP: Clip = {
  id: 'marrow-bone-arm-sweep',
  duration: 2.4,        // matches the ability's windup+strike+recover (1.4+0.3+0.7)
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: { shoulderR: { rot: [0, 0, 0] }, spine: { rot: [0, 0, 0] } } },
    // Windup peak (~t=0.55 ≈ windup/total).
    { t: 0.55, pose: {
      shoulderR: { rot: [-0.5, -1.4, -1.1] },
      spine:     { rot: [0, -0.45, 0] },
      neck:      { rot: [0, -0.55, -0.05] },
    } },
    // Strike midpoint.
    { t: 0.70, pose: {
      shoulderR: { rot: [-0.2,  1.3,  0.9] },
      spine:     { rot: [0,  0.50, 0] },
      neck:      { rot: [0,  0.30, 0] },
    } },
    // Recover.
    { t: 1.00, pose: {
      shoulderR: { rot: [0, 0, 0] }, spine: { rot: [0, 0, 0] }, neck: { rot: [0, 0, 0] },
    } },
  ],
};

/** Ground chop — both arms raise overhead, then slam down on the marker.
 *  Body bends forward through the strike to sell the weight. */
export const MARROW_CHOP: Clip = {
  id: 'marrow-chop',
  duration: 2.1,        // 1.10 + 0.20 + 0.80
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Both arms raised overhead at the windup peak (~t=0.52).
    { t: 0.52, pose: {
      shoulderL: { rot: [-2.2, 0,  0.3] },
      shoulderR: { rot: [-2.2, 0, -0.3] },
      spine:     { rot: [-0.20, 0, 0] },
      neck:      { rot: [-0.20, 0, 0] },
    } },
    // SLAM — arms pile-drive down, body bends forward.
    { t: 0.62, pose: {
      shoulderL: { rot: [ 1.0, 0,  0.2] },
      shoulderR: { rot: [ 1.0, 0, -0.2] },
      spine:     { rot: [ 0.45, 0, 0] },
      neck:      { rot: [ 0.30, 0, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

/** Spike-ring — arms spread wide, then slam down on the floor around him.
 *  Radial telegraph: the wide pose says "everything nearby will be hit." */
export const MARROW_SPIKE_RING: Clip = {
  id: 'marrow-spike-ring',
  duration: 2.4,        // 1.40 + 0.20 + 0.80
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Arms spread to the sides, body straightens up.
    { t: 0.55, pose: {
      shoulderL: { rot: [0, 0,  1.1] },
      shoulderR: { rot: [0, 0, -1.1] },
      spine:     { rot: [-0.10, 0, 0] },
    } },
    // Slam — arms pull down to slap the floor; body bends.
    { t: 0.62, pose: {
      shoulderL: { rot: [ 0.6, 0,  0.3] },
      shoulderR: { rot: [ 0.6, 0, -0.3] },
      spine:     { rot: [ 0.35, 0, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

/** Phase-2 arm-swipe — short, fast, low. One arm rakes across. */
export const MARROW_ARM_SWIPE: Clip = {
  id: 'marrow-arm-swipe',
  duration: 1.30,       // 0.55 + 0.20 + 0.55
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    { t: 0.42, pose: {
      shoulderR: { rot: [ 0.5, -1.0, -0.5] },
      spine:     { rot: [0.08, -0.20, 0] },
    } },
    { t: 0.58, pose: {
      shoulderR: { rot: [ 0.9,  1.2,  0.3] },
      spine:     { rot: [0.10,  0.20, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

/** Phase-2 marrow-claw — cast pose, body rears up to spit. */
export const MARROW_CLAW_CAST: Clip = {
  id: 'marrow-claw-cast',
  duration: 1.64,       // 0.90 + 0.14 + 0.60
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Head pulls back, mouth-equivalent gathers — left arm braces.
    { t: 0.55, pose: {
      neck:      { rot: [-0.45, 0, 0] },
      spine:     { rot: [-0.15, 0, 0] },
      shoulderL: { rot: [0.3, 0, 0.3] },
    } },
    // Spit — head whips forward.
    { t: 0.65, pose: {
      neck:      { rot: [0.40, 0, 0] },
      spine:     { rot: [0.15, 0, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

/** Phase-2 lunge-bite — head + shoulders drive forward. */
export const MARROW_LUNGE_BITE: Clip = {
  id: 'marrow-lunge-bite',
  duration: 1.13,       // 0.45 + 0.18 + 0.50
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Coil — head back, shoulders pulled.
    { t: 0.40, pose: {
      neck:  { rot: [-0.30, 0, 0] },
      spine: { rot: [-0.15, 0, 0] },
    } },
    // Lunge — head + body whip forward.
    { t: 0.58, pose: {
      neck:  { rot: [ 0.50, 0, 0] },
      spine: { rot: [ 0.35, 0, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

// ── Bundle ───────────────────────────────────────────────────────────
//
// What the enemy AI plumbing reads. The mob spec just points at this
// bundle; the AI decides which clip to run per state.

export interface MarrowClips {
  idle: Clip;
  walk: Clip;
  crawl: Clip;
  abilities: Record<string, Clip>;   // keyed by ability id
}

export const MARROW_CLIPS: MarrowClips = {
  idle:  MARROW_IDLE,
  walk:  MARROW_WALK,
  crawl: MARROW_CRAWL,
  abilities: {
    'bone-arm-sweep': MARROW_BONE_ARM_SWEEP,
    'chop':           MARROW_CHOP,
    'spike-ring':     MARROW_SPIKE_RING,
    'arm-swipe':      MARROW_ARM_SWIPE,
    'marrow-claw':    MARROW_CLAW_CAST,
    'lunge-bite':     MARROW_LUNGE_BITE,
  },
};

/** The joint slot names the animator drives. The skeleton model must
 *  expose these as slots; see src/content/skeleton-boss.ts. */
export const MARROW_JOINTS = [
  'pelvis', 'hipL', 'hipR', 'spine', 'shoulderL', 'shoulderR', 'neck',
] as const;
