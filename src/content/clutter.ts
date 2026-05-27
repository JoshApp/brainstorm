import type { ModelSpec } from '../ecs/model-types';

// Clutter models — small floor / wall decoration that ages a room.
// Used by the level/clutter.ts scatter pass to break up the
// monotony of clean tile-rendered floors and uniform wall planes.
//
// Each entry is a ModelSpec placed via the standard `{ kind:
// 'model', model: X, x, y, z, rotY }` prop. No collision, no
// behavior — purely visual. Geometry kept TINY (few primitives
// per spec) so scattering 20-40 across a floor stays cheap.
//
// Authoring rules:
//   - Materials should be DULL (high roughness, low/no emissive)
//     so clutter recedes visually and the eye still reads the
//     atmospheric lights as the focal points.
//   - Heights stay low (≤ 0.25m typical) — these are AT FOOT
//     LEVEL, not chest-high.
//   - Avoid additive / glowing materials. The wall cracks have a
//     faint emissive only to hint at the moonlight beyond.

// ── Floor debris ──────────────────────────────────────────────────

// Small chunk of broken stone. Rotate randomly when placing for
// per-instance variety despite the shared mesh.
export const RUBBLE_CHUNK: ModelSpec = {
  id: 'rubble-chunk',
  materials: {
    stone: { color: 0x3a342c, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [0,     0.06, 0],     size: [0.22, 0.12, 0.20], mat: 'stone' },
    { kind: 'box', pos: [0.13,  0.04, 0.07],  size: [0.12, 0.07, 0.10], rot: [0, 0.4, 0],  mat: 'stone' },
    { kind: 'box', pos: [-0.10, 0.03, -0.06], size: [0.09, 0.06, 0.08], rot: [0, -0.7, 0], mat: 'stone' },
  ],
};

// Coarse pile of bone fragments — femurs and ribs jumbled. Sits
// flatter than rubble (the bones lie sideways).
export const BONE_PILE: ModelSpec = {
  id: 'bone-pile',
  materials: {
    bone: { color: 0x7a7060, roughness: 0.9, flatShading: true },
  },
  parts: [
    { kind: 'capsule', pos: [0,     0.04, 0],    radius: 0.025, height: 0.22, rot: [0,  0.3, Math.PI / 2], mat: 'bone' },
    { kind: 'capsule', pos: [0.06,  0.04, 0.05], radius: 0.022, height: 0.18, rot: [0, -0.5, Math.PI / 2], mat: 'bone' },
    { kind: 'capsule', pos: [-0.04, 0.04, 0.08], radius: 0.020, height: 0.14, rot: [0,  1.1, Math.PI / 2], mat: 'bone' },
    { kind: 'sphere',  pos: [-0.10, 0.04, -0.06], radius: 0.045, mat: 'bone' },
  ],
};

// Drift of dust / sand — a flat low decal in dust colour. Sits
// almost flush with the floor; used in corners to imply settled
// debris.
export const SAND_DRIFT: ModelSpec = {
  id: 'sand-drift',
  materials: {},
  parts: [
    {
      kind: 'decal',
      pos: [0, 0.008, 0],
      rot: [-Math.PI / 2, 0, 0],
      size: [0.85, 0.55],
      texture: 'fire-wisp',
      color: 0x4a3f30,
    },
  ],
};

// Splintered wooden plank set — the remains of a busted crate or
// door. Two long pieces + a couple of shorter chips.
export const BROKEN_PLANKS: ModelSpec = {
  id: 'broken-planks',
  materials: {
    wood: { color: 0x2a1d12, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [0,     0.025, 0],     size: [0.38, 0.05, 0.08], rot: [0,  0.15, 0], mat: 'wood' },
    { kind: 'box', pos: [0.04,  0.025, 0.10],  size: [0.30, 0.04, 0.06], rot: [0, -0.3,  0], mat: 'wood' },
    { kind: 'box', pos: [-0.08, 0.020, -0.10], size: [0.16, 0.04, 0.05], rot: [0,  0.9,  0], mat: 'wood' },
  ],
};

// Ash mound — a low dark cone with a darker base decal. The
// remains of something burned where it stood.
export const ASH_MOUND: ModelSpec = {
  id: 'ash-mound',
  materials: {
    ash: { color: 0x18120e, roughness: 1.0, flatShading: true },
  },
  parts: [
    {
      kind: 'decal',
      pos: [0, 0.005, 0],
      rot: [-Math.PI / 2, 0, 0],
      size: [0.6, 0.6],
      texture: 'fire-wisp',
      color: 0x0a0805,
    },
    { kind: 'cone', pos: [0, 0.05, 0], radius: 0.16, height: 0.10, segments: 8, mat: 'ash' },
  ],
};

// Scattered shards — sharp, irregular fragments. Reads as broken
// pottery / tile / glass even without textures.
export const STONE_SHARDS: ModelSpec = {
  id: 'stone-shards',
  materials: {
    shard: { color: 0x504438, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [0,    0.012, 0],    size: [0.10, 0.025, 0.06], rot: [0,  0.3, 0], mat: 'shard' },
    { kind: 'box', pos: [0.08, 0.012, 0.04], size: [0.08, 0.02,  0.05], rot: [0, -0.6, 0], mat: 'shard' },
    { kind: 'box', pos: [-0.06, 0.012, 0.07], size: [0.06, 0.02, 0.04], rot: [0,  1.4, 0], mat: 'shard' },
    { kind: 'box', pos: [0.04, 0.012, -0.06], size: [0.05, 0.02, 0.04], rot: [0, -1.2, 0], mat: 'shard' },
  ],
};

// ── Floor cracks ──────────────────────────────────────────────────

// Hairline crack — a few dark thin slivers laid into the floor.
// Lifted slightly to avoid z-fighting with the floor mesh.
export const FLOOR_CRACK: ModelSpec = {
  id: 'floor-crack',
  materials: {
    crack: { color: 0x000000, emissive: 0x100804, emissiveIntensity: 0.6, roughness: 1.0 },
  },
  parts: [
    { kind: 'box', pos: [0,     0.011, 0],     size: [0.42, 0.008, 0.025], mat: 'crack' },
    { kind: 'box', pos: [0.15,  0.011, 0.06],  size: [0.22, 0.008, 0.020], rot: [0,  0.3, 0], mat: 'crack' },
    { kind: 'box', pos: [-0.13, 0.011, -0.05], size: [0.16, 0.008, 0.018], rot: [0, -0.5, 0], mat: 'crack' },
  ],
};

// ── Wall damage ──────────────────────────────────────────────────
// Wall props are placed at y≈1.2m, flush against a wall plane. The
// `model` PropSpec entry's rotY is set by the placer so the damage
// faces INTO the room.

// Dark scorched patch on a wall — a faint emissive smudge with a
// charred edge.
export const WALL_SCORCH: ModelSpec = {
  id: 'wall-scorch',
  materials: {},
  parts: [
    {
      kind: 'decal',
      pos: [0, 0, 0.01],
      size: [0.85, 0.95],
      texture: 'fire-wisp',
      color: 0x0a0604,
      emissive: 0x261005,
      emissiveIntensity: 0.35,
    },
  ],
};

// Gouge / missing-stone patch — three small chip meshes punched out
// of a wall surface. Gives the wall plane some 3D break.
export const WALL_GOUGE: ModelSpec = {
  id: 'wall-gouge',
  materials: {
    chip: { color: 0x14100c, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [0,     0,    0.025], size: [0.18, 0.16, 0.04], mat: 'chip' },
    { kind: 'box', pos: [0.10,  0.08, 0.020], size: [0.10, 0.08, 0.03], rot: [0, 0,  0.3], mat: 'chip' },
    { kind: 'box', pos: [-0.07, -0.06, 0.020], size: [0.08, 0.06, 0.03], rot: [0, 0, -0.5], mat: 'chip' },
  ],
};
