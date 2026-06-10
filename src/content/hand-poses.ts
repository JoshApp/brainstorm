import type { ModelSpec } from '../ecs/model-types';
import { orient, tilt, rotateLocally, DIR } from '../anim/orient';
import { HAND_LEFT } from './hand';

// ── Hand POSES as data ───────────────────────────────────────────────
//
// A hand spec (hand.ts) is GEOMETRY — bones, radii, slot hierarchy. A
// POSE is the set of slot ROTATIONS that arrange that geometry into a
// grip: wrist orientation + per-joint finger curls. Keeping them apart
// fixes the failure we hit with the lantern hand: mirroring HAND_RIGHT
// mirrors its baked-in SABER pose along with the bones, and a mirrored
// saber grip is simply the wrong pose for carrying a lantern ring —
// no amount of wrist tuning un-bakes it.
//
// A pose is plain data (slot name → Euler), so future grips (fist,
// open palm, staff, reins) are authored here as new constants — no new
// geometry, no mirror surgery. This is also the seam a content layer
// can author against without touching the rig.
//
// All wrist orientations are authored with orient()/tilt() — named
// directions, not guessed Euler decimals (see CLAUDE.md).

export interface HandPose {
  /** slot name → rotation override (Euler XYZ, radians). Slots not
   *  named keep the rotation baked in the geometry spec. */
  slotRot: Record<string, [number, number, number]>;
}

/** Re-pose a hand spec: same geometry, new grip. Only slot rotations
 *  change; positions, parts, parents, debug markers all survive. */
export function withHandPose(base: ModelSpec, id: string, pose: HandPose): ModelSpec {
  const slots = Object.fromEntries(
    Object.entries(base.slots ?? {}).map(([name, slot]) => [
      name,
      pose.slotRot[name] ? { ...slot, rot: pose.slotRot[name] } : slot,
    ]),
  );
  return { ...base, id, slots };
}

// ── RING-CARRY (left hand on the lantern's O-ring) ──────────────────
//
// The grip of someone carrying a hanging lantern at the hip: the hand
// drapes over the ring from above, four fingers hooked THROUGH it,
// thumb resting alongside (a carry hook needs no thumb opposition —
// gravity keeps the ring seated in the curl). Wrist near neutral so
// the forearm continues straight up toward the elbow, no kink.
//
// Frame: camera-local (the lamp arm hangs under the camera).
//   fingers (+Y)      → FORWARD, dipping ~25° — the hand REACHES over
//                       the ring nearly level (a straight 90° drape
//                       read as a limp puppet hand; steeper carries
//                       still read droopy — Josh asked it straighter
//                       twice, this is the second notch)
//   back of hand (+Z) → UP, tilted FORWARD — knuckles face up-scene
const RING_WRIST_ROT = orient({
  yAxisTo: tilt(DIR.FORWARD, DIR.DOWN, 0.6),
  upTo: tilt(DIR.UP, DIR.FORWARD, 0.3),
});

// Hook curl — deeper at the PIP than the saber grip (the ring's tube
// is thinner than a sword hilt; the hook closes tighter), slightly
// shallower at the MCP. No fan: fingers run parallel through the ring.
const HOOK_MCP = -1.25;
const HOOK_PIP = -1.30;
const HOOK_DIP = -0.45;

// Thumb at rest along the ring, NOT opposing. Left-hand frame: the
// side-fan Z and the oppose twist Y are sign-flipped vs the right
// hand's saber thumb (mirror flips Y/Z rotation signs).
const RING_THUMB_ROT = rotateLocally([-0.55, 0, 0.85], 'y', -1.5);

export const RING_CARRY_POSE: HandPose = {
  slotRot: {
    wrist: RING_WRIST_ROT,
    finger_index: [HOOK_MCP, 0, 0],
    finger_middle: [HOOK_MCP - 0.05, 0, 0],
    finger_ring: [HOOK_MCP - 0.02, 0, 0],
    finger_pinky: [HOOK_MCP + 0.12, 0, 0],
    finger_index_pip: [HOOK_PIP, 0, 0],
    finger_middle_pip: [HOOK_PIP, 0, 0],
    finger_ring_pip: [HOOK_PIP, 0, 0],
    finger_pinky_pip: [HOOK_PIP + 0.06, 0, 0],
    finger_index_dip: [HOOK_DIP, 0, 0],
    finger_middle_dip: [HOOK_DIP, 0, 0],
    finger_ring_dip: [HOOK_DIP, 0, 0],
    finger_pinky_dip: [HOOK_DIP, 0, 0],
    finger_thumb: RING_THUMB_ROT,
    finger_thumb_ip: [-0.55, 0, 0],
  },
};

/** The left hand actually posed for the lantern. lamp-arm.ts mounts
 *  this instead of reusing the right hand's saber grip. */
export const HAND_LEFT_LANTERN: ModelSpec = withHandPose(
  HAND_LEFT,
  'hand-left-lantern',
  RING_CARRY_POSE,
);
