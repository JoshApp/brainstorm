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

/** Two-hand pile-driver — both arms hoist overhead, body rears WAY back
 *  (longer hold than the old chop), then both fists pile-drive down at
 *  the locked marker with the body folding forward. Reads as a
 *  committed two-handed slam, not a quick chop. */
export const MARROW_PILE_DRIVER: Clip = {
  id: 'marrow-pile-driver',
  duration: 2.4,        // 1.30 + 0.20 + 0.90
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Mid-windup: arms already lifting, body starting to lean back so
    // the player has a long silhouette window to read the threat.
    { t: 0.35, pose: {
      shoulderL: { rot: [-1.4, 0,  0.2] },
      shoulderR: { rot: [-1.4, 0, -0.2] },
      spine:     { rot: [-0.12, 0, 0] },
      neck:      { rot: [-0.18, 0, 0] },
    } },
    // Windup peak (~t=0.55): arms fully overhead, head tipped back —
    // the death's-head reads against the ceiling.
    { t: 0.55, pose: {
      shoulderL: { rot: [-2.4, 0,  0.30] },
      shoulderR: { rot: [-2.4, 0, -0.30] },
      spine:     { rot: [-0.30, 0, 0] },
      neck:      { rot: [-0.35, 0, 0] },
    } },
    // SLAM — arms hammer down + body folds + pelvis drops to commit.
    { t: 0.625, pose: {
      shoulderL: { rot: [ 1.20, 0,  0.20] },
      shoulderR: { rot: [ 1.20, 0, -0.20] },
      spine:     { rot: [ 0.55, 0, 0] },
      neck:      { rot: [ 0.40, 0, 0] },
      pelvis:    { pos: [0, -0.18, 0] },
    } },
    // Brief follow-through hold — the slam settles.
    { t: 0.78, pose: {
      shoulderL: { rot: [ 0.90, 0,  0.10] },
      shoulderR: { rot: [ 0.90, 0, -0.10] },
      spine:     { rot: [ 0.30, 0, 0] },
      pelvis:    { pos: [0, -0.08, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

/** Earthshatter stomp — one leg lifts HIGH (the GIANT-STEP tell), brief
 *  hover at the apex so the player reads "he's about to plant it," then
 *  the foot SLAMS down with the pelvis dropping to commit weight. Radial
 *  shockwave fires from the foot's contact point. */
export const MARROW_EARTHSHATTER_STOMP: Clip = {
  id: 'marrow-earthshatter-stomp',
  duration: 2.4,        // 1.40 + 0.20 + 0.80
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Mid-windup — right knee starts rising, body leans LEFT to balance.
    { t: 0.35, pose: {
      hipR:      { rot: [-0.70, 0, 0] },
      ankleR:    { rot: [ 0.30, 0, 0] },
      hipL:      { rot: [ 0.10, 0, 0] },
      spine:     { rot: [0, 0, -0.10] },
      shoulderL: { rot: [0, 0,  0.30] },
      shoulderR: { rot: [0, 0, -0.20] },
    } },
    // APEX — knee high, foot toes-up, body counter-leans LEFT, arms
    // out wide for balance. Maximum silhouette tell.
    { t: 0.55, pose: {
      hipR:      { rot: [-1.40, 0, 0] },
      ankleR:    { rot: [ 0.50, 0, 0] },
      hipL:      { rot: [ 0.12, 0, 0] },
      spine:     { rot: [0.05, 0, -0.18] },
      neck:      { rot: [0.10, 0, 0] },
      shoulderL: { rot: [0, 0,  0.60] },
      shoulderR: { rot: [0, 0, -0.50] },
      pelvis:    { pos: [0, 0.05, 0] },
    } },
    // SLAM — knee drives down, foot plants, pelvis drops the body's
    // weight onto it. Arms swing forward for the follow-through.
    { t: 0.625, pose: {
      hipR:      { rot: [ 0.30, 0, 0] },
      ankleR:    { rot: [ 0.05, 0, 0] },
      hipL:      { rot: [-0.10, 0, 0] },
      spine:     { rot: [ 0.30, 0, 0.05] },
      neck:      { rot: [ 0.15, 0, 0] },
      shoulderL: { rot: [ 0.40, 0,  0.15] },
      shoulderR: { rot: [ 0.40, 0, -0.15] },
      pelvis:    { pos: [0, -0.18, 0] },
    } },
    // Settle.
    { t: 0.80, pose: {
      hipR:      { rot: [ 0.10, 0, 0] },
      spine:     { rot: [ 0.12, 0, 0] },
      pelvis:    { pos: [0, -0.06, 0] },
    } },
    { t: 1.00, pose: {} },
  ],
};

/** Skull-crush charge — bows torso forward, takes a tiny step back
 *  (cock), then BARRELS forward through the strike with the head LOW
 *  and the body angled like a battering ram. The horizontal travel is
 *  handled by the dash action; this clip is the BODY pose during the
 *  run + the after-shock recovery. */
export const MARROW_SKULL_CHARGE: Clip = {
  id: 'marrow-skull-charge',
  duration: 3.2,        // 1.30 + 0.80 + 1.10 (long windup = clear commit lock-in tell)
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Mid-cock — torso winds back, head reads UP, arms pull in.
    { t: 0.20, pose: {
      spine:     { rot: [-0.25, 0, 0] },
      neck:      { rot: [-0.18, 0, 0] },
      shoulderL: { rot: [-0.35, 0,  0.20] },
      shoulderR: { rot: [-0.35, 0, -0.20] },
      pelvis:    { pos: [0, 0.04, 0] },
    } },
    // Lock-in — windup peak, the body fully cocked. Reads "he's
    // committed; the lane is set." (Strike begins at t ≈ 0.406.)
    { t: 0.38, pose: {
      spine:     { rot: [-0.40, 0, 0] },
      neck:      { rot: [-0.25, 0, 0] },
      shoulderL: { rot: [-0.50, 0,  0.25] },
      shoulderR: { rot: [-0.50, 0, -0.25] },
      pelvis:    { pos: [0, 0.06, 0] },
    } },
    // Commit pose at strike start — head DROPS forward, body angles low.
    { t: 0.43, pose: {
      spine:     { rot: [ 0.55, 0, 0] },
      neck:      { rot: [ 0.60, 0, 0] },
      shoulderL: { rot: [-0.80, 0,  0.10] },
      shoulderR: { rot: [-0.80, 0, -0.10] },
      pelvis:    { pos: [0, -0.10, 0] },
    } },
    // Run — held through the strike window. Body stays low + forward
    // while the dash action drives horizontal travel. (Strike ends at
    // t ≈ 0.656.)
    { t: 0.65, pose: {
      spine:     { rot: [ 0.60, 0, 0] },
      neck:      { rot: [ 0.65, 0, 0] },
      shoulderL: { rot: [-0.60, 0,  0.10] },
      shoulderR: { rot: [-0.60, 0, -0.10] },
      pelvis:    { pos: [0, -0.10, 0] },
    } },
    // Skid-stop — body straightens up, arms fling for balance, head
    // shakes off the impact.
    { t: 0.82, pose: {
      spine:     { rot: [-0.10, 0, 0] },
      neck:      { rot: [-0.05, 0, 0] },
      shoulderL: { rot: [ 0.20, 0,  0.50] },
      shoulderR: { rot: [ 0.20, 0, -0.50] },
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

/** Phase-2 bone-fragments — he reaches a clawed hand INTO his own
 *  ribcage, rips a shard of rib loose, and hurls it at the player.
 *  Reads as a physical projectile, not a spell. The reach-in pose is
 *  the tell; the whip-out is the strike. */
export const MARROW_BONE_FRAGMENTS: Clip = {
  id: 'marrow-bone-fragments',
  duration: 1.64,       // 0.90 + 0.14 + 0.60
  loop: false,
  smooth: true,
  keyframes: [
    { t: 0.00, pose: {} },
    // Reach into the chest — right arm crosses to grip a rib, head down.
    { t: 0.30, pose: {
      shoulderR: { rot: [ 0.40, -0.80, -0.80] },
      spine:     { rot: [-0.10,  0.20, 0] },
      neck:      { rot: [ 0.25, -0.10, 0] },
    } },
    // RIP — arm tears the shard free, body coils forward over the
    // ribcage, head locks onto the player (the read-the-target beat).
    { t: 0.55, pose: {
      shoulderR: { rot: [ 0.10, -1.10, -1.10] },
      spine:     { rot: [-0.20,  0.25, 0] },
      neck:      { rot: [ 0.10, -0.20, 0] },
    } },
    // HURL — right arm whips out forward, body uncoils + drives spine
    // forward to launch the shard at the player.
    { t: 0.65, pose: {
      shoulderR: { rot: [-0.50,  0.80,  0.60] },
      spine:     { rot: [ 0.25, -0.15, 0] },
      neck:      { rot: [ 0.10,  0.05, 0] },
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
    // Phase 1.
    'bone-arm-sweep':     MARROW_BONE_ARM_SWEEP,
    'pile-driver':        MARROW_PILE_DRIVER,
    'earthshatter-stomp': MARROW_EARTHSHATTER_STOMP,
    'skull-crush-charge': MARROW_SKULL_CHARGE,
    // Phase 2.
    'arm-swipe':          MARROW_ARM_SWIPE,
    'lunge-bite':         MARROW_LUNGE_BITE,
    'bone-fragments':     MARROW_BONE_FRAGMENTS,
  },
};

/** The joint slot names the animator drives. The skeleton model must
 *  expose these as slots; see src/content/skeleton-boss.ts. */
export const MARROW_JOINTS = [
  'pelvis', 'hipL', 'hipR', 'ankleL', 'ankleR',
  'spine', 'shoulderL', 'shoulderR', 'neck',
] as const;
