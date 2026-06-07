import type { ModelSpec } from '../ecs/model-types';

// First-person RIGHT arm — shoulder + elbow joints + the bones that
// span them. Mounted as a SEPARATE rig from the hand (which lives in
// src/content/hand.ts and grips the weapon directly). The arm is
// anchored to the camera at a fixed shoulder position; each frame the
// 2-bone IK in src/anim/arm-ik.ts targets the hand's WRIST slot world
// position, and the resulting shoulder + elbow rotations make the arm
// visibly follow the hand.
//
// Why split arm from hand: the previous monolithic spec had palm and
// shoulder in the SAME chain, which made any kind of arm-follows-hand
// solver circular (the palm is a child of the shoulder, so the IK was
// reading its own output). With the split, the IK has an external
// target (the hand's wrist, driven by the weapon's swing animation)
// and an external anchor (the shoulder, fixed in camera-local) — the
// textbook 2-bone IK setup that actually works.
//
// Joint convention (THIS is what makes IK clean):
//
//   - shoulder slot is the ROOT of the arm spec.
//   - elbow slot sits at shoulder-local (0, HUMERUS_LENGTH, 0) — i.e.
//     along shoulder's local +Y. So the IK only needs to ROTATE
//     SHOULDER such that its +Y points at the desired elbow position;
//     the elbow lands where it should via static offset.
//   - wrist slot sits at elbow-local (0, FOREARM_LENGTH, 0) — same
//     idea: IK rotates elbow's +Y at the wrist target, wrist lands
//     at the right world position automatically.
//   - Bones are authored as kind: 'bone' (humerus) or static
//     cylinders aligned along +Y (forearm). The IK never moves the
//     bones directly — joint rotations cascade through them.
//
// To re-pose the arm: just tweak the slot positions (shoulder anchor,
// bone lengths). The bones reflow. The IK retunes via its
// humerusLength / forearmLength constants the viewmodel passes in.

// Arm-bone lengths. Tuned so the SUM (= max IK reach) generously
// exceeds the camera-to-hand distance at SWORD_IDLE_POS (~0.69m),
// otherwise the IK clamps and leaves a visible gap between the
// forearm tip and the hand's wrist.
const HUMERUS_LENGTH = 0.32;
const FOREARM_LENGTH = 0.42;

export const ARM_RIGHT: ModelSpec = {
  id: 'arm-right',
  materials: {
    bone: {
      color: 0xc8b89a,
      roughness: 0.85,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
    boneDark: {
      color: 0x6e5d44,
      roughness: 0.90,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    // ── SHOULDER joint sphere — sits at shoulder origin. Mostly off-
    // screen behind/below the camera anyway; this is a marker for
    // the IK anchor, not a focal mesh.
    { parent: 'shoulder', kind: 'sphere',
      pos: [0, 0, 0],
      radius: 0.030, segments: [12, 10],
      mat: 'bone' },

    // ── HUMERUS ─ static bone spanning shoulder → elbow. Bone
    // primitive computes pos/rot/length from the slot positions; the
    // elbow's static offset along shoulder's +Y means the bone
    // always points along shoulder +Y, and when the IK rotates the
    // shoulder the bone visibly arcs with it.
    { name: 'humerus', kind: 'bone',
      from: 'shoulder', to: 'elbow',
      radius: 0.022, radiusTop: 0.018,
      mat: 'bone' },

    // ── ELBOW joint sphere — covers the humerus → forearm seam.
    { parent: 'elbow', kind: 'sphere',
      pos: [0, 0, 0],
      radius: 0.028, segments: [12, 10],
      mat: 'bone' },

    // ── FOREARM ─ radius / ulna / sinew. Static cylinders along
    // elbow's +Y axis. When the IK rotates the elbow such that its
    // +Y points at the wrist target, these rotate with it and end
    // up aimed correctly. Centered at FOREARM_LENGTH / 2 (cylinder
    // midpoint coincides with elbow-local Y = halfway to wrist).
    { name: 'radius', parent: 'elbow', kind: 'cylinder',
      pos: [-0.013, FOREARM_LENGTH / 2, 0],
      radius: 0.018, radiusTop: 0.014,
      height: FOREARM_LENGTH, segments: 12,
      mat: 'bone' },
    { name: 'ulna', parent: 'elbow', kind: 'cylinder',
      pos: [0.013, FOREARM_LENGTH / 2, 0],
      radius: 0.017, radiusTop: 0.013,
      height: FOREARM_LENGTH, segments: 12,
      mat: 'bone' },
    { name: 'sinew', parent: 'elbow', kind: 'cylinder',
      pos: [0, FOREARM_LENGTH / 2, 0],
      radius: 0.012, height: FOREARM_LENGTH * 0.94, segments: 8,
      mat: 'boneDark' },
  ],
  slots: {
    // ── SHOULDER ─ camera-local rest anchor. Positioned so the
    // shoulder-to-wrist segment fits comfortably within max arm
    // reach (= HUMERUS + FOREARM = 0.654m), and so the bones extend
    // through visible screen real estate instead of going off the
    // top/left of frame.
    //
    // Approximate human shoulder pose is "10cm right, 25cm below,
    // slight forward" — but with the weapon held at SWORD_IDLE_POS
    // (0.35, -0.32, -0.55), that anatomical shoulder is OUT OF
    // REACH (0.684m gap vs 0.654m arm). Pulled it slightly down
    // and forward so it's within reach AND the elbow bend lands
    // on-screen, not off the top-left.
    // Dropped from Y=-0.40 to -0.55 to pull the shoulder lower in
    // camera-local. Effect: the shoulder→wrist line leans more
    // vertical (the wrist is at Y=-0.32, so the shoulder is now 23cm
    // BELOW the wrist instead of 8cm). The IK follows that line and
    // positions the elbow so the forearm comes up more in line with
    // the hand's saber axis — reducing the visible kink at the
    // forearm-to-wrist seam that the wrist's own rotations couldn't
    // fix.
    shoulder: { pos: [0.05, -0.55, -0.10], debug: 'axes' },

    // ── UPPER ARM ANCHOR ─ midway up the humerus. A handle for the
    // "upper arm segment" the in-game axes overlay can target — its
    // local axes inherit the shoulder's rotation, so authors can
    // rotate around the upper arm in its OWN frame.
    upper_arm_anchor: { parent: 'shoulder', pos: [0, HUMERUS_LENGTH / 2, 0], debug: 'axes' },

    // ── ELBOW ─ shoulder-local +Y offset. The IK rotates SHOULDER
    // such that its +Y points at the desired elbow direction; the
    // elbow's world position is then shoulder.matrixWorld * (0, h, 0).
    elbow: { parent: 'shoulder', pos: [0, HUMERUS_LENGTH, 0], debug: 'axes' },

    // ── LOWER ARM ANCHOR ─ midway down the forearm. Same idea as
    // upper_arm_anchor — gives the forearm SEGMENT a named editor
    // anchor distinct from the elbow / wrist joints.
    lower_arm_anchor: { parent: 'elbow', pos: [0, FOREARM_LENGTH / 2, 0], debug: 'axes' },

    // ── WRIST ─ elbow-local +Y offset. Same idea — IK rotates the
    // elbow so its +Y points at the hand's wrist; this slot lands at
    // the targeted position via static offset.
    wrist: { parent: 'elbow', pos: [0, FOREARM_LENGTH, 0], debug: 'axes' },
  },
};

export const ARM_RIGHT_HUMERUS_LENGTH = HUMERUS_LENGTH;
export const ARM_RIGHT_FOREARM_LENGTH = FOREARM_LENGTH;

// ── LEFT ARM ─────────────────────────────────────────────────────
//
// Mirror of ARM_RIGHT for the off-hand. Same bone lengths + joint
// convention; only the shoulder position's X is flipped to the left
// side. Mounted by src/player/lamp-arm.ts holding the lantern at
// its O-ring instead of holding a weapon.
//
// The elbow-pole bias is supplied by the runtime (mirrored to −X for
// the left arm to bend outboard the same way the right does in
// camera-local).
export const ARM_LEFT: ModelSpec = {
  id: 'arm-left',
  materials: {
    bone: {
      color: 0xc8b89a,
      roughness: 0.85,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
    boneDark: {
      color: 0x6e5d44,
      roughness: 0.90,
      metalness: 0.05,
      fog: false,
      flatShading: 'auto',
    },
  },
  parts: [
    { parent: 'shoulder', kind: 'sphere',
      pos: [0, 0, 0],
      radius: 0.030, segments: [12, 10],
      mat: 'bone' },
    { name: 'humerus', kind: 'bone',
      from: 'shoulder', to: 'elbow',
      radius: 0.022, radiusTop: 0.018,
      mat: 'bone' },
    { parent: 'elbow', kind: 'sphere',
      pos: [0, 0, 0],
      radius: 0.028, segments: [12, 10],
      mat: 'bone' },
    { name: 'radius', parent: 'elbow', kind: 'cylinder',
      pos: [-0.013, FOREARM_LENGTH / 2, 0],
      radius: 0.018, radiusTop: 0.014,
      height: FOREARM_LENGTH, segments: 12,
      mat: 'bone' },
    { name: 'ulna', parent: 'elbow', kind: 'cylinder',
      pos: [0.013, FOREARM_LENGTH / 2, 0],
      radius: 0.017, radiusTop: 0.013,
      height: FOREARM_LENGTH, segments: 12,
      mat: 'bone' },
    { name: 'sinew', parent: 'elbow', kind: 'cylinder',
      pos: [0, FOREARM_LENGTH / 2, 0],
      radius: 0.012, height: FOREARM_LENGTH * 0.94, segments: 8,
      mat: 'boneDark' },
    // No fist sphere — the actual hand spec (HAND_RIGHT) is attached
    // to the wrist slot at mount time by src/player/lamp-arm.ts. The
    // fingers grip the lantern's O-ring directly.
  ],
  slots: {
    // Mirror of the right shoulder's −X. The wrist target (the
    // lantern's hinge / O-ring) is at camera-local roughly (−0.36,
    // −0.11, −0.52); shoulder at (−0.10, −0.55, −0.05) sits about
    // 0.49m away, comfortable within the 0.74m max reach.
    shoulder: { pos: [-0.10, -0.55, -0.05], debug: 'axes' },
    upper_arm_anchor: { parent: 'shoulder', pos: [0, HUMERUS_LENGTH / 2, 0], debug: 'axes' },
    elbow: { parent: 'shoulder', pos: [0, HUMERUS_LENGTH, 0], debug: 'axes' },
    lower_arm_anchor: { parent: 'elbow', pos: [0, FOREARM_LENGTH / 2, 0], debug: 'axes' },
    wrist: { parent: 'elbow', pos: [0, FOREARM_LENGTH, 0], debug: 'axes' },
  },
};

export const ARM_LEFT_HUMERUS_LENGTH = HUMERUS_LENGTH;
export const ARM_LEFT_FOREARM_LENGTH = FOREARM_LENGTH;
