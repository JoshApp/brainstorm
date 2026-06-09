import type { Archetype, Proportions, SkeletonDef, SkeletonFn, JointDef } from './creature-types';
import type { SlotSpec, Vec3 } from '../ecs/model-types';

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
        height, girth: height * 0.7, headSize: height * 0.85,
        armLength: 0, legLength: height * 0.9, neckLength: height * 0.4, hunch: 0,
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
    case 'arachnid':
      return {
        // height = body height off ground; girth = body radius; legLength = leg
        // reach (legs splay well past the body).
        height, girth: height * 1.1, headSize: height * 0.5,
        armLength: 0, legLength: height * 2.2, neckLength: 0, hunch: 0,
      };
    case 'flier':
      return {
        // height = HOVER height (the body floats here). girth doubles as the
        // hit-target radius — kept generous relative to the tiny visible body so
        // a fast swarmer is still catchable by a cleave. armLength = wingspan.
        height, girth: height * 0.09, headSize: height * 0.03,
        armLength: height * 0.14, legLength: 0, neckLength: 0, hunch: 0,
      };
  }
}

const DEFAULT_HEIGHT: Record<Archetype, number> = { biped: 1.6, quadruped: 0.7, blob: 0.7, ghost: 1.7, arachnid: 0.22, flier: 1.55 };

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

// ── Quadruped (HORIZONTAL body, four legs) ───────────────────────────────────
// root(floor) → spine(centre) → chest(front) / hips(back); chest → neck → head;
// chest → frontL/R → footF*; hips → hindL/R → footH*. The body runs front
// (−Z) to back (+Z). `height` = body height off the ground, `legLength` = leg
// drop. The trot gait lives in enemy-animation.ts (front/hind leg slots).
function quadrupedSkeleton(p: Proportions): SkeletonDef {
  const backY = p.legLength;                 // body rides at leg height; feet at y=0
  const half = p.height * 1.0;               // body half-length (front↔back)
  const trackX = p.girth * 0.8;              // leg lateral spread
  const fz = -half * 0.65, hz = half * 0.65; // front / hind leg Z
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'spine', parent: 'root', abs: [0, backY, 0] },
    { name: 'chest', parent: 'spine', abs: [0, backY, fz] },
    { name: 'hips', parent: 'spine', abs: [0, backY, hz] },
    { name: 'neck', parent: 'chest', abs: [0, backY + p.height * 0.35, fz - p.height * 0.4] },
    { name: 'head', parent: 'neck', abs: [0, backY + p.height * 0.45, -half - p.headSize * 0.6] },
    { name: 'frontL', parent: 'chest', abs: [-trackX, backY, fz] },
    { name: 'frontR', parent: 'chest', abs: [trackX, backY, fz] },
    { name: 'footFL', parent: 'frontL', abs: [-trackX, 0, fz] },
    { name: 'footFR', parent: 'frontR', abs: [trackX, 0, fz] },
    { name: 'hindL', parent: 'hips', abs: [-trackX, backY, hz] },
    { name: 'hindR', parent: 'hips', abs: [trackX, backY, hz] },
    { name: 'footHL', parent: 'hindL', abs: [-trackX, 0, hz] },
    { name: 'footHR', parent: 'hindR', abs: [trackX, 0, hz] },
  ];
  return {
    joints: j, root: 'root',
    spine: ['chest', 'spine', 'hips'],   // horizontal body capsule (front→back)
    head: 'head',
    limbs: [['frontL', 'footFL'], ['frontR', 'footFR'], ['hindL', 'footHL'], ['hindR', 'footHR']],
  };
}

// ── Blob (headless; a single core, no limbs) ─────────────────────────────────
// The core sits at height/2 — so a low blob (ooze) uses a small height and a
// floating one (wisp, maw-on-a-stalk lasher) uses a tall height to lift the
// core (and its skin + body zone) off the floor.
function blobSkeleton(p: Proportions): SkeletonDef {
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'core', parent: 'root', abs: [0, p.height * 0.5, 0] },
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

// ── Arachnid (low body + abdomen, eight radiating bent legs) ─────────────────
// root(floor) → body(cephalothorax) → abdomen(rear bulb) + head(eye cluster);
// body → hip{L,R}{0..3} → knee → foot for eight legs. Legs splay outward, knees
// raised above the body (spider stance), feet on the ground. Leg joints are
// named hipL0.. / kneeL0.. / footL0.. so the spider skin's bones reference them.
function arachnidSkeleton(p: Proportions): SkeletonDef {
  const bodyY = p.legLength * 0.45;            // body rides above ground on bent legs
  const bodyHalf = p.girth * 0.55;             // leg attach half-width
  const reach = p.legLength;
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'body', parent: 'root', abs: [0, bodyY, -p.girth * 0.3] },
    { name: 'abdomen', parent: 'body', abs: [0, bodyY + p.girth * 0.12, p.girth * 0.8] },
    { name: 'head', parent: 'body', abs: [0, bodyY + p.girth * 0.05, -p.girth * 0.85] },
  ];
  // Four legs per side, spread front→back, splayed so the set fans out.
  const zRow = [-0.6, -0.2, 0.2, 0.6];
  for (const s of [-1, 1]) {
    const sl = s < 0 ? 'L' : 'R';
    for (let i = 0; i < 4; i++) {
      const z = zRow[i] * p.girth;
      const splay = (i - 1.5) * reach * 0.18;        // front legs forward, back back
      const hip = `hip${sl}${i}`, knee = `knee${sl}${i}`, foot = `foot${sl}${i}`;
      j.push({ name: hip, parent: 'body', abs: [s * bodyHalf, bodyY, z] });
      j.push({ name: knee, parent: hip, abs: [s * (bodyHalf + reach * 0.55), bodyY + reach * 0.42, z + splay] });
      j.push({ name: foot, parent: knee, abs: [s * (bodyHalf + reach * 1.1), 0, z + splay * 2.2] });
    }
  }
  return { joints: j, root: 'root', spine: ['body', 'abdomen'], head: 'head', limbs: [] };
}

// ── Flier (hovering insectoid; thorax + head + wing joints, no legs) ─────────
// root(floor) → core(thorax, hovering at `height`) → head(front) + four wing
// joints (fore/hind L/R). Wings are NOT limbs — they get no auto-hitzone (you
// can't kill a moth by clipping a paper wingtip) but exist as named joints so a
// flap clip can rotate them later. The hover/bob comes from the 'spectral'
// presence overlay. The single body sphere (radius = girth) is the whole
// hittable target; head is null — a 1-HP swarmer is one mass, not a headshot.
function flierSkeleton(p: Proportions): SkeletonDef {
  const coreY = p.height;
  const span = p.armLength;                  // wing attach half-width
  const j: JointDef[] = [
    { name: 'root', abs: [0, 0, 0] },
    { name: 'core', parent: 'root', abs: [0, coreY, 0] },
    // Fore + hind wing pairs. Authored at the attach point so a flap clip can
    // rotate wing{L,R}{,2} about it; the skin parents to these.
    { name: 'wingL', parent: 'core', abs: [-span * 0.4, coreY + p.girth * 0.3, 0.0] },
    { name: 'wingR', parent: 'core', abs: [span * 0.4, coreY + p.girth * 0.3, 0.0] },
    { name: 'wingL2', parent: 'core', abs: [-span * 0.34, coreY, p.girth * 0.6] },
    { name: 'wingR2', parent: 'core', abs: [span * 0.34, coreY, p.girth * 0.6] },
  ];
  return { joints: j, root: 'root', spine: ['core'], head: null, limbs: [] };
}

/** Build a SkeletonDef from a ModelSpec's parent-local `slots` — the escape
 *  hatch for a bespoke rig (e.g. the Marrow Sovereign) that wants the creature
 *  pipeline without being reproportioned into an archetype. Walks each slot's
 *  parent chain to recover root-frame abs positions (buildCreature compiles them
 *  straight back to the same parent-local slots, so geometry is byte-identical).
 *  `meta` names the spine/head/limb chains for the auto hurtbox — leave them
 *  empty to author every zone explicitly. */
export function skeletonFromSlots(
  slots: Record<string, SlotSpec>,
  meta: { root: string; spine: string[]; head: string | null; limbs?: string[][] },
): SkeletonDef {
  const absByName = new Map<string, Vec3>();
  const resolve = (name: string): Vec3 => {
    const cached = absByName.get(name);
    if (cached) return cached;
    const s = slots[name];
    const local = s?.pos ?? [0, 0, 0];
    const pa = s?.parent ? resolve(s.parent) : [0, 0, 0];
    const abs: Vec3 = [local[0] + pa[0], local[1] + pa[1], local[2] + pa[2]];
    absByName.set(name, abs);
    return abs;
  };
  const joints: JointDef[] = Object.keys(slots).map((name) => ({
    name, parent: slots[name].parent, abs: resolve(name), rot: slots[name].rot,
  }));
  return { joints, root: meta.root, spine: meta.spine, head: meta.head, limbs: meta.limbs ?? [] };
}

export const SKELETONS: Record<Archetype, SkeletonFn> = {
  biped: bipedSkeleton,
  quadruped: quadrupedSkeleton,
  blob: blobSkeleton,
  ghost: ghostSkeleton,
  arachnid: arachnidSkeleton,
  flier: flierSkeleton,
};
