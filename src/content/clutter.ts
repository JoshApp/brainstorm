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

// Corner mound — actual volumetric pile of debris/sand that sits
// against a corner. Authored with its HIGH end at local (-,-) and
// sloping out toward local (+,+) so the same model rotates to fit
// the four corners. Jitter on each part gives a natural lumpy
// surface — no two corners look identical.
export const CORNER_MOUND: ModelSpec = {
  id: 'corner-mound',
  materials: {
    silt: { color: 0x382d22, roughness: 1.0, flatShading: true },
  },
  parts: [
    // Wide low base — spans most of the corner footprint.
    { kind: 'box', pos: [-0.15, 0.06, -0.15], size: [0.95, 0.12, 0.95], rot: [0, 0.2, 0], mat: 'silt', jitter: 0.06 },
    // Middle hump — biased toward the corner (more negative x/z).
    { kind: 'box', pos: [-0.32, 0.17, -0.32], size: [0.55, 0.14, 0.55], rot: [0, -0.3, 0], mat: 'silt', jitter: 0.07 },
    // Peak chip against the corner.
    { kind: 'box', pos: [-0.42, 0.27, -0.42], size: [0.28, 0.10, 0.28], rot: [0, 0.6, 0], mat: 'silt', jitter: 0.05 },
    // Faint surface decal so it reads as dust, not just a stack of
    // boxes. Sits on top, slightly oversize so it covers the front
    // slope.
    {
      kind: 'decal',
      pos: [-0.15, 0.123, -0.15],
      rot: [-Math.PI / 2, 0, 0.2],
      size: [1.0, 1.0],
      texture: 'fire-wisp',
      color: 0x251c12,
    },
  ],
};

// Wall pile — a debris mound that sits AGAINST a wall, slumping
// outward into the room. Used along walls to break up the clean
// wall line. Authored with its tall side at local -Z (so when
// placed against a north wall, the pile leans south into the room).
export const WALL_PILE: ModelSpec = {
  id: 'wall-pile',
  materials: {
    pile: { color: 0x2c2418, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [0,    0.10, -0.08], size: [0.80, 0.20, 0.55], rot: [0,  0.1, 0], mat: 'pile', jitter: 0.05 },
    { kind: 'box', pos: [0.1,  0.22, -0.18], size: [0.50, 0.18, 0.30], rot: [0, -0.2, 0], mat: 'pile', jitter: 0.06 },
    { kind: 'box', pos: [-0.18, 0.16, -0.04], size: [0.32, 0.12, 0.22], rot: [0,  0.5, 0], mat: 'pile', jitter: 0.04 },
  ],
};

// Bigger corner mound — same family as CORNER_MOUND but taller and
// wider, dominates the corner. One per chamber max, biased to
// large rooms. Reads as "the corner collapsed in on itself."
export const CORNER_MOUND_LARGE: ModelSpec = {
  id: 'corner-mound-large',
  materials: {
    silt: { color: 0x342a20, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [-0.25, 0.10, -0.25], size: [1.45, 0.20, 1.45], rot: [0,  0.15, 0], mat: 'silt', jitter: 0.08 },
    { kind: 'box', pos: [-0.45, 0.30, -0.45], size: [0.95, 0.22, 0.95], rot: [0, -0.4,  0], mat: 'silt', jitter: 0.09 },
    { kind: 'box', pos: [-0.58, 0.50, -0.58], size: [0.60, 0.20, 0.60], rot: [0,  0.7,  0], mat: 'silt', jitter: 0.07 },
    { kind: 'box', pos: [-0.65, 0.65, -0.65], size: [0.30, 0.12, 0.30], rot: [0, -0.9,  0], mat: 'silt', jitter: 0.05 },
    {
      kind: 'decal',
      pos: [-0.25, 0.21, -0.25],
      rot: [-Math.PI / 2, 0, 0.3],
      size: [1.55, 1.55],
      texture: 'fire-wisp',
      color: 0x1f1810,
    },
  ],
};

// Small corner mound — flatter and rougher, like dust + small
// chunks settled in a corner that nothing big fell into. The
// scatter pass picks between the three sizes per corner.
export const CORNER_MOUND_SMALL: ModelSpec = {
  id: 'corner-mound-small',
  materials: {
    silt: { color: 0x3a2f24, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [-0.10, 0.04, -0.10], size: [0.70, 0.08, 0.70], rot: [0,  0.3, 0], mat: 'silt', jitter: 0.04 },
    { kind: 'box', pos: [-0.22, 0.10, -0.22], size: [0.32, 0.08, 0.32], rot: [0, -0.5, 0], mat: 'silt', jitter: 0.05 },
    {
      kind: 'decal',
      pos: [-0.10, 0.085, -0.10],
      rot: [-Math.PI / 2, 0, 0.1],
      size: [0.85, 0.85],
      texture: 'fire-wisp',
      color: 0x251c12,
    },
  ],
};

// ── Architectural deformers ──────────────────────────────────────
// These are the "break up the rectangle" props. Floor-to-ceiling
// geometry that reads as STRUCTURAL (not debris) — buttresses
// supporting a wall, broken-off columns where a colonnade used
// to be. They cast shadows from torches, which is the real eye-
// catcher: the wall stops being a flat plane and starts having
// pockets of light + dark.

// Wall buttress — a stone column attached to a wall, full height.
// Reads as engineering: the room originally needed structural
// support, the supports are still there even though everything
// else fell. Authored at HEIGHT 3.2m to match the default room
// height; placement code shrinks Y scale per-room as needed.
// Sticks out ~0.55m from its wall, runs 0.85m wide along the wall.
export const WALL_BUTTRESS: ModelSpec = {
  id: 'wall-buttress',
  materials: {
    stone: { color: 0x2a241c, roughness: 1.0, metalness: 0.0, flatShading: true },
  },
  parts: [
    // Main body — slightly inset from floor so the buttress reads
    // as a thicker column with a base; flat on the wall side (local
    // -Z is the wall) and rounded outward.
    { kind: 'box', pos: [0,    1.60, -0.10], size: [0.85, 3.20, 0.55], mat: 'stone' },
    // Capital block at the top — slightly wider, suggests a load-
    // bearing capstone.
    { kind: 'box', pos: [0,    3.05, -0.05], size: [1.00, 0.25, 0.70], mat: 'stone' },
    // Base block — wider at the floor, reinforces "structural."
    { kind: 'box', pos: [0,    0.18, -0.05], size: [1.00, 0.36, 0.70], mat: 'stone' },
    // Vertical groove down the face — single thin box recessed in
    // the front, gives shadow + readability.
    { kind: 'box', pos: [0,    1.60,  0.16], size: [0.10, 2.40, 0.04], mat: 'stone' },
  ],
};

// Fallen pillar segment — a stone cylinder lying horizontally on
// the floor, ~1.5m long × 0.4m thick. Pairs with the RUINED_COLUMN
// stubs (you see a stub plus the piece that fell off lying nearby
// — story in one room). Bigger silhouette than the small debris
// pool, with collision so the player walks around it.
//
// Authored lying along local X (so rotY=0 lies east-west, rotY=π/2
// lies north-south). Slight tilt + jitter on the surface gives a
// "broken stone" feel rather than a clean cylinder.
export const FALLEN_PILLAR_SEGMENT: ModelSpec = {
  id: 'fallen-pillar-segment',
  materials: {
    stone: { color: 0x2c2620, roughness: 1.0, flatShading: true },
  },
  parts: [
    // Main cylinder body, lying on its side. Rotate +90° around
    // Z so the cylinder's local +Y axis (its length) now runs
    // along world +X.
    {
      kind: 'cylinder',
      pos: [0, 0.22, 0],
      radius: 0.22,
      height: 1.50,
      segments: 12,
      rot: [0, 0, Math.PI / 2],
      mat: 'stone',
      jitter: 0.025,
    },
    // Cap on the +X end — a slightly larger broken disc.
    {
      kind: 'cylinder',
      pos: [0.78, 0.22, 0],
      radius: 0.26,
      height: 0.06,
      segments: 12,
      rot: [0, 0, Math.PI / 2],
      mat: 'stone',
      jitter: 0.04,
    },
    // Smaller chunks broken off near each end so the silhouette
    // isn't a clean cylinder.
    { kind: 'box', pos: [-0.62, 0.08, 0.18], size: [0.18, 0.16, 0.20], rot: [0,  0.4, 0.1], mat: 'stone', jitter: 0.04 },
    { kind: 'box', pos: [ 0.55, 0.06, -0.20], size: [0.16, 0.12, 0.18], rot: [0, -0.6, 0],  mat: 'stone', jitter: 0.04 },
  ],
};

// Bent iron grate fragment — a few bars on the floor, slightly
// angled. Matches the iron sconce palette so it reads as "the
// dungeon's iron infrastructure has fallen apart". No collision
// — it's flat enough that the player can step on it.
export const IRON_BARS: ModelSpec = {
  id: 'iron-bars',
  materials: {
    iron: { color: 0x1a1612, roughness: 0.85, metalness: 0.4, flatShading: true },
  },
  parts: [
    { kind: 'cylinder', pos: [0,    0.04,  0.12], radius: 0.025, height: 0.85, segments: 6, rot: [0, 0, Math.PI / 2], mat: 'iron' },
    { kind: 'cylinder', pos: [0.02, 0.04, -0.02], radius: 0.025, height: 0.78, segments: 6, rot: [0, 0.15, Math.PI / 2], mat: 'iron' },
    { kind: 'cylinder', pos: [-0.03, 0.04, -0.16], radius: 0.025, height: 0.72, segments: 6, rot: [0, -0.08, Math.PI / 2], mat: 'iron' },
    // A cross-bar visible at one end.
    { kind: 'cylinder', pos: [0.42, 0.04, -0.04], radius: 0.022, height: 0.30, segments: 6, rot: [Math.PI / 2, 0, 0], mat: 'iron' },
  ],
};

// Ruined column stub — chest-high broken column standing in open
// floor. Reads as the surviving base of a colonnade. Stable cylinder
// with a jagged-box top suggesting a snapped column. Stands ~1.4m
// tall so it's chest-height to a player — visible across the room
// but doesn't block view.
export const RUINED_COLUMN: ModelSpec = {
  id: 'ruined-column',
  materials: {
    stone: { color: 0x2e2820, roughness: 1.0, flatShading: true },
  },
  parts: [
    // Base — wider square plinth.
    { kind: 'box',      pos: [0, 0.12, 0],  size: [0.62, 0.24, 0.62], mat: 'stone' },
    // Shaft — cylinder.
    { kind: 'cylinder', pos: [0, 0.78, 0],  radius: 0.22, height: 1.10, segments: 12, mat: 'stone' },
    // Jagged broken top — three offset chunks. Reads as snap.
    { kind: 'box', pos: [-0.08, 1.36, 0.06], size: [0.28, 0.16, 0.20], rot: [0,  0.4, 0.15], mat: 'stone', jitter: 0.04 },
    { kind: 'box', pos: [ 0.10, 1.30, -0.05], size: [0.22, 0.12, 0.16], rot: [0, -0.7, -0.1], mat: 'stone', jitter: 0.04 },
    { kind: 'box', pos: [ 0.02, 1.42, -0.10], size: [0.16, 0.10, 0.14], rot: [0,  1.2, 0.05], mat: 'stone', jitter: 0.03 },
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

// ── Things in the darkness ────────────────────────────────────────
//
// LURKER — a hunched humanoid silhouette in a corner. Stands ~1.5m
// tall, body almost black so it reads as a void in the room until
// the lantern reaches it. Two pinprick emissive eye-dots a degree
// dimmer than the world's torches — the player notices PRESENCE
// before they notice WHAT. Doesn't move, doesn't react, doesn't
// have AI. The wrongness IS the point: there's a person in your
// dungeon. Or there isn't, and you're imagining it. Either reading
// works.
//
// Authored facing local +Z (toward the camera) so the placer rotates
// it to face INTO the room from the corner it sits in. Eye dots are
// tiny additive spheres so they pop in the bloom without lighting
// anything around them.
export const LURKER: ModelSpec = {
  id: 'lurker',
  materials: {
    // Almost-black with the faintest cool tint so it reads as cloth
    // and not pure black geometry. Roughness 1.0 so it never catches
    // a specular highlight that would reveal it as solid mesh.
    shroud:    { color: 0x0a0c10, roughness: 1.0, flatShading: true },
    // Eye dots — emissive only, no diffuse colour. Dim enough to be
    // mistaken for a stuck pixel until the player is sure.
    eyeglow:   { color: 0x000000, emissive: 0xa86028, emissiveIntensity: 1.6, roughness: 1.0, flatShading: true, fog: false },
  },
  parts: [
    // Hunched torso — slight forward lean (negative rotX) and a tilt
    // (positive rotZ) so it doesn't read as a soldier at attention.
    { kind: 'capsule', pos: [0, 0.65, 0], rot: [-0.18, 0, 0.06], radius: 0.22, height: 0.55, mat: 'shroud' },
    // Bowed head, leaned forward + down past the shoulders.
    { kind: 'sphere',  pos: [0, 1.07, 0.08], radius: 0.16, segments: [10, 8], mat: 'shroud' },
    // Robe skirt — wider base flowing to the floor.
    { kind: 'cone',    pos: [0, 0.20, 0], radius: 0.34, height: 0.42, segments: 10, mat: 'shroud' },
    // Arms wrapped across the body — two short capsules at the chest.
    { kind: 'capsule', pos: [-0.12, 0.74, 0.10], rot: [0, 0, 0.5],  radius: 0.07, height: 0.18, mat: 'shroud' },
    { kind: 'capsule', pos: [ 0.12, 0.74, 0.10], rot: [0, 0, -0.5], radius: 0.07, height: 0.18, mat: 'shroud' },
    // Eye dots — small additive spheres at face height, narrow spacing.
    { kind: 'sphere', pos: [-0.05, 1.08, 0.20], radius: 0.012, segments: [6, 5], mat: 'eyeglow' },
    { kind: 'sphere', pos: [ 0.05, 1.08, 0.20], radius: 0.012, segments: [6, 5], mat: 'eyeglow' },
  ],
};
