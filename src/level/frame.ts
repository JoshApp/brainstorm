import * as THREE from 'three';
import { archway } from '../content/archway';
import type { ModelSpec } from '../ecs/model-types';
import type { BuiltModel } from '../ecs/build-model';
import { buildArchwayEye } from '../scene/archway-eye';
import { registerArchwayLure } from '../scene/threshold-draft';

// FRAME — the one place that knows how to dress an opening in stone. Every
// passage the player walks through (procgen corridor mouths, tilemap door runs,
// the fitting drain's archway/fog-gate openings) is framed through these two
// seams, so every doorway in the game is the same gate and the shared visual
// fittings (the dungeon's nav eye) never drift apart again. What stays per-caller — collision blockers, nav gates, and the
// door/mist SEAL state machines — isn't the frame; it's what lives in it.

// VESTIGIAL — see chooseFrameModel. Kept only because callers import it; every
// opening gets the archway now, at every width.
export const ARCHWAY_MIN_WIDTH = 2.0;

export interface FrameOpts {
  width: number;
  ceilingHeight: number;
  /** Cap the lintel to a low tunnel's interior so no void slit shows above it. */
  openHeight?: number;
  /** Thickness of the wall this opening is cut through, in metres. Drives every
   *  depth in the frame model — see content/frame-depth.ts. Polygon rooms pass
   *  `WALL_T`; rect rooms pass 0, because their wall is a single plane. */
  wallDepth?: number;
  /** False when the room's own wall closes the gap above this opening with a
   *  lintel (polygon rooms). See ArchwayOptions.closeAbove. */
  closeAbove?: boolean;
  /** Force the slim doorframe regardless of width — a stair-room mouth (an
   *  archway column would soft-lock the stair) or a door/gate/fog opening that
   *  owns its own seal and wants no columns in the gap. */
  slimOnly?: boolean;
}

export interface FrameChoice {
  kind: 'archway' | 'doorframe';
  model: ModelSpec;
}

// ── THE FRAME OWNS THE SILL ──────────────────────────────────────────────────
//
// Josh, twice, from two angles: *"the corridor cleanly expands till the floor
// and then we stick the doorframe inside the geometry"*, and *"I could see in
// between the room and the corridor there was a gap."* Then the model that
// names it: *"it's the same as a pipe and the pipe's plug or connector."*
//
// The floor plan at a doorway has three owners and, until this, a band nobody
// owned. Going outward from the room:
//
//   [ room floor .. outline ]   the room's plate
//   [ outline .. outline+0.25 ] the room's WALL — 0.25m of masonry with a hole
//   [ outline+0.25 .. ]         the corridor
//
// The middle band is the doorway itself, and neither plate covered it. The
// corridor "solved" that by running its own floor and ceiling 0.10m PAST the
// outline — straight through all 0.25m of the wall and out the other side. So
// the pipe was seated inside the socket rather than stopping at its face: the
// corridor's slab and the room's wall and the frame all occupying one strip of
// ground, which is the z-fighting, and any place the corridor's plate fell
// short of that reach was the gap.
//
// Now the corridor stops at the wall's OUTER FACE (corridor-trim.ts) and THE
// FRAME CARRIES THE FLOOR OF ITS OWN THRESHOLD. That is what a connector is:
// the joint is one part's job, not an overlap negotiated between two.
//
// Done here rather than in `archway()` and `doorframe()` separately, because
// this is the one seam every framed opening in the game passes through — and a
// sill authored twice is a sill that disagrees with itself the first time one
// of them is tuned.

/** How thick the threshold slab is. Deep enough to read as a laid stone from
 *  a standing eye, shallow enough that it is never a step. */
const SILL_THICK = 0.10;
/** How far the sill runs PAST the wall band at each face, so it laps under the
 *  room's floor on one side and the corridor's plate on the other. A joint that
 *  meets exactly is a joint one rounding away from a hairline of void. */
const SILL_LAP = 0.06;
/** How far the sill reaches past the opening's edges, to pass under the jambs
 *  rather than stopping at them. */
const SILL_SHOULDER = 0.18;
/** A hair proud of both floors so the shared plane is never contested. Well
 *  under anything the step-up code or a player's feet would notice. */
const SILL_PROUD = 0.008;

/**
 * The model to build for an opening. THERE IS ONE GATE.
 *
 * Josh, 2026-08-16: *"lets get rid of the two types of archways and only make
 * the massive stone one the default that we redesign a little."*
 *
 * The split existed for a measured reason and the reason has since been fixed
 * out from under it. The jambs used to stand INSIDE the opening with their outer
 * faces flush to its edges, so an archway ate a full jamb-thickness off each side
 * of the way through — 0.68m gone from every doorway, which necked a 1.7m squeeze
 * to 1.02m. A narrow opening genuinely could not carry one, so the slim doorframe
 * was built for those and a width threshold picked between them.
 *
 * Then the jambs were moved OUT to flank the opening (see archwayColumnOffset).
 * From that moment an archway has cost a narrow doorway exactly nothing — the
 * whole hole is yours to walk through at every width, and `archwayPassableHalfBand`
 * can only get wider, which is the direction the stair-mouth soft-lock guarantee
 * and the nav gates care about. The threshold outlived its cause by some months.
 *
 * `slimOnly` and `ARCHWAY_MIN_WIDTH` are still accepted so nothing downstream
 * breaks, and both are now ignored. When the second gate is wanted back it should
 * come back as a DIFFERENT PLACE — a postern that means something — not as a
 * silent consequence of an opening being 1.9m instead of 2.1m.
 */
export function chooseFrameModel(o: FrameOpts): FrameChoice {
  const choice: FrameChoice = {
    kind: 'archway',
    model: archway({
      width: o.width, ceilingHeight: o.ceilingHeight,
      openHeight: o.openHeight, wallDepth: o.wallDepth,
      closeAbove: o.closeAbove,
    }),
  };
  return o.wallDepth ? withSill(choice, o.width, o.wallDepth) : choice;
}

/**
 * Add the threshold slab the frame is responsible for.
 *
 * Local frame: +X runs along the opening, +Z passes THROUGH it (see the
 * rotY note in portals.ts), y = 0 is the floor. So the wall band is
 * z ∈ [-wallDepth/2, +wallDepth/2] and the sill is a box across it.
 *
 * Only when a `wallDepth` is given. A rect-era room's wall is a single plane
 * with no band to floor, and inventing a slab there would put a lip in every
 * tilemap doorway in the game.
 */
function withSill(choice: FrameChoice, width: number, wallDepth: number): FrameChoice {
  const parts = [...choice.model.parts, {
    kind: 'box' as const,
    name: 'sill',
    pos: [0, SILL_PROUD - SILL_THICK / 2, 0] as [number, number, number],
    size: [width + SILL_SHOULDER * 2, SILL_THICK, wallDepth + SILL_LAP * 2] as [number, number, number],
    mat: 'stone',
  }];
  return {
    kind: choice.kind,
    // The id is a build-cache key, so it has to move when the geometry does.
    model: { ...choice.model, id: `${choice.model.id}-sill${wallDepth.toFixed(2)}`, parts },
  };
}

// How far past the keystone face to sample when deciding if that face looks
// into a room vs a corridor. ~1.5m total reach clears the wall and lands in the
// interior on either side.
const FACE_SAMPLE = 1.2;

/** Attach the visual fittings every framed opening shares: the dungeon's nav
 *  EYE at each keystone slot the model declares (eye_front / eye_back). Call
 *  after the frame model is built AND positioned, with the opening's world
 *  centre `(x, z)` — that's the key the nav system matches eyes to floor-graph
 *  edges. The eye mounts INTO the
 *  frame group, so it culls with the doorway it belongs to; what keeps it out
 *  of the static merge is the per-mesh `dynamicPart` opt-out it sets on itself,
 *  not where it is parented (see archway-eye.ts).
 *
 *  `looksIntoCorridor` (optional): given the world point a keystone face GAZES
 *  toward, returns true if that side is a corridor interior. The eye is a cue
 *  for the ROOM you stand in ("is there unexplored ground through here") — so a
 *  face aimed down a corridor gets NO eye. Omitted → mount both faces (used by
 *  the rare fitting openings, which aren't corridor mouths). */
export function installFrameFittings(
  built: BuiltModel, root: THREE.Object3D, x: number, z: number,
  looksIntoCorridor?: (px: number, pz: number) => boolean,
): void {
  // (The 'glow' material — the crown's proximity glow — is gone; a frame is one
  // stone material now. A welcome side effect: that material was tagged
  // `animatedEmissive` to keep the static batcher's emissive→vertex bake from
  // freezing it dark, which also kept every gate on the floor OUT of the batch.
  // Frames batch now.)
  built.group.updateMatrixWorld(true);
  for (const slotName of ['eye_front', 'eye_back'] as const) {
    const slot = built.slots.get(slotName);
    if (!slot) continue;
    const pos = slot.getWorldPosition(new THREE.Vector3());
    const quat = slot.getWorldQuaternion(new THREE.Quaternion());
    if (looksIntoCorridor) {
      // The eye gazes along its local +Z; sample a step out to see what it faces.
      const gaze = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      if (looksIntoCorridor(pos.x + gaze.x * FACE_SAMPLE, pos.z + gaze.z * FACE_SAMPLE)) continue;
    }
    const eye = buildArchwayEye(root, pos, quat);
    // THE EYE CULLS WITH ITS DOORWAY. It lives at the level root (see
    // buildArchwayEye for why it must), so the culler cannot infer which rooms
    // it serves. Stamp the FRAME's placement — not the eye's, whose rotation
    // carries the keystone slot orientation plus REST_PITCH and would probe off
    // axis — and room-culling.ts resolves the two rooms from it exactly as it
    // does for the frame stone itself.
    eye.group.userData.boundaryOf = { x: built.group.position.x, z: built.group.position.z, rotY: built.group.rotation.y };
    registerArchwayLure(eye, x, z);
  }
}
