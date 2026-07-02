import type { ModelSpec, PartSpec } from '../ecs/model-types';

// ── The PALE prop family — "pale matter is a light-meter" ──────────────
//
// DELVE's signature material direction: bone, chalk, marble, plaster —
// anything pale takes on the ROOM's coloured light, amplified (PAINTED
// reveal mode, same chroma trick as the skeleton mob and the player's
// hands). The dungeon shell stays absorbed-black, signals stay emissive,
// and the pale things BETWEEN them broadcast the room's colour: a
// blood-lit chamber drenches the bone niches crimson while the walls
// stay swallowed.
//
// Discipline (docs/VISUAL-LANGUAGE.md): ABSORBED majority, PAINTED
// accent, EMISSIVE rare. Pale props are the accent — a few per room,
// never the walls.
//
// EVERY pale prop shares this one material config. The colour may vary
// per prop (colours ride vertex attributes, they don't split pipelines)
// but the STRUCTURAL config — roughness/flatShading/chroma — must stay
// identical so the whole family compiles as ONE pipeline, warmed once
// (see warmup-models.ts).

/** Skeleton-bone pale — the reference PALE material (mirrors the
 *  skeleton mob's bone so the family matches the roster's look). */
export const PALE_BONE = {
  color: 0xc2b69c, roughness: 0.92, flatShading: 'auto' as const, chroma: 1.8,
};

/** Aged, greyer bone for depth variation inside a stack — same
 *  structural config as PALE_BONE (one pipeline). */
export const PALE_BONE_AGED = {
  color: 0x9f9480, roughness: 0.92, flatShading: 'auto' as const, chroma: 1.8,
};

// ── Ossuary niches ──────────────────────────────────────────────────────
//
// Floor-standing stone bays stacked with the dead — the walls of the
// deep are furniture for bones. Dark absorbed-stone frame (reads as part
// of the shell), PALE bone fill (takes the room's light). The contrast
// IS the design: the frame disappears, the bones glow with the room's
// intent.
//
// Convention: local −Z is the wall side, +Z faces the room (same as
// WALL_BUTTRESS; placeWallAttached sets rotY). Origin at the floor.
// class 'decor' — material character, no shadow cast, own draw.

const FRAME = { color: 0x322b21, roughness: 1.0, flatShading: true as const };
const VOID_BACK = { color: 0x0a0908, roughness: 1.0, flatShading: true as const };

/** A horizontal long-bone laid across a bay, axis along local X. */
function longBone(x: number, y: number, z: number, len: number, r: number, yaw: number, mat: string): PartSpec {
  return { kind: 'capsule', pos: [x, y, z], radius: r, height: len, rot: [0, yaw, Math.PI / 2], mat };
}

/** A prop CRANIUM — real ossuary rows are jawless skulls: a pale
 *  flattened dome, two sunken dark pits, a nasal slit. No jaw, no
 *  brow geometry — the dome's own curve shades the pits. Positions
 *  below are in the skull's LOCAL frame (footprint on the shelf),
 *  rotated together via a tiny origin group per socket/nasal offset. */
function skull(x: number, y: number, z: number, s: number, yaw: number, pitch: number, mat: string): PartSpec[] {
  // Rotate the feature offsets by yaw so sockets stay on the FACE
  // when the skull turns (pitch is small enough to ignore for the
  // toppled one — it reads as "on its side" from the cranium alone).
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const to = (ox: number, oy: number, oz: number): [number, number, number] =>
    [x + ox * cy + oz * sy, y + oy, z - ox * sy + oz * cy];
  const cranium: PartSpec =
    { kind: 'sphere', pos: [x, y, z], radius: 0.07 * s, scale: [0.95, 0.82, 1.0], rot: [pitch, yaw, 0], mat };
  // A toppled skull (large pitch) lies face-down/sideways — its face
  // features would float off the rotated dome, and the dome alone
  // reads as "skull on its side". Cranium only.
  if (Math.abs(pitch) > 0.5) return [cranium];
  return [
    cranium,
    // Sockets — dark spheres buried to a sliver; the visible caps sit
    // in the dome's under-curve and read as shadowed pits.
    { kind: 'sphere', pos: to(-0.024 * s, 0.002 * s, 0.058 * s), radius: 0.017 * s, mat: 'void' },
    { kind: 'sphere', pos: to( 0.024 * s, 0.002 * s, 0.058 * s), radius: 0.017 * s, mat: 'void' },
    // Nasal slit — a narrow dark wedge under the sockets.
    { kind: 'box', pos: to(0, -0.02 * s, 0.06 * s), size: [0.013 * s, 0.022 * s, 0.02 * s], rot: [0, yaw, 0], mat: 'void' },
  ];
}

/** Knobbed end of a femur poking out of the stack — a small pale
 *  sphere at a bone end so the cordwood face isn't uniform tubes. */
function boneKnob(x: number, y: number, z: number, r: number, mat: string): PartSpec {
  return { kind: 'sphere', pos: [x, y, z], radius: r, mat };
}

/** Double-bay ossuary niche — ~1.2m wide, 1.6m tall bone cabinet.
 *  Two shelves: long bones stacked like cordwood below, skull row
 *  above. Asymmetric fill — one bay fuller, one skull tipped. */
export const OSSUARY_NICHE: ModelSpec = {
  id: 'ossuary-niche',
  class: 'decor',
  materials: {
    frame: FRAME,
    void: VOID_BACK,
    bone: PALE_BONE,
    aged: PALE_BONE_AGED,
  },
  parts: [
    // Stone shell — jambs, lintel, sill, mid shelf, dark back panel.
    { kind: 'box', pos: [-0.58, 0.80, 0],      size: [0.12, 1.60, 0.36], mat: 'frame', jitter: 0.015 },
    { kind: 'box', pos: [ 0.58, 0.80, 0],      size: [0.12, 1.60, 0.36], mat: 'frame', jitter: 0.015 },
    { kind: 'box', pos: [ 0,    1.55, 0],      size: [1.30, 0.14, 0.40], mat: 'frame', jitter: 0.02 },
    { kind: 'box', pos: [ 0,    0.07, 0],      size: [1.30, 0.14, 0.42], mat: 'frame', jitter: 0.02 },
    { kind: 'box', pos: [ 0,    0.82, 0],      size: [1.04, 0.09, 0.34], mat: 'frame' },
    { kind: 'box', pos: [ 0,    0.80, -0.15],  size: [1.04, 1.40, 0.05], mat: 'void' },

    // LOWER BAY — long bones packed like cordwood, two deep, thin and
    // uneven. The front row sags; the back row fills the shadow.
    longBone(-0.02, 0.20, 0.05, 0.88, 0.030, 0.05, 'bone'),
    longBone( 0.05, 0.205, -0.06, 0.84, 0.032, -0.03, 'aged'),
    longBone(-0.05, 0.26, 0.04, 0.90, 0.028, -0.06, 'aged'),
    longBone( 0.03, 0.265, -0.05, 0.86, 0.031, 0.07, 'bone'),
    longBone( 0.00, 0.32, 0.05, 0.82, 0.029, 0.04, 'bone'),
    longBone(-0.06, 0.325, -0.06, 0.88, 0.030, -0.05, 'aged'),
    longBone( 0.04, 0.38, 0.03, 0.86, 0.031, -0.07, 'aged'),
    longBone(-0.02, 0.385, -0.05, 0.80, 0.028, 0.05, 'bone'),
    longBone(-0.04, 0.44, 0.04, 0.74, 0.030, 0.09, 'bone'),
    longBone( 0.06, 0.445, -0.06, 0.82, 0.029, -0.04, 'aged'),
    // The stack thins at the top — settled, not arranged.
    longBone(-0.10, 0.50, 0.00, 0.62, 0.028, 0.12, 'aged'),
    longBone( 0.14, 0.505, -0.03, 0.48, 0.027, -0.10, 'bone'),
    // Femur heads breaking the cordwood face.
    boneKnob(-0.30, 0.21, 0.11, 0.037, 'bone'),
    boneKnob( 0.18, 0.325, 0.11, 0.034, 'aged'),
    boneKnob(-0.08, 0.44, 0.10, 0.035, 'bone'),

    // UPPER BAY — skulls cheek to cheek facing the room, one tipped
    // clean over onto its side. The gap is the story.
    ...skull(-0.40, 0.925, 0.02, 0.98, 0.12, 0, 'bone'),
    ...skull(-0.20, 0.928, -0.01, 1.02, -0.10, 0, 'aged'),
    ...skull( 0.00, 0.922, 0.03, 0.95, 0.22, 0, 'bone'),
    ...skull( 0.21, 0.926, 0.00, 1.0, -0.16, 0, 'aged'),
    // The fifth slot: its skull lies toppled on its side before the gap.
    ...skull( 0.41, 0.93, 0.04, 0.98, 1.35, 1.45, 'bone'),
    // Loose bones behind the skull row filling the bay's shadow.
    longBone(0.05, 1.16, -0.08, 0.84, 0.030, 0.06, 'aged'),
    longBone(-0.04, 1.22, -0.09, 0.76, 0.028, -0.05, 'bone'),
    longBone(0.02, 1.28, -0.10, 0.68, 0.029, 0.04, 'aged'),
  ],
};

/** Single-bay niche — ~0.7m wide waist-high bone shrine. One skull
 *  atop a short stack. The quiet variant for small rooms. */
export const OSSUARY_NICHE_SMALL: ModelSpec = {
  id: 'ossuary-niche-small',
  class: 'decor',
  materials: {
    frame: FRAME,
    void: VOID_BACK,
    bone: PALE_BONE,
    aged: PALE_BONE_AGED,
  },
  parts: [
    { kind: 'box', pos: [-0.34, 0.55, 0],     size: [0.10, 1.10, 0.34], mat: 'frame', jitter: 0.015 },
    { kind: 'box', pos: [ 0.34, 0.55, 0],     size: [0.10, 1.10, 0.34], mat: 'frame', jitter: 0.015 },
    { kind: 'box', pos: [ 0,    1.07, 0],     size: [0.82, 0.12, 0.38], mat: 'frame', jitter: 0.02 },
    { kind: 'box', pos: [ 0,    0.06, 0],     size: [0.82, 0.12, 0.40], mat: 'frame', jitter: 0.02 },
    { kind: 'box', pos: [ 0,    0.55, -0.14], size: [0.60, 0.95, 0.05], mat: 'void' },

    longBone(-0.01, 0.18, 0.04, 0.50, 0.029, 0.06, 'bone'),
    longBone( 0.03, 0.185, -0.05, 0.46, 0.030, -0.04, 'aged'),
    longBone(-0.03, 0.24, 0.03, 0.52, 0.028, -0.05, 'aged'),
    longBone( 0.02, 0.245, -0.04, 0.48, 0.029, 0.05, 'bone'),
    longBone(-0.02, 0.30, 0.00, 0.44, 0.028, 0.08, 'bone'),
    boneKnob(-0.16, 0.19, 0.09, 0.032, 'aged'),
    boneKnob( 0.12, 0.30, 0.08, 0.030, 'bone'),
    ...skull(0.02, 0.44, 0.02, 1.0, -0.2, 0, 'bone'),
  ],
};
