import * as THREE from 'three';
import { archway } from '../content/archway';
import { doorframe } from '../content/doorframe';
import type { ModelSpec } from '../ecs/model-types';
import type { BuiltModel } from '../ecs/build-model';
import { buildArchwayEye } from '../scene/archway-eye';
import { registerArchwayLure, registerArchwayGlow } from '../scene/threshold-draft';

// FRAME — the one place that knows how to dress an opening in stone. Every
// passage the player walks through (procgen corridor mouths, tilemap door runs,
// the fitting drain's archway/fog-gate openings) is framed through these two
// seams, so the "wide gets an archway, narrow gets a doorframe" rule and the
// shared visual fittings (proximity glow + the dungeon's nav eye) never drift
// apart again. What stays per-caller — collision blockers, nav gates, and the
// door/mist SEAL state machines — isn't the frame; it's what lives in it.

// Wide mouths get the full archway (columns carry collision); narrower ones get
// the slim, collision-friendly doorframe. ONE threshold — see chooseFrameModel.
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
  /** Force the slim doorframe regardless of width — a stair-room mouth (an
   *  archway column would soft-lock the stair) or a door/gate/fog opening that
   *  owns its own seal and wants no columns in the gap. */
  slimOnly?: boolean;
}

export interface FrameChoice {
  kind: 'archway' | 'doorframe';
  model: ModelSpec;
}

/** The single archway-vs-doorframe decision + the model to build for it. */
export function chooseFrameModel(o: FrameOpts): FrameChoice {
  const wide = o.width >= ARCHWAY_MIN_WIDTH && !o.slimOnly;
  const opts = {
    width: o.width, ceilingHeight: o.ceilingHeight,
    openHeight: o.openHeight, wallDepth: o.wallDepth,
  };
  return wide
    ? { kind: 'archway', model: archway(opts) }
    : { kind: 'doorframe', model: doorframe(opts) };
}

// How far past the keystone face to sample when deciding if that face looks
// into a room vs a corridor. ~1.5m total reach clears the wall and lands in the
// interior on either side.
const FACE_SAMPLE = 1.2;

/** Attach the visual fittings every framed opening shares: the proximity crown
 *  GLOW ('glow' material) + the dungeon's nav EYE at each keystone slot the
 *  model declares (eye_front / eye_back). Call after the frame model is built
 *  AND positioned, with the opening's world centre `(x, z)` — that's the key the
 *  nav system matches eyes + glow to floor-graph edges. Independent scene
 *  objects, so the eye survives the static fixture merge.
 *
 *  `looksIntoCorridor` (optional): given the world point a keystone face GAZES
 *  toward, returns true if that side is a corridor interior. The eye is a cue
 *  for the ROOM you stand in ("is there unexplored ground through here") — so a
 *  face aimed down a corridor gets NO eye. Omitted → mount both faces (used by
 *  the rare fitting openings, which aren't corridor mouths). */
export function installFrameFittings(
  built: BuiltModel, scene: THREE.Object3D, x: number, z: number,
  looksIntoCorridor?: (px: number, pz: number) => boolean,
): void {
  const glow = built.materials.get('glow');
  if (glow) registerArchwayGlow(glow as THREE.MeshStandardMaterial, x, z);
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
    registerArchwayLure(buildArchwayEye(scene, pos, quat), x, z);
  }
}
