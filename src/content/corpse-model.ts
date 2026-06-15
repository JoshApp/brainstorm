import type { ModelSpec, PartSpec } from '../ecs/model-types';
import type { CorpsePose } from './corpses';

// A fallen delver, as a ModelSpec — built parametrically so each body can read
// differently (pose, decay, whether they still carry a pack). Lies along local
// +X with the head toward +X, on the floor (y up), so the caller's group.rotation.y
// still aims it. Capsule long axis is local +Y, so a body part lying along X is
// rot:[0,0,π/2] (see the viewmodel-rotation convention).
//
// Iterate it in the bench:  delve bench model-corpse-crawled --ortho --debug
//
// Failure-modes guarded (per CLAUDE.md): material variety so it doesn't collapse
// to one grey blob (rag / flesh / leather / a metal buckle catch-light / bone);
// jitter on the organic parts so the primitives don't read too clean.

export type CorpseDecay = 'fleshy' | 'skeletal';

const MATERIALS = {
  flesh: { color: 0x4a3a2c, roughness: 0.92, metalness: 0.0, flatShading: true as const },
  bone: { color: 0xb7ab92, roughness: 0.72, metalness: 0.0, flatShading: true as const, chroma: 1.4 },
  rag: { color: 0x1b1611, roughness: 1.0, metalness: 0.0, flatShading: true as const },
  rag2: { color: 0x2a2018, roughness: 1.0, metalness: 0.0, flatShading: true as const },
  leather: { color: 0x33271b, roughness: 0.85, metalness: 0.0, flatShading: true as const },
  metal: { color: 0x6b6356, roughness: 0.45, metalness: 0.65, flatShading: true as const },
  socket: { color: 0x070605, roughness: 1.0, metalness: 0.0 },
};

const HALF_PI = Math.PI / 2;

/** One limb as upper + lower segment + an end cap (hand/boot). `bend` splays the
 *  lower segment off the upper to read as an elbow/knee. */
function limb(
  name: string,
  anchor: [number, number, number],
  dir: number,        // yaw of the limb in the XZ plane (rad), 0 = along +X
  bend: number,       // extra yaw on the lower segment
  rUp: number, rLo: number,
  fleshMat: string,
  endMat: string,
  endR: number,
): PartSpec[] {
  const [ax, ay, az] = anchor;
  const L = 0.26;     // segment length
  const c0 = Math.cos(dir), s0 = Math.sin(dir);
  const elbowX = ax + c0 * L * 0.5, elbowZ = az + s0 * L * 0.5;
  const c1 = Math.cos(dir + bend), s1 = Math.sin(dir + bend);
  const endX = elbowX + c1 * L, endZ = elbowZ + s1 * L;
  return [
    { kind: 'capsule', name: `${name}_up`, pos: [ax, ay, az], rot: [0, dir, HALF_PI], radius: rUp, height: L, mat: fleshMat, jitter: 0.012 },
    { kind: 'capsule', name: `${name}_lo`, pos: [elbowX, ay - 0.01, elbowZ], rot: [0, dir + bend, HALF_PI], radius: rLo, height: L, mat: fleshMat, jitter: 0.012 },
    { kind: 'sphere', name: `${name}_end`, pos: [endX, ay - 0.02, endZ], radius: endR, mat: endMat, jitter: 0.01 },
  ];
}

// Per-pose limb arrangement. Arms reach/tuck/splay; legs trail/curl/splay.
function limbsFor(pose: CorpsePose, fleshMat: string): PartSpec[] {
  if (pose === 'curled') {
    return [
      ...limb('armR', [0.30, 0.15, 0.15], 1.5, 0.7, 0.055, 0.05, fleshMat, fleshMat, 0.05),
      ...limb('armL', [0.28, 0.14, -0.13], -1.5, -0.7, 0.055, 0.05, fleshMat, fleshMat, 0.05),
      ...limb('legR', [-0.20, 0.14, 0.12], 2.4, 1.1, 0.085, 0.07, fleshMat, 'leather', 0.07),
      ...limb('legL', [-0.22, 0.14, -0.12], 3.7, -1.1, 0.085, 0.07, fleshMat, 'leather', 0.07),
    ];
  }
  if (pose === 'slumped') {
    return [
      ...limb('armR', [0.18, 0.12, 0.22], 0.5, 0.3, 0.055, 0.05, fleshMat, fleshMat, 0.05),
      ...limb('armL', [0.05, 0.12, -0.24], -0.5, -0.3, 0.055, 0.05, fleshMat, fleshMat, 0.05),
      ...limb('legR', [-0.40, 0.13, 0.16], Math.PI - 0.5, 0.2, 0.085, 0.07, fleshMat, 'leather', 0.07),
      ...limb('legL', [-0.40, 0.13, -0.16], Math.PI + 0.5, -0.2, 0.085, 0.07, fleshMat, 'leather', 0.07),
    ];
  }
  // crawled (default) — one arm flung forward, legs trailing.
  return [
    ...limb('armR', [0.46, 0.12, 0.16], 0.35, 0.5, 0.058, 0.05, fleshMat, fleshMat, 0.055),
    ...limb('armL', [0.16, 0.11, -0.20], -0.4, -0.3, 0.058, 0.05, fleshMat, fleshMat, 0.055),
    ...limb('legR', [-0.42, 0.13, 0.11], Math.PI - 0.12, 0.1, 0.085, 0.07, fleshMat, 'leather', 0.07),
    ...limb('legL', [-0.42, 0.13, -0.11], Math.PI + 0.12, -0.1, 0.085, 0.07, fleshMat, 'leather', 0.07),
  ];
}

export function makeCorpseModel(
  pose: CorpsePose = 'crawled',
  decay: CorpseDecay = 'fleshy',
  hasLoot = false,
): ModelSpec {
  const skeletal = decay === 'skeletal';
  const fleshMat = skeletal ? 'bone' : 'flesh';

  const parts: PartSpec[] = [
    // Blood/grime pool soaked into the floor under the body (a stain, not a
    // glow — flat on the floor, dark red).
    { kind: 'decal', name: 'pool', texture: 'blood-splatter', size: [1.25, 0.9],
      pos: [-0.08, 0.012, 0], rot: [-HALF_PI, 0, 0], color: skeletal ? 0x1a120c : 0x320b08, opacity: 0.85 },

    // Torso — chest + pelvis, lying along X.
    { kind: 'capsule', name: 'chest', pos: [0.10, 0.17, 0], rot: [0, 0, HALF_PI], radius: 0.17, height: 0.30, mat: fleshMat, jitter: 0.018 },
    { kind: 'capsule', name: 'pelvis', pos: [-0.18, 0.15, 0], rot: [0, 0, HALF_PI], radius: 0.15, height: 0.22, mat: fleshMat, jitter: 0.018 },

    ...limbsFor(pose, fleshMat),

    // A pooled cloak over the back + a second fold (two tones so the silhouette
    // doesn't collapse to one shade).
    { kind: 'sphere', name: 'cloak', pos: [-0.04, 0.25, 0], scale: [0.98, 0.34, 0.82], radius: 0.34, mat: 'rag', jitter: 0.02 },
    { kind: 'sphere', name: 'cloak_fold', pos: [-0.30, 0.22, 0.06], scale: [0.9, 0.3, 0.78], radius: 0.22, mat: 'rag2', jitter: 0.02 },

    // Belt buckle — a small metal catch-light at the waist.
    { kind: 'box', name: 'buckle', pos: [-0.03, 0.17, 0.16], size: [0.05, 0.06, 0.025], mat: 'metal' },
  ];

  // Head + hood, by decay state.
  if (skeletal) {
    parts.push(
      { kind: 'sphere', name: 'skull', pos: [0.49, 0.15, 0.02], radius: 0.12, mat: 'bone', jitter: 0.01 },
      { kind: 'sphere', name: 'socket_r', pos: [0.585, 0.15, 0.05], radius: 0.035, mat: 'socket' },
      { kind: 'sphere', name: 'socket_l', pos: [0.585, 0.16, -0.05], radius: 0.032, mat: 'socket' },
      // The hood fallen back off the skull.
      { kind: 'sphere', name: 'hood', pos: [0.26, 0.20, 0], scale: [0.8, 0.9, 1.0], radius: 0.17, mat: 'rag', jitter: 0.02 },
      // A few exposed ribs.
      { kind: 'torus', name: 'rib1', pos: [0.18, 0.20, 0], rot: [0, 0, HALF_PI], radius: 0.12, tube: 0.012, mat: 'bone' },
      { kind: 'torus', name: 'rib2', pos: [0.05, 0.19, 0], rot: [0, 0, HALF_PI], radius: 0.13, tube: 0.012, mat: 'bone' },
      { kind: 'torus', name: 'rib3', pos: [-0.07, 0.18, 0], rot: [0, 0, HALF_PI], radius: 0.12, tube: 0.012, mat: 'bone' },
    );
  } else {
    parts.push(
      { kind: 'sphere', name: 'head', pos: [0.47, 0.15, 0.03], radius: 0.13, mat: 'flesh', jitter: 0.012 },
      // Cowl drawn over the top/back of the skull — the face is hidden.
      { kind: 'sphere', name: 'hood', pos: [0.40, 0.20, 0], scale: [1.0, 1.0, 1.06], radius: 0.18, mat: 'rag', jitter: 0.02 },
    );
  }

  // What they died carrying — a leather pack by the reaching hand, with a metal
  // catch on it. A second, physical loot cue alongside the lamp-reactive glint.
  if (hasLoot) {
    const px = pose === 'crawled' ? 0.62 : pose === 'curled' ? 0.34 : 0.10;
    const pz = pose === 'slumped' ? 0.30 : 0.34;
    parts.push(
      { kind: 'box', name: 'satchel', pos: [px, 0.08, pz], size: [0.18, 0.14, 0.13], mat: 'leather', jitter: 0.01 },
      { kind: 'box', name: 'satchel_buckle', pos: [px, 0.085, pz + 0.07], size: [0.04, 0.03, 0.012], mat: 'metal' },
    );
  }

  return {
    id: `corpse-${pose}-${decay}${hasLoot ? '-loot' : ''}`,
    materials: MATERIALS,
    parts,
  };
}
