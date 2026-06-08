import type { ModelSpec, PartSpec, Vec3 } from '../ecs/model-types';

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
  /** Head silhouette. 'smooth' = plain sphere (default); 'skull' = sphere +
   *  jaw + dark recessed eye-sockets the glow sits inside. */
  head?: 'smooth' | 'skull';
  /** Torso silhouette. 'solid' = capsule (default); 'ribcage' = thin spine
   *  + exposed rib slats (the skeletal read). */
  torso?: 'solid' | 'ribcage';
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
  const headStyle = opts.head ?? 'smooth';
  const torsoStyle = opts.torso ?? 'solid';

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
    // Rigged upright — opt into the lego-figure merge. The joints (rig /
    // shoulders / hips / neck) still animate; the unnamed limb/torso meshes
    // collapse per joint. Cuts these ~27-mesh creatures to ~8-10 draws.
    mergeRigid: true,
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
      // Near-black recesses for skull eye-sockets (the glow sits inside).
      socket: { color: 0x070809, roughness: 1.0, flatShading: 'auto' },
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
      // Torso — solid capsule, or a skeletal spine + exposed ribs.
      ...(torsoStyle === 'ribcage'
        ? [
            // Thin spine (still named 'body' so the hit-flash material hooks).
            { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.05, 0], radius: bodyR * 0.42, height: 0.58, mat: 'body', jitter: 0.02 } as PartSpec,
            // Rib slats across the chest front (-Z), tapering downward. Thin
            // horizontal cylinders read as an exposed ribcage at silhouette.
            { parent: 'rig', kind: 'cylinder', pos: [0,  0.14, -bodyR * 0.55], radius: 0.026, height: bodyR * 1.7, rot: [0, 0, Math.PI / 2], mat: 'body', jitter: 0.012 } as PartSpec,
            { parent: 'rig', kind: 'cylinder', pos: [0,  0.02, -bodyR * 0.60], radius: 0.028, height: bodyR * 1.9, rot: [0, 0, Math.PI / 2], mat: 'body', jitter: 0.012 } as PartSpec,
            { parent: 'rig', kind: 'cylinder', pos: [0, -0.10, -bodyR * 0.55], radius: 0.026, height: bodyR * 1.7, rot: [0, 0, Math.PI / 2], mat: 'body', jitter: 0.012 } as PartSpec,
            { parent: 'rig', kind: 'cylinder', pos: [0, -0.22, -bodyR * 0.45], radius: 0.024, height: bodyR * 1.3, rot: [0, 0, Math.PI / 2], mat: 'body', jitter: 0.012 } as PartSpec,
            // Pelvis block at the hips.
            { parent: 'rig', kind: 'box', pos: [0, HIP_Y + 0.08, 0], size: [hipX * 2.4, 0.14, 0.18 * b], mat: 'body', jitter: 0.012 } as PartSpec,
          ]
        : [
            { name: 'body', parent: 'rig', kind: 'capsule', pos: [0, -0.05, 0], radius: bodyR, height: 0.58, mat: 'body', jitter: 0.026 } as PartSpec,
          ]),
      // Shoulder humps (cosmetic mass at the joints). Smaller + bonier on a ribcage.
      { parent: 'rig', kind: 'sphere', pos: [-shoulderX, SHOULDER_Y + 0.05, 0], radius: (torsoStyle === 'ribcage' ? 0.10 : 0.15) * b, segments: [12, 10], mat: 'body', jitter: 0.020 },
      { parent: 'rig', kind: 'sphere', pos: [ shoulderX, SHOULDER_Y + 0.05, 0], radius: (torsoStyle === 'ribcage' ? 0.10 : 0.15) * b, segments: [12, 10], mat: 'body', jitter: 0.020 },
      // Arms + fists — under the shoulder pivots so they swing on attack.
      { parent: 'shoulderL', kind: 'capsule', pos: [0, armCenterY, 0.04], radius: 0.075 * b, height: armLen, mat: 'body', jitter: 0.018 },
      { parent: 'shoulderR', kind: 'capsule', pos: [0, armCenterY, 0.04], radius: 0.075 * b, height: armLen, mat: 'body', jitter: 0.018 },
      { parent: 'shoulderL', kind: 'sphere', pos: [0, fistY, 0.04], radius: 0.09 * b, segments: [10, 8], mat: 'body', jitter: 0.016 },
      { parent: 'shoulderR', kind: 'sphere', pos: [0, fistY, 0.04], radius: 0.09 * b, segments: [10, 8], mat: 'body', jitter: 0.016 },
      // Head — plain cranium, or a skull (elongated cranium + jaw + dark
      // recessed sockets). Under the neck pivot so it cranes toward the player.
      ...(headStyle === 'skull'
        ? [
            { name: 'head', parent: 'neck', kind: 'sphere', pos: [0, headLocalY + 0.02, -hunch], scale: [0.92, 1.0, 1.12], radius: headR, mat: 'body', jitter: 0.022 } as PartSpec,
            // Jaw — a small box jutting forward-down under the cranium.
            { parent: 'neck', kind: 'box', pos: [0, headLocalY - headR * 0.72, -(hunch + headR * 0.55)], size: [headR * 1.05, headR * 0.5, headR * 0.7], mat: 'body', jitter: 0.012 } as PartSpec,
            // Dark eye sockets — the glow spheres sit just in front of these.
            { parent: 'neck', kind: 'sphere', pos: [-0.085, headLocalY + 0.04, -(headR + 0.005)], radius: 0.072, segments: [12, 10], mat: 'socket' } as PartSpec,
            { parent: 'neck', kind: 'sphere', pos: [ 0.085, headLocalY + 0.04, -(headR + 0.005)], radius: 0.072, segments: [12, 10], mat: 'socket' } as PartSpec,
          ]
        : [
            { name: 'head', parent: 'neck', kind: 'sphere', pos: [0, headLocalY, -hunch], scale: [1.05, 1.0, 1], radius: headR, mat: 'body', jitter: 0.024 } as PartSpec,
          ]),
      { parent: 'neck', kind: 'sphere', pos: [-0.08, headLocalY + 0.03, -(headR + 0.03)], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      { parent: 'neck', kind: 'sphere', pos: [ 0.08, headLocalY + 0.03, -(headR + 0.03)], radius: 0.045, segments: [12, 10], mat: 'eyes' },
      // Eye halos so the gaze reads at distance.
      { name: 'eyeHaloL', parent: 'neck', kind: 'sprite', pos: [-0.08, headLocalY + 0.03, -(headR + 0.06)], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: opts.palette.eye },
      { name: 'eyeHaloR', parent: 'neck', kind: 'sprite', pos: [ 0.08, headLocalY + 0.03, -(headR + 0.06)], size: [0.16, 0.16], texture: 'fire-wisp', blending: 'additive', color: opts.palette.eye },
    ],
  };
}
