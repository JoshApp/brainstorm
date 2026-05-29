import type { ModelSpec, Vec3 } from '../ecs/model-types';

// Parametric creature builder — assembles a humanoid ModelSpec with the
// FULL animation rig baked in (rig + shoulderL/R + hipL/R + neck slots,
// arms/fists under the shoulders, legs/feet under the hips, head/eyes
// under the neck). Because it uses the standard slot names, anything
// built with it inherits — for free — the arm-swing telegraph, the
// walk gait, and the head crane that enemy.ts drives off those slots.
//
// This is the reusable path for NEW enemies: a few params instead of a
// bespoke 40-line model function, and the rig is correct by
// construction (no per-model risk of forgetting a pivot). The existing
// hand-tuned models stay as-is; migrate them only if a silhouette
// tweak is wanted.
//
// All measurements are relative to the rig slot (which sits at `height`
// off the floor); the pivots are placed where the animation expects
// them. Proportion knobs make distinct silhouettes (lean vs bulky,
// long vs short limbs, stooped vs upright).

export interface CreatureOptions {
  id: string;
  /** Body + eye colours. */
  palette: {
    body: number;
    eye: number;
    eyeEmissive?: number;     // default 2.2
    bodyEmissive?: number;    // faint self-glow, default 0x140a08
  };
  /** Optional rim-glow on the body material (spectral / wet / etc.). */
  rim?: { color: number; power?: number; intensity?: number };
  /** Hip-pivot height off the floor (the model's "waist"). Default 1.05. */
  height?: number;
  /** Overall girth multiplier — <1 lean, >1 bulky. Default 1. */
  build?: number;
  /** Arm capsule length. Default 0.50. */
  armLength?: number;
  /** Leg capsule length. Default 0.45. */
  legLength?: number;
  /** Head sphere radius. Default 0.24. */
  headRadius?: number;
  /** Head forward offset (stoop). Larger = more hunched. Default 0.05. */
  hunch?: number;
}

export function creature(opts: CreatureOptions): ModelSpec {
  const H = opts.height ?? 1.05;
  const b = opts.build ?? 1;
  const armLen = opts.armLength ?? 0.50;
  const legLen = opts.legLength ?? 0.45;
  const headR = opts.headRadius ?? 0.24;
  const hunch = opts.hunch ?? 0.05;

  const bodyR = 0.30 * b;
  const shoulderX = 0.30 * b;
  const hipX = 0.18 * b;

  // Pivot heights, relative to the rig slot.
  const SHOULDER_Y = 0.20;
  const HIP_Y = -0.40;
  const NECK_Y = 0.42;

  // Leg + foot positions, relative to the HIP pivot (hang below it).
  const legCenterY = -(legLen / 2 + 0.05);
  const footY = -(legLen + 0.12);
  // Arm + fist positions, relative to the SHOULDER pivot.
  const armCenterY = -(armLen / 2);
  const fistY = -(armLen + 0.06);
  // Head + eyes sit just above the NECK pivot.
  const headLocalY = 0.15;

  return {
    id: opts.id,
    materials: {
      body: {
        color: opts.palette.body,
        roughness: 0.95,
        emissive: opts.palette.bodyEmissive ?? 0x140a08,
        emissiveIntensity: 0.35,
        flatShading: 'auto',
        dissolvable: true,
        ...(opts.rim ? { rim: { color: opts.rim.color, power: opts.rim.power ?? 3.2, intensity: opts.rim.intensity ?? 0.6 } } : {}),
      },
      eyes: {
        color: 0x000000,
        emissive: opts.palette.eye,
        emissiveIntensity: opts.palette.eyeEmissive ?? 2.2,
        roughness: 1.0,
      },
    },
    slots: {
      rig: { pos: [0, H, 0] },
      shoulderL: { pos: [-shoulderX, SHOULDER_Y, 0.04], parent: 'rig' },
      shoulderR: { pos: [ shoulderX, SHOULDER_Y, 0.04], parent: 'rig' },
      hipL: { pos: [-hipX, HIP_Y, 0], parent: 'rig' },
      hipR: { pos: [ hipX, HIP_Y, 0], parent: 'rig' },
      neck: { pos: [0, NECK_Y, 0], parent: 'rig' },
    },
    parts: [
      // Legs + feet — under the hip pivots so they stride with the gait.
      { parent: 'hipL', kind: 'capsule', pos: [0, legCenterY, 0], radius: 0.085 * b, height: legLen, mat: 'body', jitter: 0.016 },
      { parent: 'hipR', kind: 'capsule', pos: [0, legCenterY, 0], radius: 0.085 * b, height: legLen, mat: 'body', jitter: 0.016 },
      { parent: 'hipL', kind: 'box', pos: [0, footY, 0.04], size: [0.16 * b, 0.07, 0.22], mat: 'body', jitter: 0.010 },
      { parent: 'hipR', kind: 'box', pos: [0, footY, 0.04], size: [0.16 * b, 0.07, 0.22], mat: 'body', jitter: 0.010 },
      // Torso.
      { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.05, 0], radius: bodyR, height: 0.58, mat: 'body', jitter: 0.026 },
      // Shoulder humps (cosmetic mass at the joints).
      { parent: 'rig', kind: 'sphere', pos: [-shoulderX, SHOULDER_Y + 0.05, 0], radius: 0.15 * b, segments: [12, 10], mat: 'body', jitter: 0.020 },
      { parent: 'rig', kind: 'sphere', pos: [ shoulderX, SHOULDER_Y + 0.05, 0], radius: 0.15 * b, segments: [12, 10], mat: 'body', jitter: 0.020 },
      // Arms + fists — under the shoulder pivots so they swing on attack.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, armCenterY, 0.04], radius: 0.075 * b, height: armLen, mat: 'body', jitter: 0.018 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, armCenterY, 0.04], radius: 0.075 * b, height: armLen, mat: 'body', jitter: 0.018 },
      { parent: 'shoulderL', kind: 'sphere', pos: [0, fistY, 0.04], radius: 0.09 * b, segments: [10, 8], mat: 'body', jitter: 0.016 },
      { parent: 'shoulderR', kind: 'sphere', pos: [0, fistY, 0.04], radius: 0.09 * b, segments: [10, 8], mat: 'body', jitter: 0.016 },
      // Head + eyes — under the neck pivot so they crane toward the player.
      { name: 'head', parent: 'neck', kind: 'sphere', pos: [0, headLocalY, -hunch], scale: [1.05, 1.0, 1], radius: headR, mat: 'body', jitter: 0.024 },
      { parent: 'neck', kind: 'sphere', pos: [-0.08, headLocalY + 0.03, -(headR + 0.03)], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      { parent: 'neck', kind: 'sphere', pos: [ 0.08, headLocalY + 0.03, -(headR + 0.03)], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      // Eye halos so the gaze reads at distance.
      { name: 'eyeHaloL', parent: 'neck', kind: 'sprite', pos: [-0.08, headLocalY + 0.03, -(headR + 0.06)], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: opts.palette.eye },
      { name: 'eyeHaloR', parent: 'neck', kind: 'sprite', pos: [ 0.08, headLocalY + 0.03, -(headR + 0.06)], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: opts.palette.eye },
    ],
  };
}
