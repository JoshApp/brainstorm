import type { ModelSpec, PartSpec, SlotSpec, Vec2, Vec3 } from '../ecs/model-types';
import type { CorpsePose } from './corpses';

// A FALLEN DELVER — authored as a real POSED BODY, not a cloth mound. The
// previous version draped a lathe bell on its side and let bones poke out; it
// read as a pile of rocks. What makes a corpse read as a PERSON at PS1
// fidelity is limb topology: two legs that bend at knees, arms that bend at
// elbows, a head on shoulders. So each pose is authored as JOINT POSITIONS
// (slots), and the engine's joint-first `bone` primitive spans them — move a
// joint and every connected limb reflows.
//
// Canonical frame: built facing +X, floor at y≈0. The caller's group
// rotation.y aims it; placement backs the SLUMPED pose to a wall.
//
// Iterate in the bench:  delve bench model-corpse-slumped --ortho --debug
//
// Decay states share one rig:
//   fleshy   — robed and hooded, cloth sleeves over the limbs, dark void
//              under the cowl (no face), ashen hands. Recently dead.
//   skeletal — bone limbs with joint knobs, ribcage on the spine, exposed
//              cranium with buried-socket eyes (the ossuary treatment — the
//              sockets are dark spheres sunk to a sliver so they read as
//              shadowed pits, never as cartoon dot-eyes). Long dead.

export type CorpseDecay = 'fleshy' | 'skeletal';

const MATERIALS = {
  // Ashen dead flesh — cold grey-umber, NOT warm brown (warm read as mud).
  flesh:   { color: 0x8a7d69, roughness: 0.95, metalness: 0.0, flatShading: true as const },
  // Mirrors ossuary PALE_BONE exactly so the whole bone family shares one
  // warmed pipeline and matches the skeleton roster's look.
  bone:    { color: 0xc2b69c, roughness: 0.92, flatShading: 'auto' as const, chroma: 1.8 },
  // The robe — two close cold tones so folds read without a highlight. Dark
  // but NOT light-proof: the lamp must be able to reveal the mass (dread-light
  // rule — near-black albedo makes the body undiscoverable in a dark room).
  rag:     { color: 0x2b2318, roughness: 1.0,  metalness: 0.0, flatShading: true as const },
  rag2:    { color: 0x3b2f1f, roughness: 1.0,  metalness: 0.0, flatShading: true as const },
  leather: { color: 0x2f261b, roughness: 0.85, metalness: 0.0, flatShading: true as const },
  metal:   { color: 0x6b6356, roughness: 0.42, metalness: 0.7, flatShading: true as const },
  // Buried-cap darkness — hood interiors, eye sockets, the nasal slit.
  void:    { color: 0x050403, roughness: 1.0,  metalness: 0.0 },
};

const HALF_PI = Math.PI / 2;

// ── Small vector helpers (poses are authored as points, not Eulers) ────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Euler [rx, 0, rz] that points a part's local +Y (capsule/cone axis) along
 *  unit direction d. Solved, not guessed: with XYZ order the +Y axis maps to
 *  (−sin rz, cos rz·cos rx, cos rz·sin rx). */
function yAxisTo(d: Vec3): Vec3 {
  const rz = Math.asin(Math.max(-1, Math.min(1, -d[0])));
  const rx = Math.atan2(d[2], d[1]);
  return [rx, 0, rz];
}

/** Euler [rx, ry, 0] that points a part's local +Z (torus hole axis) along
 *  unit direction d — used to ring ribs around the spine. */
function zAxisTo(d: Vec3): Vec3 {
  const ry = Math.asin(Math.max(-1, Math.min(1, d[0])));
  const rx = Math.atan2(-d[1], d[2]);
  return [rx, ry, 0];
}

// ── The rig: joints per pose ────────────────────────────────────────────────
// Anatomy at rest (m): upper arm ~0.25, forearm ~0.23, thigh ~0.32,
// shin ~0.29, shoulder half-width 0.16, spine 0.30. Poses keep limb lengths
// near these so the body reads as a person, crumpled.

interface CorpseRig {
  joints: {
    pelvis: Vec3; chest: Vec3; head: Vec3;
    shL: Vec3; elL: Vec3; wrL: Vec3;
    shR: Vec3; elR: Vec3; wrR: Vec3;
    hipL: Vec3; kneeL: Vec3; ankL: Vec3; toeL: Vec3;
    hipR: Vec3; kneeR: Vec3; ankR: Vec3; toeR: Vec3;
  };
  /** Unit-ish direction the face points (hood opening / socket side). */
  face: Vec3;
  /** Ragged spilled-cloth outline laid flat on the floor (shape-local XY,
   *  +Y maps to world −Z), centred at drapePos. */
  drape: Vec2[];
  drapePos: Vec3;
  /** Where the satchel rests, near a hand. */
  satchel: Vec3;
  /** Which wrist the loot glint marks (the hand worth searching). */
  glintAt: 'wrL' | 'wrR';
}

// SEATED against a wall (wall at −X). The Dark Souls hollow: back settled
// against the stone, head dropped to the chest, one leg extended, one knee
// fallen outward, one hand open on the floor and one dead in the lap.
const SLUMPED: CorpseRig = {
  joints: {
    pelvis: [-0.02, 0.14, 0], chest: [-0.10, 0.44, 0], head: [0.01, 0.57, 0.05],
    shL: [-0.08, 0.50, -0.16], elL: [0.00, 0.26, -0.20], wrL: [0.14, 0.05, -0.22],
    shR: [-0.08, 0.50, 0.16], elR: [0.02, 0.26, 0.21], wrR: [0.20, 0.13, 0.07],
    hipL: [0.00, 0.13, -0.09], kneeL: [0.32, 0.13, -0.13], ankL: [0.60, 0.07, -0.15], toeL: [0.68, 0.14, -0.15],
    hipR: [0.00, 0.13, 0.09], kneeR: [0.26, 0.24, 0.17], ankR: [0.34, 0.05, 0.34], toeR: [0.44, 0.08, 0.37],
  },
  face: norm([0.7, -0.65, 0.2]),
  drape: [
    [-0.30, 0.26], [-0.36, 0.02], [-0.28, -0.24], [-0.10, -0.34], [0.12, -0.30],
    [0.30, -0.20], [0.38, 0.02], [0.30, 0.22], [0.10, 0.32], [-0.12, 0.34],
  ],
  drapePos: [0.04, 0, 0],
  satchel: [0.14, 0.07, 0.30],
  glintAt: 'wrR',
};

// PRONE, dragged toward +X and died mid-reach: chest on the stone, one arm
// flung ahead, the other bent beside the ribs, face down, legs trailing —
// one knee still cocked from the last crawl.
const CRAWLED: CorpseRig = {
  joints: {
    pelvis: [-0.28, 0.11, 0], chest: [0.02, 0.10, 0.02], head: [0.22, 0.09, 0.05],
    shL: [0.02, 0.11, -0.15], elL: [-0.06, 0.06, -0.25], wrL: [0.14, 0.035, -0.22],
    shR: [0.02, 0.11, 0.16], elR: [0.26, 0.06, 0.22], wrR: [0.48, 0.035, 0.18],
    hipL: [-0.28, 0.10, -0.08], kneeL: [-0.58, 0.07, -0.12], ankL: [-0.85, 0.05, -0.14], toeL: [-0.93, 0.03, -0.15],
    hipR: [-0.28, 0.10, 0.08], kneeR: [-0.52, 0.07, 0.15], ankR: [-0.64, 0.05, 0.35], toeR: [-0.72, 0.03, 0.40],
  },
  face: norm([0.45, -0.85, 0.12]),
  drape: [
    [-0.62, 0.20], [-0.70, 0.00], [-0.60, -0.22], [-0.34, -0.28], [-0.06, -0.24],
    [0.18, -0.26], [0.30, -0.08], [0.26, 0.14], [0.04, 0.26], [-0.30, 0.30],
  ],
  drapePos: [-0.16, 0, 0],
  satchel: [0.30, 0.07, -0.28],
  glintAt: 'wrR',
};

// FETAL on the right side, head toward +X: knees drawn up in front of the
// belly, ankles tucked back, arms folded in with the hands near the face,
// chin down. "Curled here, as if asleep. Not asleep."
const CURLED: CorpseRig = {
  joints: {
    pelvis: [-0.22, 0.13, 0.00], chest: [0.04, 0.15, -0.03], head: [0.24, 0.13, 0.05],
    shL: [0.02, 0.25, -0.08], elL: [0.16, 0.17, 0.08], wrL: [0.30, 0.10, 0.14],
    shR: [0.06, 0.08, 0.02], elR: [0.24, 0.06, 0.16], wrR: [0.38, 0.05, 0.10],
    hipL: [-0.24, 0.21, -0.03], kneeL: [0.02, 0.20, 0.20], ankL: [-0.20, 0.16, 0.34], toeL: [-0.28, 0.13, 0.38],
    hipR: [-0.20, 0.09, 0.05], kneeR: [0.06, 0.09, 0.26], ankR: [-0.16, 0.07, 0.38], toeR: [-0.24, 0.05, 0.42],
  },
  face: norm([0.6, -0.4, 0.55]),
  drape: [
    [-0.40, 0.22], [-0.46, -0.02], [-0.36, -0.24], [-0.12, -0.32], [0.14, -0.28],
    [0.34, -0.14], [0.40, 0.08], [0.28, 0.26], [0.02, 0.34], [-0.24, 0.30],
  ],
  drapePos: [0.00, 0, 0.10],
  satchel: [0.20, 0.07, 0.36],
  glintAt: 'wrR',
};

const RIGS: Record<CorpsePose, CorpseRig> = {
  slumped: SLUMPED,
  crawled: CRAWLED,
  curled: CURLED,
};

// ── Assembly ────────────────────────────────────────────────────────────────

/** A hand at a wrist: flattened palm + four finger capsules curling toward
 *  the floor, fanned around the forearm's direction. Bone or ashen flesh. */
function handAt(name: string, wrist: Vec3, forearmDir: Vec3, mat: string): PartSpec[] {
  // Fingers continue the forearm's floor-plane heading, then curl down.
  const flat = norm([forearmDir[0], 0, forearmDir[2]]);
  const yaw = Math.atan2(flat[2], flat[0]);
  const palmC = add(wrist, scale(flat, 0.045));
  const parts: PartSpec[] = [
    { kind: 'sphere', name: `${name}_palm`, pos: palmC, scale: [1, 0.5, 0.85], radius: 0.042, mat, jitter: 0.005 },
  ];
  for (let i = 0; i < 4; i++) {
    const spread = (i - 1.5) * 0.22;
    const fdir = norm([Math.cos(yaw + spread), -0.7, Math.sin(yaw + spread)]);
    parts.push({
      kind: 'capsule', name: `${name}_f${i}`,
      pos: add(add(palmC, scale(flat, 0.03)), scale(fdir, 0.032)),
      rot: yAxisTo(fdir), radius: 0.0095, height: 0.045, mat,
    });
  }
  return parts;
}

/** Fleshy head: cowl sphere with a void-dark cap buried at the face (a hood
 *  with no face in it) + the peaked hood leaning back off the brow. */
function hoodedHead(H: Vec3, face: Vec3): PartSpec[] {
  // The hood is a low cone DROOPED down the back of the head — apex sagging
  // backward, sunk deep into the cowl. Tall/upright cones read as a witch's
  // hat spike; a dead hood has no starch left in it.
  const back = norm([-face[0], 0, -face[2]]);
  const droop = norm([back[0] * 0.95, 0.5, back[2] * 0.95]);
  return [
    { kind: 'sphere', name: 'cowl', pos: H, radius: 0.12, scale: [1.02, 1.08, 1.0], mat: 'rag2', jitter: 0.013 },
    // Buried void sphere — only its cap shows inside the hood opening.
    { kind: 'sphere', name: 'face_void', pos: add(H, scale(face, 0.075)), radius: 0.072, mat: 'void' },
    { kind: 'cone', name: 'hood', pos: add(add(H, scale(back, 0.05)), [0, 0.05, 0]), radius: 0.15, height: 0.17,
      rot: yAxisTo(droop), segments: 9, mat: 'rag', jitter: 0.011 },
  ];
}

/** Skeletal head: the ossuary cranium treatment — pale flattened dome, two
 *  socket pits sunk to a sliver, nasal slit, and a jaw fallen slack. The
 *  hood lies collapsed behind the skull. */
function skullHead(H: Vec3, face: Vec3): PartSpec[] {
  const flat = norm([face[0], 0, face[2]]);
  const yaw = Math.atan2(flat[2], flat[0]);
  return [
    { kind: 'sphere', name: 'cranium', pos: H, radius: 0.095, scale: [1.0, 0.85, 0.92], rot: [0, -yaw, 0], mat: 'bone', jitter: 0.006 },
    // Sockets — buried to a sliver; the dome's own curve shades the pits.
    { kind: 'sphere', name: 'socket_l', pos: add(add(H, scale(face, 0.078)), scale([-flat[2], 0, flat[0]], -0.032)), radius: 0.023, mat: 'void' },
    { kind: 'sphere', name: 'socket_r', pos: add(add(H, scale(face, 0.078)), scale([-flat[2], 0, flat[0]], 0.032)), radius: 0.023, mat: 'void' },
    { kind: 'box', name: 'nasal', pos: add(add(H, scale(face, 0.088)), [0, -0.028, 0]), size: [0.012, 0.02, 0.012], rot: [0, -yaw, 0], mat: 'void' },
    // Jaw slack — detached a hair below the cranium, the dead-mouth gap.
    { kind: 'sphere', name: 'jaw', pos: add(add(H, scale(face, 0.05)), [0, -0.075, 0]), radius: 0.048, scale: [0.9, 0.45, 0.75], rot: [0, -yaw, 0], mat: 'bone', jitter: 0.005 },
    // The hood, emptied — a crumpled cone collapsed behind the skull.
    { kind: 'cone', name: 'hood', pos: add(add(H, scale(flat, -0.14)), [0, 0.02, 0]), radius: 0.14, height: 0.14,
      rot: yAxisTo(norm([-flat[0] * 0.6, 1, -flat[2] * 0.6])), segments: 9, mat: 'rag', jitter: 0.03 },
  ];
}

function assemble(rig: CorpseRig, skeletal: boolean, hasLoot: boolean): { parts: PartSpec[]; slots: Record<string, SlotSpec> } {
  const J = rig.joints;

  // Every joint is a SLOT; bones span them by name.
  const slots: Record<string, SlotSpec> = {};
  for (const [name, pos] of Object.entries(J)) slots[name] = { pos: pos as Vec3 };
  slots['loot_glint'] = { pos: add(J[rig.glintAt], [0, 0.08, 0]) };

  const limbMat = skeletal ? 'bone' : 'rag';   // sleeves cover fleshy limbs
  const shinMat = skeletal ? 'bone' : 'rag2';
  const handMat = skeletal ? 'bone' : 'flesh';
  // Bone limbs are thin shafts; robed limbs are cloth-thick.
  const rArmU = skeletal ? 0.026 : 0.055;
  const rArmL = skeletal ? 0.022 : 0.045;
  const rLegU = skeletal ? 0.030 : 0.070;
  const rLegL = skeletal ? 0.026 : 0.050;

  const bone = (name: string, from: keyof typeof J, to: keyof typeof J, radius: number, mat: string, jitter = 0.008): PartSpec =>
    ({ kind: 'bone', name, from, to, radius, mat, jitter });

  const parts: PartSpec[] = [
    // LIMBS — the human read. Two-segment arms and legs between joints.
    bone('upperArmL', 'shL', 'elL', rArmU, limbMat, skeletal ? 0.006 : 0.014),
    bone('forearmL', 'elL', 'wrL', rArmL, limbMat, skeletal ? 0.006 : 0.014),
    bone('upperArmR', 'shR', 'elR', rArmU, limbMat, skeletal ? 0.006 : 0.014),
    bone('forearmR', 'elR', 'wrR', rArmL, limbMat, skeletal ? 0.006 : 0.014),
    bone('thighL', 'hipL', 'kneeL', rLegU, limbMat, skeletal ? 0.006 : 0.016),
    bone('shinL', 'kneeL', 'ankL', rLegL, shinMat, 0.008),
    bone('thighR', 'hipR', 'kneeR', rLegU, limbMat, skeletal ? 0.006 : 0.016),
    bone('shinR', 'kneeR', 'ankR', rLegL, shinMat, 0.008),
    // Feet — short segments past the ankles (boots when fleshy, bone when not).
    bone('footL', 'ankL', 'toeL', skeletal ? 0.022 : 0.042, skeletal ? 'bone' : 'leather', 0.006),
    bone('footR', 'ankR', 'toeR', skeletal ? 0.022 : 0.042, skeletal ? 'bone' : 'leather', 0.006),
    // Hands, curled where they fell.
    ...handAt('handL', J.wrL, norm(sub(J.wrL, J.elL)), handMat),
    ...handAt('handR', J.wrR, norm(sub(J.wrR, J.elR)), handMat),
    // Head.
    ...(skeletal ? skullHead(J.head, rig.face) : hoodedHead(J.head, rig.face)),
    // Spilled cloth pooled flat on the floor around the body — ragged extrude,
    // heavy jitter so the hem tears differently per instance.
    { kind: 'extrude', name: 'drape', shape: rig.drape, depth: 0.022,
      pos: add(rig.drapePos, [0, 0.004, 0]), rot: [-HALF_PI, 0, 0], mat: 'rag', jitter: 0.03 },
    // Grime/blood soaked into the stone beneath (flat stain, not a glow).
    { kind: 'decal', name: 'pool', texture: 'blood-splatter', size: [1.3, 1.0],
      pos: [0.0, 0.012, 0], rot: [-HALF_PI, 0, 0], color: skeletal ? 0x18110b : 0x2c0a07, opacity: 0.8 },
  ];

  if (skeletal) {
    // TORSO, long dead: bare spine + ribcage rings + a pelvis wedge, the
    // robe rotted to the floor drape alone.
    const spineDir = norm(sub(J.chest, J.pelvis));
    parts.push(bone('spine', 'pelvis', 'chest', 0.022, 'bone', 0.005));
    for (let i = 0; i < 3; i++) {
      const c = lerp(J.pelvis, J.chest, 0.5 + i * 0.22);
      const r = 0.085 - i * 0.008;
      parts.push({ kind: 'torus', name: `rib${i}`, pos: c, radius: r, tube: 0.012,
        rot: zAxisTo(spineDir), scale: [1, 0.85, 1], segments: [8, 10], mat: 'bone', jitter: 0.005 });
    }
    parts.push({ kind: 'sphere', name: 'pelvis_bone', pos: J.pelvis, radius: 0.075, scale: [0.9, 0.6, 1.05], mat: 'bone', jitter: 0.008 });
    // Joint knobs so limbs read as bone meeting bone, not rods.
    for (const j of ['elL', 'elR', 'kneeL', 'kneeR'] as const) {
      parts.push({ kind: 'sphere', name: `knob_${j}`, pos: J[j], radius: 0.032, mat: 'bone', jitter: 0.005 });
    }
  } else {
    // TORSO, robed: chest and hip masses under cloth + a shoulder yoke.
    // Flattened toward the floor so prone poses read collapsed, not inflated.
    parts.push(
      bone('shoulders', 'shL', 'shR', 0.062, 'rag', 0.016),
      { kind: 'sphere', name: 'chest_mass', pos: J.chest, radius: 0.145, scale: [1.0, 0.72, 1.1], mat: 'rag', jitter: 0.02 },
      { kind: 'sphere', name: 'hip_mass', pos: J.pelvis, radius: 0.125, scale: [1.0, 0.68, 1.05], mat: 'rag2', jitter: 0.02 },
      // A belt catching what little light there is.
      { kind: 'box', name: 'buckle', pos: add(lerp(J.pelvis, J.chest, 0.3), scale(rig.face, 0.10)), size: [0.05, 0.05, 0.025], mat: 'metal' },
    );
  }

  // What they died carrying — a leather satchel near a hand, the physical
  // cue beside the lamp-reactive glint.
  if (hasLoot) {
    parts.push(
      { kind: 'box', name: 'satchel', pos: rig.satchel, size: [0.18, 0.13, 0.13], rot: [0.1, 0.4, 0.06], bevel: 0.02, mat: 'leather', jitter: 0.008 },
      { kind: 'box', name: 'satchel_flap', pos: add(rig.satchel, [0, 0.055, 0.02]), size: [0.17, 0.03, 0.12], rot: [0.16, 0.4, 0.06], bevel: 0.012, mat: 'rag2', jitter: 0.006 },
      { kind: 'box', name: 'satchel_buckle', pos: add(rig.satchel, [0, 0.03, 0.075]), size: [0.035, 0.03, 0.012], rot: [0.1, 0.4, 0.06], mat: 'metal' },
    );
  }

  return { parts, slots };
}

export function makeCorpseModel(
  pose: CorpsePose = 'slumped',
  decay: CorpseDecay = 'fleshy',
  hasLoot = false,
): ModelSpec {
  const { parts, slots } = assemble(RIGS[pose], decay === 'skeletal', hasLoot);
  return {
    id: `corpse-${pose}-${decay}${hasLoot ? '-loot' : ''}`,
    materials: MATERIALS,
    parts,
    slots,
  };
}
