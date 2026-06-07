import type { ModelSpec, PartSpec, SlotSpec, Vec3 } from './model-types';

// Mirror a ModelSpec across the YZ plane (flip X). Produces a new
// spec read as a mirror image of the original, with names + materials
// + radii + heights preserved so consuming code that looks up parts
// or slots by name still works on the mirrored copy.
//
// Use case driving this file: HAND_RIGHT is an articulated 50-part
// skeleton. Authoring HAND_LEFT by hand would mean re-typing every
// position, sign-flipping every Z rotation, and keeping the two in
// sync on every future tweak. Instead we derive HAND_LEFT from
// HAND_RIGHT at module load — one source of truth.
//
// Reflection rules (across YZ, i.e. M = diag(-1, 1, 1)):
//
//   pos     [ x,  y,  z]  →  [-x,  y,  z]
//   rot Eul [rx, ry, rz]  →  [rx, -ry, -rz]   (XYZ-order, see below)
//   scale            (unchanged — mirroring is in pos + rot)
//
// Why that rotation rule: Three.js Euler 'XYZ' applies as
// Rx(rx)·Ry(ry)·Rz(rz). Conjugating by M = diag(-1, 1, 1) leaves
// Rx unchanged (X is on the mirror plane) and flips the sign of
// Ry / Rz (they rotate around axes that get reflected). Composition
// preserves the rule, so derived rotations (localFromWorld output,
// rotateLocally compositions) mirror correctly when treated as
// Euler tuples directly.
//
// Part-kind handling:
//   bone        — only `offset` needs mirroring; `from` / `to` are
//                 slot names, the bone reflows automatically.
//   csg         — recurse into `a` and `b`.
//   primitives  — common pos/rot mirror covers them.
//
// Limitations: doesn't touch material colours, light direction, or
// any data-driven content that bakes a side-of-body assumption into
// non-geometric fields. For an articulated rig that's all geometry,
// this is enough.

export function mirrorModelSpec(spec: ModelSpec, newId: string): ModelSpec {
  return {
    ...spec,
    id: newId,
    parts: spec.parts.map(mirrorPart),
    slots: spec.slots
      ? Object.fromEntries(
          Object.entries(spec.slots).map(([k, v]) => [k, mirrorSlot(v)]),
        )
      : undefined,
  };
}

function mirrorPos(v: Vec3 | undefined): Vec3 | undefined {
  return v ? [-v[0], v[1], v[2]] : undefined;
}

function mirrorRot(r: Vec3 | undefined): Vec3 | undefined {
  return r ? [r[0], -r[1], -r[2]] : undefined;
}

function mirrorSlot(slot: SlotSpec): SlotSpec {
  return {
    ...slot,
    pos: [-slot.pos[0], slot.pos[1], slot.pos[2]],
    rot: mirrorRot(slot.rot),
  };
}

function mirrorPart(part: PartSpec): PartSpec {
  const mirrored = {
    ...part,
    pos: mirrorPos(part.pos),
    rot: mirrorRot(part.rot),
  };
  if (part.kind === 'csg') {
    return {
      ...(mirrored as Extract<PartSpec, { kind: 'csg' }>),
      a: mirrorPart(part.a),
      b: mirrorPart(part.b),
    };
  }
  if (part.kind === 'bone' && part.offset) {
    return {
      ...(mirrored as Extract<PartSpec, { kind: 'bone' }>),
      offset: mirrorPos(part.offset),
    };
  }
  return mirrored as PartSpec;
}
