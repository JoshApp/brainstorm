import type { ModelSpec, PartSpec, Vec2 } from '../ecs/model-types';
import type { CorpsePose } from './corpses';

// A FALLEN DELVER — a hooded, robed corpse authored as a posed ModelSpec. The
// SILHOUETTE is the draped robe (a lathe-revolved bell that flares at the hem)
// + a peaked hood; skeletal hands and shins/feet poke out for the grim detail.
// It's a still frame, so the slump is baked into the geometry — no animation.
//
// Canonical frame: built facing +X, on the floor (y up, floor at y≈0). The
// caller's group.rotation.y aims it; placement backs the SEATED pose to a wall.
// Capsule/bone long axis is local +Y, so a bone lying along X is rot:[0,0,π/2]
// (the viewmodel-rotation convention).
//
// Iterate in the bench:  delve bench model-corpse-slumped --ortho --debug
//
// Failure-modes guarded (per CLAUDE.md): material variety (rag / rag2 / bone /
// leather / a metal buckle catch-light) so the body doesn't collapse to one
// grey mass; jitter on organic parts so primitives don't read too clean.

export type CorpseDecay = 'fleshy' | 'skeletal';

const MATERIALS = {
  flesh:   { color: 0x4a3a2c, roughness: 0.92, metalness: 0.0, flatShading: true as const },
  bone:    { color: 0xc3b79a, roughness: 0.6,  metalness: 0.0, flatShading: true as const, chroma: 1.3 },
  // The robe — two close tones so folds read. Cold near-black brown.
  rag:     { color: 0x1a1712, roughness: 1.0,  metalness: 0.0, flatShading: true as const },
  rag2:    { color: 0x272018, roughness: 1.0,  metalness: 0.0, flatShading: true as const },
  leather: { color: 0x2f261b, roughness: 0.85, metalness: 0.0, flatShading: true as const },
  metal:   { color: 0x6b6356, roughness: 0.42, metalness: 0.7,  flatShading: true as const },
  socket:  { color: 0x060504, roughness: 1.0,  metalness: 0.0 },
};

const HALF_PI = Math.PI / 2;

// A robe profile (lathe [r,y] points): flares at the hem, narrows to the
// shoulders, closes at the neck. `hem` scales the floor spread, `top` the
// shoulder height.
function robeProfile(hem: number, top: number): Vec2[] {
  return [
    [0.00, 0.0],
    [hem * 0.86, 0.015],
    [hem, 0.05],            // hem flare
    [hem * 0.92, 0.14],
    [hem * 0.74, top * 0.5],
    [hem * 0.55, top * 0.82],
    [hem * 0.42, top],       // shoulders
    [hem * 0.26, top + 0.05],
    [0.0, top + 0.06],       // close at the neck
  ];
}

/** A skeletal hand — a flat palm + three curled finger bones. `yaw` aims the
 *  fingers in the XZ plane. Small; reads as bone resting, not a live grip. */
function boneHand(name: string, [x, y, z]: [number, number, number], yaw: number): PartSpec[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const parts: PartSpec[] = [
    { kind: 'sphere', name: `${name}_palm`, pos: [x, y, z], scale: [1, 0.45, 0.85], radius: 0.05, mat: 'bone', jitter: 0.006 },
  ];
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 0.028;
    parts.push({
      kind: 'capsule', name: `${name}_f${i}`,
      pos: [x + c * 0.05, y - 0.012, z + s * 0.05 + off],
      rot: [0, yaw, HALF_PI], radius: 0.011, height: 0.055, mat: 'bone',
    });
  }
  return parts;
}

/** A skeletal leg lying along the floor — a shin bone + a boot/foot at the end.
 *  `yaw` splays it; `len` is the shin length. */
function boneLeg(name: string, [x, y, z]: [number, number, number], yaw: number, len: number): PartSpec[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ex = x + c * len, ez = z + s * len;
  return [
    { kind: 'capsule', name: `${name}_shin`, pos: [x + c * len * 0.5, y, z + s * len * 0.5], rot: [0, yaw, HALF_PI], radius: 0.034, height: len * 0.9, mat: 'bone', jitter: 0.006 },
    { kind: 'box', name: `${name}_foot`, pos: [ex + c * 0.04, y - 0.005, ez + s * 0.04], size: [0.12, 0.055, 0.07], rot: [0, yaw, 0], mat: 'leather', jitter: 0.005 },
  ];
}

// Head + hood for a given centre + hood tilt. Skeletal = exposed skull + sockets
// under a fallen-back hood; fleshy = a cowl drawn fully over a hidden face.
function headHood(skeletal: boolean, hx: number, hy: number, hoodTiltZ: number): PartSpec[] {
  if (skeletal) {
    return [
      { kind: 'sphere', name: 'skull', pos: [hx + 0.02, hy, 0], radius: 0.10, scale: [1, 1.05, 0.92], mat: 'bone', jitter: 0.008 },
      { kind: 'sphere', name: 'socket_r', pos: [hx + 0.08, hy, 0.045], radius: 0.03, mat: 'socket' },
      { kind: 'sphere', name: 'socket_l', pos: [hx + 0.08, hy, -0.045], radius: 0.028, mat: 'socket' },
      { kind: 'sphere', name: 'jaw', pos: [hx + 0.06, hy - 0.075, 0], radius: 0.05, scale: [1, 0.6, 0.85], mat: 'bone', jitter: 0.006 },
      // Hood fallen back off the skull.
      { kind: 'cone', name: 'hood', pos: [hx - 0.10, hy + 0.04, 0], radius: 0.15, height: 0.24, rot: [0, 0, hoodTiltZ - 0.3], mat: 'rag', jitter: 0.02 },
    ];
  }
  return [
    // Bowed head, fully shrouded.
    { kind: 'sphere', name: 'head', pos: [hx, hy, 0], radius: 0.115, mat: 'flesh', jitter: 0.01 },
    // Peaked cowl drawn forward over the face — the iconic hooded read.
    { kind: 'cone', name: 'hood', pos: [hx - 0.04, hy + 0.05, 0], radius: 0.16, height: 0.30, rot: [0, 0, hoodTiltZ], mat: 'rag', jitter: 0.02 },
    { kind: 'sphere', name: 'cowl', pos: [hx - 0.06, hy, 0], scale: [0.85, 1.05, 1.1], radius: 0.15, mat: 'rag2', jitter: 0.02 },
  ];
}

// SEATED — the hero pose. Slumped against a wall: robe pooled, shoulders
// settled, head bowed forward under the hood, skeletal hands in the lap, bone
// legs splayed forward along the floor.
function seated(skeletal: boolean): PartSpec[] {
  return [
    // Robe body — the silhouette. A bell flaring at the floor up to the shoulders,
    // tipped slightly BACK (top toward −X, the wall) so it reads as leaning.
    { kind: 'lathe', name: 'robe', profile: robeProfile(0.34, 0.56), pos: [-0.02, 0.0, 0], rot: [0, 0, 0.12], mat: 'rag', segments: 14, jitter: 0.02 },
    // A shoulder mantle (second tone) over the top so the silhouette breaks.
    { kind: 'lathe', name: 'mantle', profile: robeProfile(0.22, 0.20), pos: [-0.04, 0.40, 0], rot: [0, 0, 0.12], mat: 'rag2', segments: 12, jitter: 0.02 },
    ...headHood(skeletal, 0.10, 0.52, -0.35),
    // Skeletal hands resting in the lap.
    ...boneHand('handR', [0.22, 0.26, 0.11], 0.2),
    ...boneHand('handL', [0.20, 0.26, -0.11], -0.2),
    // Bone legs splayed forward along the floor from under the hem.
    ...boneLeg('legR', [0.20, 0.06, 0.10], 0.18, 0.34),
    ...boneLeg('legL', [0.20, 0.06, -0.10], -0.18, 0.34),
    // Belt buckle catch-light at the waist.
    { kind: 'box', name: 'buckle', pos: [0.18, 0.22, 0], size: [0.05, 0.06, 0.03], mat: 'metal' },
  ];
}

// FALLEN — collapsed on the floor (crawled = pitched forward reaching; curled =
// drawn in on its side). The robe lathe is laid on its side (a draped mound)
// with a skeletal arm + legs emerging.
function fallen(skeletal: boolean, curled: boolean): PartSpec[] {
  const armReach = curled ? 0.2 : 0.55;   // curled tucks the arm; crawled flings it
  return [
    // Robe laid along the floor (the bell on its side, opening toward −X).
    { kind: 'lathe', name: 'robe', profile: robeProfile(0.30, 0.62), pos: [-0.06, 0.18, 0], rot: [0, 0, HALF_PI + (curled ? 0.25 : 0)], mat: 'rag', segments: 14, jitter: 0.02 },
    { kind: 'lathe', name: 'mantle', profile: robeProfile(0.20, 0.24), pos: [0.12, 0.18, 0], rot: [0, 0, HALF_PI], mat: 'rag2', segments: 12, jitter: 0.02 },
    ...headHood(skeletal, 0.40, 0.17, -0.9),
    // One skeletal arm out of the sleeve (reaching for crawled, tucked for curled).
    ...boneHand('handR', [0.30 + armReach * 0.5, 0.08, curled ? 0.18 : 0.14], curled ? 1.2 : 0.1),
    { kind: 'capsule', name: 'armR', pos: [0.30 + armReach * 0.25, 0.09, curled ? 0.16 : 0.13], rot: [0, curled ? 1.0 : 0.1, HALF_PI], radius: 0.03, height: armReach * 0.6, mat: 'bone', jitter: 0.006 },
    // Bone legs trailing back along the floor.
    ...boneLeg('legR', [-0.30, 0.07, 0.10], Math.PI - (curled ? 0.7 : 0.1), 0.30),
    ...boneLeg('legL', [-0.30, 0.07, -0.10], Math.PI + (curled ? 0.7 : 0.1), 0.30),
    { kind: 'box', name: 'buckle', pos: [0.06, 0.14, 0.14], size: [0.05, 0.05, 0.025], mat: 'metal' },
  ];
}

export function makeCorpseModel(
  pose: CorpsePose = 'slumped',
  decay: CorpseDecay = 'fleshy',
  hasLoot = false,
): ModelSpec {
  const skeletal = decay === 'skeletal';

  const body = pose === 'slumped'
    ? seated(skeletal)
    : fallen(skeletal, pose === 'curled');

  const parts: PartSpec[] = [
    // Grime/blood soaked into the floor under the body (a flat stain, not a glow).
    { kind: 'decal', name: 'pool', texture: 'blood-splatter', size: [1.3, 1.0],
      pos: [0.0, 0.012, 0], rot: [-HALF_PI, 0, 0], color: skeletal ? 0x18110b : 0x2c0a07, opacity: 0.8 },
    ...body,
  ];

  // What they died carrying — a leather satchel with a metal catch, set where a
  // hand can reach it. A second, physical loot cue beside the lamp-reactive glint.
  if (hasLoot) {
    const px = pose === 'slumped' ? 0.30 : 0.50;
    const pz = pose === 'slumped' ? 0.0 : 0.26;
    const py = pose === 'slumped' ? 0.10 : 0.07;
    parts.push(
      { kind: 'box', name: 'satchel', pos: [px, py, pz], size: [0.18, 0.14, 0.13], mat: 'leather', jitter: 0.01 },
      { kind: 'box', name: 'satchel_buckle', pos: [px, py + 0.005, pz + 0.07], size: [0.04, 0.03, 0.012], mat: 'metal' },
    );
  }

  return {
    id: `corpse-${pose}-${decay}${hasLoot ? '-loot' : ''}`,
    materials: MATERIALS,
    parts,
  };
}
