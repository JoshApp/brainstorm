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
// LENGTHENED 0.32/0.42 → 0.35/0.50 (max reach 0.740m → 0.850m).
//
// The v3 lamp-elbow fix dropped the LEFT shoulder 0.58 → 0.80 to get the elbow
// out of frame, which bought clearance and SPENT REACH: the lantern ended up
// 0.756m from a shoulder with 0.740m of arm, i.e. 102% — locked straight, and
// the game's own runtime warning was saying so ("IK target at 106% of max
// reach ... LAMP_RAISED and the ARM_LEFT shoulder have probably drifted
// apart"). Josh: *"thats not so bad we can change that as long as it looks
// good and sound."*
//
// Clearance and reach pull in OPPOSITE directions — moving a shoulder away
// from the hand buys frame margin and spends reach — so these two numbers have
// to be re-checked together. scripts/elbow-probe.ts now prints both; it only
// printed clearance when the regression went in, which is why nothing caught
// it. After this: LEFT 89%, RIGHT 66%.
const HUMERUS_LENGTH = 0.35;
const FOREARM_LENGTH = 0.50;

// Forearm bone GIRTH — shared by both arms so the pair can't drift apart.
//
// PRESENCE PASS (viewmodel v3). Radii and spacing only; the LENGTHS above are
// deliberately not in this block. The IK solves on the lengths, so thickness is
// free — a length change would move the wrist and re-pose every grip in the
// game.
//
// The two bones were thin enough (0.018 / 0.017, 26mm apart) that at arm's
// length they merged into a single pale stick. ~17% wider and 4mm further
// apart makes radius and ulna read as TWO bones with a gap between them, which
// is the entire reason a skeletal arm is worth more than a limb. The dark sinew
// stays thin so that gap keeps its shadow.
const FOREARM_SPREAD = 0.015;      // ± offset of each bone from the arm axis
const RADIUS_BASE = 0.021, RADIUS_TIP = 0.016;
const ULNA_BASE = 0.020, ULNA_TIP = 0.015;

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
      pos: [-FOREARM_SPREAD, FOREARM_LENGTH / 2, 0],
      radius: RADIUS_BASE, radiusTop: RADIUS_TIP,
      height: FOREARM_LENGTH, segments: 12,
      mat: 'bone' },
    { name: 'ulna', parent: 'elbow', kind: 'cylinder',
      pos: [FOREARM_SPREAD, FOREARM_LENGTH / 2, 0],
      radius: ULNA_BASE, radiusTop: ULNA_TIP,
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
    // reach, and so the bones extend through visible screen real
    // estate instead of going off the top/left of frame.
    //
    // Approximate human shoulder pose is "10cm right, 25cm below,
    // slight forward" — but at the weapon's idle position that
    // anatomical shoulder was OUT OF REACH. Pulled it slightly down
    // and forward so it's within reach AND the elbow bend lands
    // on-screen, not off the top-left.
    //
    // ── MEASURED 2026-08-15, because the numbers that used to be
    // written here had rotted and made this look tighter than it is:
    //   max reach   = HUMERUS + FOREARM = 0.32 + 0.42 = 0.740m
    //                 (the old comment said 0.654m — stale)
    //   shoulder→hand at the CURRENT SWORD_IDLE_POS (0.40,-0.34,-0.48)
    //                 = 0.558m
    //   before the v3 presence pass moved the hand
    //                 = 0.561m
    // So there is ~0.18m of slack and the IK is nowhere near clamping;
    // the presence pass changed the span by 3mm. Both lengths are free
    // to re-tune for LOOK — just re-measure this block if you do, and
    // remember the lengths (not the radii) are what the IK solves on.
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
      pos: [-FOREARM_SPREAD, FOREARM_LENGTH / 2, 0],
      radius: RADIUS_BASE, radiusTop: RADIUS_TIP,
      height: FOREARM_LENGTH, segments: 12,
      mat: 'bone' },
    { name: 'ulna', parent: 'elbow', kind: 'cylinder',
      pos: [FOREARM_SPREAD, FOREARM_LENGTH / 2, 0],
      radius: ULNA_BASE, radiusTop: ULNA_TIP,
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
    // Mirror of the right shoulder's −X, pulled FORWARD + DOWN +
    // OUTBOARD to follow the lamp. LAMP_RAISED moved to (−0.36,
    // −0.26, −0.78) after this shoulder was first placed, and the
    // ring-carry palm offset puts the IK wrist target ~9cm ABOVE the
    // ring — from the old shoulder (−0.10, −0.55, −0.05) that target
    // was 0.84m away, PAST the 0.74m max reach, so the arm locked
    // straight and the hand parked short of the ring. Placement
    // constraints, in order:
    //   - target within ~85% of reach (elbow keeps a bend);
    //   - shoulder + elbow stay OUTSIDE the camera frustum (low +
    //     outboard) so the humerus doesn't cross the frame as a
    //     giant near-camera slab — the bones should ENTER from the
    //     bottom-left edge, reading as "my arm", not block the view.
    //
    // ── DROPPED -0.58 → -0.80 (2026-08-15) ───────────────────────
    // The v3 presence pass raised the lantern 13cm and brought it 18cm
    // nearer, and the lamp wrist IS this arm's IK target — so the elbow
    // came up with it and started clipping into frame while running.
    // ("Moving forward for a while" is literal: momentum widens the FOV
    // by CONFIG.MOMENTUM.FOV_MAX_DEG, so the frustum GROWS the longer
    // you run, and a joint that clears at rest stops clearing.)
    //
    // Measured with scripts/elbow-probe.ts (imports the real ArmIK AND
    // reads this slot off the spec, so it can't disagree with the file
    // it's measuring), at full-momentum FOV, worst bob phase — clearance
    // of the elbow sphere below the bottom edge:
    //     old lamp pos, shoulder -0.58   0.095 m
    //     new lamp pos, shoulder -0.58   0.065 m   ← what Josh saw
    //     new lamp pos, shoulder -0.80   0.088 m   ← here
    // i.e. the drop buys back roughly what the presence pass spent.
    // The elbow POLE is not the lever here and the sweep says so: biasing
    // it further down also pushes the elbow BACK, and the frustum widens
    // with depth, so the margin gets WORSE (-2.0 pole → 0.043 m).
    shoulder: { pos: [-0.20, -0.80, -0.30], debug: 'axes' },
    upper_arm_anchor: { parent: 'shoulder', pos: [0, HUMERUS_LENGTH / 2, 0], debug: 'axes' },
    elbow: { parent: 'shoulder', pos: [0, HUMERUS_LENGTH, 0], debug: 'axes' },
    lower_arm_anchor: { parent: 'elbow', pos: [0, FOREARM_LENGTH / 2, 0], debug: 'axes' },
    wrist: { parent: 'elbow', pos: [0, FOREARM_LENGTH, 0], debug: 'axes' },
  },
};

export const ARM_LEFT_HUMERUS_LENGTH = HUMERUS_LENGTH;
export const ARM_LEFT_FOREARM_LENGTH = FOREARM_LENGTH;
