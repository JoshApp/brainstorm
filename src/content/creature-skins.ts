import type { SkinPart } from './creature-types';

// Shared skin builders — author a whole humanoid in a couple of lines, then add
// its distinguishing parts (a weapon, a skull, a robe). The base hangs the
// standard biped pieces on the biped skeleton's joints; proportions (set on the
// CreatureSpec) + materials + the extras make each enemy read distinct. This is
// the content/LLM-layer convenience: a new humanoid is mostly "pick materials".

export interface HumanoidSkinOpts {
  /** Torso/head material. */
  body: string;
  /** Eye material (two glowing spheres on the head front). */
  eye: string;
  /** Limb material (arms/legs/feet) — defaults to `body`. */
  limb?: string;
  bodyRadius?: number;   // torso capsule radius (default 0.17)
  bodyHeight?: number;   // torso capsule cylinder height (default 0.4)
  headRadius?: number;   // default 0.16
  limbRadius?: number;   // upper-limb radius (default 0.06)
  eyeR?: number;         // eye radius (default 0.04)
  eyeSpread?: number;    // half the gap between eyes (default 0.07)
  eyeY?: number;         // eye height on the head (default 0)
  jitter?: number;       // gnarl amplitude on flesh/bone parts (default 0)
  /**
   * Sphere segment counts [width, height] for head + shoulders. Omit for the
   * smooth default (12x10). Pass something small — [5,4] — for FACETS: a
   * handful of big flat planes instead of a ball, so the lamp gives the form a
   * lit side, a shadow side and a hard terminator between them. That is where
   * the flat-shaded look actually comes from; a smooth sphere with jitter on it
   * is just a wobbly ball, which is what most of this roster has been.
   * Opt-in so existing creatures are untouched until they are reworked.
   */
  facets?: [number, number];
}

/** The standard biped body: torso + pelvis, head + two eyes, shoulder lumps,
 *  arm + leg bones, feet. Returns SkinPart[] to spread into a CreatureSpec.skin. */
export function humanoidBipedSkin(o: HumanoidSkinOpts): SkinPart[] {
  const limb = o.limb ?? o.body;
  const jit = o.jitter ?? 0;
  const lr = o.limbRadius ?? 0.06;
  const hr = o.headRadius ?? 0.16;
  const eR = o.eyeR ?? 0.04;
  const eS = o.eyeSpread ?? 0.07;
  const eY = o.eyeY ?? 0;
  const eZ = -hr * 0.9;
  const seg = o.facets;
  return [
    { kind: 'capsule', joint: 'spine', radius: o.bodyRadius ?? 0.17, height: o.bodyHeight ?? 0.4, jitter: jit, mat: o.body },
    { kind: 'box', joint: 'pelvis', size: [0.32, 0.28, 0.24], jitter: jit, mat: o.body },
    { kind: 'sphere', joint: 'head', radius: hr, segments: seg, jitter: jit, mat: o.body },
    { kind: 'sphere', joint: 'head', radius: eR, pos: [-eS, eY, eZ], mat: o.eye },
    { kind: 'sphere', joint: 'head', radius: eR, pos: [eS, eY, eZ], mat: o.eye },
    { kind: 'sphere', joint: 'shoulderL', radius: 0.09, segments: seg, jitter: jit, mat: o.body },
    { kind: 'sphere', joint: 'shoulderR', radius: 0.09, segments: seg, jitter: jit, mat: o.body },
    { kind: 'bone', from: 'shoulderL', to: 'elbowL', radius: lr, mat: limb },
    { kind: 'bone', from: 'elbowL', to: 'handL', radius: lr * 0.85, mat: limb },
    { kind: 'bone', from: 'shoulderR', to: 'elbowR', radius: lr, mat: limb },
    { kind: 'bone', from: 'elbowR', to: 'handR', radius: lr * 0.85, mat: limb },
    { kind: 'bone', from: 'hipL', to: 'kneeL', radius: lr * 1.15, mat: limb },
    { kind: 'bone', from: 'kneeL', to: 'footL', radius: lr, mat: limb },
    { kind: 'bone', from: 'hipR', to: 'kneeR', radius: lr * 1.15, mat: limb },
    { kind: 'bone', from: 'kneeR', to: 'footR', radius: lr, mat: limb },
    { kind: 'box', joint: 'footL', size: [0.11, 0.07, 0.22], pos: [0, 0.04, -0.04], jitter: jit, mat: limb },
    { kind: 'box', joint: 'footR', size: [0.11, 0.07, 0.22], pos: [0, 0.04, -0.04], jitter: jit, mat: limb },
    // HANDS. There were none — the arm bones ran to the handL/handR joints and
    // simply stopped, so every humanoid ended in a tapered stick and anything
    // it "held" floated at the tip with nothing around it. Reported from the
    // phone as the skirmisher gripping its sword weirdly; the sword was fine,
    // there was just no hand. Feet were built from the start, which is probably
    // why nobody noticed the other end.
    //
    // A blocky fist rather than a sphere: it wants to read as a CLOSED grip at
    // this size, and a small sphere on a tapered limb reads as a knob.
    { kind: 'box', joint: 'handL', size: [lr * 1.9, lr * 2.1, lr * 1.7], pos: [0, -lr * 0.5, 0], jitter: jit, mat: limb },
    { kind: 'box', joint: 'handR', size: [lr * 1.9, lr * 2.1, lr * 1.7], pos: [0, -lr * 0.5, 0], jitter: jit, mat: limb },
  ];
}
