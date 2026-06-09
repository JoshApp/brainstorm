import type { Archetype, Proportions, SkeletonDef, SkeletonFn, JointDef } from './creature-types';

// Archetype skeletons — the joint hierarchies everything derives from. Each is a
// pure function of resolved Proportions, returning rest joint positions (root
// frame, feet at y=0) plus the metadata the auto-hurtbox + animation read
// (spine chain, head joint, limb chains). See docs/CREATURE-SYSTEM.md.

/** Height-derived proportion defaults — set `height` and the rest follow, so a
 *  minimal spec is a few lines. Override any field on top. */
function defaultsFor(a: Archetype, height: number): Proportions {
  switch (a) {
    case 'biped':
      return {
        height,
        girth: height * 0.16,
        headSize: height * 0.13,
        armLength: height * 0.42,
        legLength: height * 0.46,
        neckLength: height * 0.06,
        hunch: 0,
      };
    case 'quadruped':
      return {
        height, girth: height * 0.30, headSize: height * 0.26,
        armLength: height * 0.9, legLength: height * 0.9, neckLength: height * 0.2, hunch: 0,
      };
    case 'blob':
      return {
        height, girth: height * 0.6, headSize: height * 0.3,
        armLength: 0, legLength: 0, neckLength: 0, hunch: 0,
      };
    case 'ghost':
      return {
        height, girth: height * 0.18, headSize: height * 0.11,
        armLength: height * 0.4, legLength: 0, neckLength: 0, hunch: 0,
      };
  }
}

const DEFAULT_HEIGHT: Record<Archetype, number> = { biped: 1.6, quadruped: 0.7, blob: 0.7, ghost: 1.7 };

/** Fill proportions from height-derived defaults, then apply overrides. */
export function resolveProportions(a: Archetype, partial?: Partial<Proportions>): Proportions {
  const height = partial?.height ?? DEFAULT_HEIGHT[a];
  return { ...defaultsFor(a, height), ...partial };
}

// ── Biped ────────────────────────────────────────────────────────────────────
// root(feet) → pelvis → spine → neck → head; spine → shoulderL/R → elbowL/R →
// handL/R; pelvis → hipL/R → kneeL/R → footL/R. Positions in root frame; the
// builder converts to parent-local.
function bipedSkeleton(p: Proportions): SkeletonDef {
  const hipY = p.legLength;
  const chestY = hipY + p.height * 0.30;          // torso span
  const neckY = chestY + p.neckLength;
  const headY = neckY + p.headSize;               // head centre (crown ≈ headY + headSize)
  const shX = p.girth * 1.05;                     // shoulder half-width
  const hipX = p.girth * 0.55;
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', abs: [0, hipY, 0] },
    { name: 'spine', parent: 'pelvis', abs: [0, chestY, 0] },
    { name: 'neck', parent: 'spine', abs: [0, neckY, p.hunch * 0.3] },
    { name: 'head', parent: 'neck', abs: [0, headY, -p.hunch] },
    { name: 'shoulderL', parent: 'spine', abs: [-shX, chestY + p.height * 0.04, 0] },
    { name: 'shoulderR', parent: 'spine', abs: [shX, chestY + p.height * 0.04, 0] },
    { name: 'elbowL', parent: 'shoulderL', abs: [-shX, chestY + p.height * 0.04 - p.armLength * 0.5, 0] },
    { name: 'elbowR', parent: 'shoulderR', abs: [shX, chestY + p.height * 0.04 - p.armLength * 0.5, 0] },
    { name: 'handL', parent: 'elbowL', abs: [-shX, chestY + p.height * 0.04 - p.armLength, 0] },
    { name: 'handR', parent: 'elbowR', abs: [shX, chestY + p.height * 0.04 - p.armLength, 0] },
    { name: 'hipL', parent: 'pelvis', abs: [-hipX, hipY, 0] },
    { name: 'hipR', parent: 'pelvis', abs: [hipX, hipY, 0] },
    { name: 'kneeL', parent: 'hipL', abs: [-hipX, hipY - p.legLength * 0.5, 0] },
    { name: 'kneeR', parent: 'hipR', abs: [hipX, hipY - p.legLength * 0.5, 0] },
    { name: 'footL', parent: 'kneeL', abs: [-hipX, 0, 0.04] },
    { name: 'footR', parent: 'kneeR', abs: [hipX, 0, 0.04] },
  ];
  return {
    joints: j,
    root: 'root',
    spine: ['pelvis', 'spine', 'neck'],
    head: 'head',
    limbs: [
      ['shoulderL', 'handL'], ['shoulderR', 'handR'],
      ['hipL', 'footL'], ['hipR', 'footR'],
    ],
  };
}

// ── Quadruped (stub — fleshed out when we migrate the rat/hound) ─────────────
function quadrupedSkeleton(p: Proportions): SkeletonDef {
  const backY = p.legLength;
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'spine', parent: 'root', abs: [0, backY, 0] },
    { name: 'neck', parent: 'spine', abs: [0, backY + p.neckLength, -p.girth] },
    { name: 'head', parent: 'neck', abs: [0, backY + p.neckLength, -p.girth - p.headSize] },
  ];
  return { joints: j, root: 'root', spine: ['spine', 'neck'], head: 'head', limbs: [] };
}

// ── Blob (headless; a core, no limbs) ────────────────────────────────────────
function blobSkeleton(p: Proportions): SkeletonDef {
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'core', parent: 'root', abs: [0, p.girth, 0] },
  ];
  return { joints: j, root: 'root', spine: ['core'], head: null, limbs: [] };
}

// ── Ghost (floating, no legs; a body that tapers into a wisp) ────────────────
// root(floor) → tail(wisp bottom, hovering) + spine(chest) → neck → head;
// spine → shoulderL/R → handL/R (drifting arms, no elbows). The hover/bob comes
// from the 'spectral' presence overlay, the reach from the telegraph — no gait.
function ghostSkeleton(p: Proportions): SkeletonDef {
  const tailY = p.height * 0.22;                 // wisp trails to here (above floor)
  const chestY = p.height * 0.60;
  const neckY = chestY + p.height * 0.16;
  const headY = neckY + p.headSize;
  const shX = p.girth * 0.9;
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'tail', parent: 'root', abs: [0, tailY, 0] },
    { name: 'spine', parent: 'root', abs: [0, chestY, 0] },
    { name: 'neck', parent: 'spine', abs: [0, neckY, p.hunch * 0.3] },
    { name: 'head', parent: 'neck', abs: [0, headY, -p.hunch] },
    { name: 'shoulderL', parent: 'spine', abs: [-shX, chestY + p.height * 0.05, 0] },
    { name: 'shoulderR', parent: 'spine', abs: [shX, chestY + p.height * 0.05, 0] },
    { name: 'handL', parent: 'shoulderL', abs: [-shX * 1.4, chestY - p.armLength * 0.55, -0.12] },
    { name: 'handR', parent: 'shoulderR', abs: [shX * 1.4, chestY - p.armLength * 0.55, -0.12] },
  ];
  return {
    joints: j, root: 'root',
    spine: ['tail', 'spine', 'head'],   // body capsule spans wisp → head
    head: 'head',
    limbs: [['shoulderL', 'handL'], ['shoulderR', 'handR']],
  };
}

export const SKELETONS: Record<Archetype, SkeletonFn> = {
  biped: bipedSkeleton,
  quadruped: quadrupedSkeleton,
  blob: blobSkeleton,
  ghost: ghostSkeleton,
};
