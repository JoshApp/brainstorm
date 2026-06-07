import type { ModelSpec } from '../ecs/model-types';
import { localFromWorld } from '../anim/orient';

// Wrist rotation: a sum of NAMED INTENTS, each landing on whichever
// Euler channel its axis corresponds to. The composition pattern is
// always "constant + constant + constant" on a channel, so editing
// one intent never disturbs another.
//
// X channel (pitch / hand-local +X axis — thumb-to-pinky):
//
//   PITCH FORWARD     — slight wrist flexion (palm tips toward forearm).
//   PLANE INTO SCREEN — additional forward pitch tilting the back-of-
//                       hand plane (hand-local XY) into the screen.
//
// Y channel (twist / roll / hand-local +Y axis — saber/forearm direction):
//
//   TWIST CW 40       — 40° clockwise from the PLAYER'S POV around the
//                       wrist's local +Y. Positive Y is clockwise when
//                       viewed from −Y → +Y, which is the player's view.
//   TILT RIGHT 20     — 20° tilt to the right IN THE HAND'S OWN SPACE
//                       (right = pinky side = hand-local +X). The right
//                       side of the hand drops toward the palm side.
//                       Same axis as TWIST_CW (hand-local +Y), so the
//                       two compose by addition on the Y channel.
//                       Different INTENT (frame of reference is the
//                       hand, not the player), same MATH.
const WRIST_PITCH_FORWARD = -0.20;
const WRIST_PLANE_INTO_SCREEN = -0.15;
const WRIST_TWIST_CW_40 = (40 * Math.PI) / 180;
const WRIST_TILT_RIGHT_20 = (20 * Math.PI) / 180;
const NEW_WRIST_ROT: [number, number, number] = [
  WRIST_PITCH_FORWARD + WRIST_PLANE_INTO_SCREEN,
  WRIST_TWIST_CW_40 + WRIST_TILT_RIGHT_20,
  0,
];
// The orientation the palm_anchor (and the weapon attached to it) had
// BEFORE the wrist twist, expressed in hand-root frame. We keep this
// constant so the weapon doesn't rotate just because the wrist did.
const PALM_ANCHOR_PRESERVED_WORLD_ROT: [number, number, number] = [-0.30, 0, 0];

// First-person RIGHT hand — a skeletal bone hand with FULL articulated
// finger joints (MCP + PIP + DIP per finger, MCP + IP for the thumb).
//
// SCOPE: this spec is JUST the hand (carpus, metacarpals, fingers,
// palm). The ARM (shoulder, elbow, humerus, forearm bones) lives in
// src/content/arm.ts and is mounted separately under the camera. The
// arm's IK chases this hand's wrist slot world position each frame,
// the way real animation systems separate hand-on-weapon motion from
// the arm that follows.
//
// Anatomy and naming:
//
//   Each long finger has three phalanges connected by three joints:
//     MCP — metacarpal-phalanx joint (knuckle row)
//     PIP — proximal interphalangeal (middle knuckle)
//     DIP — distal interphalangeal (fingertip knuckle)
//   The thumb has two phalanges + two joints (MCP + IP). All joints
//   nest hierarchically so rotating the MCP also tilts the PIP + DIP
//   and everything below them — a single, physically-correct curl.
//
// Coordinate convention (Y-up, −Z forward — per CLAUDE.md):
//   - origin       = the WRIST point — where the forearm would meet
//                    the hand (the arm IK targets this slot)
//   - +Y           = up, toward the fingertips
//   - +X           = OUTBOARD (pinky side, away from body)
//   - −X           = INBOARD  (thumb side, toward body)
//   - +Z           = back of hand (faces camera)
//   - −Z           = palm side (faces scene)
//
// ── Rig hierarchy ───────────────────────────────────────────────────
//
//   wrist slot                        (root, identity)
//     ├── carpus                      ─┐
//     ├── metacarpals × 5             ─┤  all live in wrist-local space
//     ├── knuckle bumps × 5           ─┤
//     ├── palm_anchor                 ─┘
//     └── finger_X (MCP, one per finger)
//           ├── proximal phalanx
//           └── finger_X_pip (PIP)
//                 ├── middle phalanx
//                 └── finger_X_dip (DIP)
//                       ├── distal phalanx
//                       └── fingertip
//
// Thumb has the same shape minus a middle phalanx + PIP/DIP rename
// (finger_thumb + finger_thumb_ip).
//
// Sub-slot positions (PIP relative to MCP, DIP relative to PIP) are
// PHALANX-LOCAL — placed at the proximal phalanx's TOP in MCP-local
// space, the middle phalanx's top in PIP-local space, etc. So when a
// joint rotates, every distal segment cascades the rotation
// correctly without any per-finger re-tuning.

// Baseline grip cylinder radius (sword-hilt-class). Contact-target
// anchors below sit on a grip cylinder of this radius around the
// palm_anchor — gives each fingertip a SPECIFIC LANDING POINT to
// tune curl against instead of "wherever the bones happen to end up."
const GRIP_RADIUS = 0.022;

// Per-finger phalanx lengths (proximal / middle / distal). Tuned so
// each finger's total length matches the v3 single-capsule reach and
// the relative proximal:middle:distal ≈ 0.45:0.30:0.25 (close to real
// anatomy without an autopsy reference).
const PHALANX = {
  index:  { proximal: 0.020, middle: 0.014, distal: 0.010, radius: 0.0094 },
  middle: { proximal: 0.022, middle: 0.016, distal: 0.011, radius: 0.0101 },
  ring:   { proximal: 0.020, middle: 0.014, distal: 0.010, radius: 0.0094 },
  pinky:  { proximal: 0.017, middle: 0.012, distal: 0.009, radius: 0.0085 },
  // Thumb: only two phalanges (proximal + distal), no middle.
  thumb:  { proximal: 0.022, middle: 0,     distal: 0.014, radius: 0.0108 },
};

// Per-joint baseline curl (rotX). MCP/PIP/DIP each contribute; the
// total ~170° wraps fingertips through the grip cylinder's palm-side
// surface. Each joint stays under ~90° individually, so no single
// joint hinges past anatomical max. Per-weapon grip-radius adjustment
// in held-weapon-compose.ts still nudges the MCP layer; PIP + DIP
// carry their authored baselines.
const MCP_CURL = -1.40;   // ≈ 80°
const PIP_CURL = -1.05;   // ≈ 60°
const DIP_CURL = -0.50;   // ≈ 29°

export const HAND_RIGHT: ModelSpec = {
  id: 'hand-right-bone',
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
    // ── CARPUS ─ child of wrist; rotates with the wrist bend.
    { name: 'carpus', parent: 'wrist', kind: 'sphere',
      pos: [0, 0.010, 0],
      radius: 0.034, segments: [12, 8],
      mat: 'bone' },

    // ── METACARPALS ─ children of wrist; fan from the carpus up to
    // the knuckle row. Positions are wrist-local (original hand-local
    // minus (0, WRIST_Y, WRIST_Z)).
    { name: 'mc_thumb',  parent: 'wrist', kind: 'cylinder',
      pos: [-0.030, 0.062, 0.007],
      radius: 0.013, radiusTop: 0.011, height: 0.060, segments: 10,
      rot: [0, 0, 0.65],
      mat: 'bone' },
    { name: 'mc_index',  parent: 'wrist', kind: 'cylinder',
      pos: [ 0.025, 0.092, 0],
      radius: 0.011, radiusTop: 0.009, height: 0.072, segments: 10,
      rot: [0, 0, -0.18],
      mat: 'bone' },
    { name: 'mc_middle', parent: 'wrist', kind: 'cylinder',
      pos: [ 0.008, 0.094, 0],
      radius: 0.012, radiusTop: 0.010, height: 0.078, segments: 10,
      rot: [0, 0, -0.06],
      mat: 'bone' },
    { name: 'mc_ring',   parent: 'wrist', kind: 'cylinder',
      pos: [-0.008, 0.093, 0],
      radius: 0.011, radiusTop: 0.009, height: 0.074, segments: 10,
      rot: [0, 0, 0.06],
      mat: 'bone' },
    { name: 'mc_pinky',  parent: 'wrist', kind: 'cylinder',
      pos: [-0.023, 0.089, 0],
      radius: 0.010, radiusTop: 0.008, height: 0.064, segments: 10,
      rot: [0, 0, 0.18],
      mat: 'bone' },

    // ── KNUCKLE BUMPS at each MCP joint. Children of wrist (sit at
    // the MCP slot position; the slot itself is also there but
    // invisible, so the bump fills the visible joint).
    { parent: 'wrist', kind: 'sphere', pos: [ 0.025, 0.128, 0.007], radius: 0.012, segments: [10, 8], mat: 'bone' },
    { parent: 'wrist', kind: 'sphere', pos: [ 0.008, 0.134, 0.007], radius: 0.013, segments: [10, 8], mat: 'bone' },
    { parent: 'wrist', kind: 'sphere', pos: [-0.008, 0.130, 0.007], radius: 0.012, segments: [10, 8], mat: 'bone' },
    { parent: 'wrist', kind: 'sphere', pos: [-0.023, 0.121, 0.007], radius: 0.011, segments: [10, 8], mat: 'bone' },
    { parent: 'wrist', kind: 'sphere', pos: [-0.048, 0.086, 0.007], radius: 0.012, segments: [10, 8], mat: 'bone' },

    // ── INDEX FINGER ─ proximal phalanx (in MCP) + PIP joint bump +
    // middle phalanx (in PIP) + DIP joint bump + distal phalanx + tip.
    // Proximal phalanx sits centered along MCP-local +Y between the
    // joint origin and the PIP slot.
    { parent: 'finger_index', kind: 'cylinder',
      pos: [0, PHALANX.index.proximal / 2, 0],
      radius: PHALANX.index.radius, height: PHALANX.index.proximal, segments: 10,
      mat: 'bone' },
    // PIP knuckle bump
    { parent: 'finger_index_pip', kind: 'sphere',
      pos: [0, 0, 0],
      radius: PHALANX.index.radius * 1.10, segments: [8, 6],
      mat: 'bone' },
    { parent: 'finger_index_pip', kind: 'cylinder',
      pos: [0, PHALANX.index.middle / 2, 0],
      radius: PHALANX.index.radius * 0.92, height: PHALANX.index.middle, segments: 10,
      mat: 'bone' },
    // DIP knuckle bump
    { parent: 'finger_index_dip', kind: 'sphere',
      pos: [0, 0, 0],
      radius: PHALANX.index.radius * 1.00, segments: [8, 6],
      mat: 'bone' },
    { parent: 'finger_index_dip', kind: 'cylinder',
      pos: [0, PHALANX.index.distal / 2, 0],
      radius: PHALANX.index.radius * 0.86, height: PHALANX.index.distal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_index_dip', kind: 'sphere',
      pos: [0, PHALANX.index.distal, 0],
      radius: PHALANX.index.radius * 0.86, segments: [8, 6],
      mat: 'bone' },

    // ── MIDDLE FINGER ─ same pattern.
    { parent: 'finger_middle', kind: 'cylinder',
      pos: [0, PHALANX.middle.proximal / 2, 0],
      radius: PHALANX.middle.radius, height: PHALANX.middle.proximal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_middle_pip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.middle.radius * 1.10, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_middle_pip', kind: 'cylinder',
      pos: [0, PHALANX.middle.middle / 2, 0],
      radius: PHALANX.middle.radius * 0.92, height: PHALANX.middle.middle, segments: 10,
      mat: 'bone' },
    { parent: 'finger_middle_dip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.middle.radius * 1.00, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_middle_dip', kind: 'cylinder',
      pos: [0, PHALANX.middle.distal / 2, 0],
      radius: PHALANX.middle.radius * 0.86, height: PHALANX.middle.distal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_middle_dip', kind: 'sphere',
      pos: [0, PHALANX.middle.distal, 0],
      radius: PHALANX.middle.radius * 0.86, segments: [8, 6], mat: 'bone' },

    // ── RING FINGER ─ same pattern.
    { parent: 'finger_ring', kind: 'cylinder',
      pos: [0, PHALANX.ring.proximal / 2, 0],
      radius: PHALANX.ring.radius, height: PHALANX.ring.proximal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_ring_pip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.ring.radius * 1.10, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_ring_pip', kind: 'cylinder',
      pos: [0, PHALANX.ring.middle / 2, 0],
      radius: PHALANX.ring.radius * 0.92, height: PHALANX.ring.middle, segments: 10,
      mat: 'bone' },
    { parent: 'finger_ring_dip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.ring.radius * 1.00, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_ring_dip', kind: 'cylinder',
      pos: [0, PHALANX.ring.distal / 2, 0],
      radius: PHALANX.ring.radius * 0.86, height: PHALANX.ring.distal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_ring_dip', kind: 'sphere',
      pos: [0, PHALANX.ring.distal, 0],
      radius: PHALANX.ring.radius * 0.86, segments: [8, 6], mat: 'bone' },

    // ── PINKY ─ same pattern, smaller.
    { parent: 'finger_pinky', kind: 'cylinder',
      pos: [0, PHALANX.pinky.proximal / 2, 0],
      radius: PHALANX.pinky.radius, height: PHALANX.pinky.proximal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_pinky_pip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.pinky.radius * 1.10, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_pinky_pip', kind: 'cylinder',
      pos: [0, PHALANX.pinky.middle / 2, 0],
      radius: PHALANX.pinky.radius * 0.92, height: PHALANX.pinky.middle, segments: 10,
      mat: 'bone' },
    { parent: 'finger_pinky_dip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.pinky.radius * 1.00, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_pinky_dip', kind: 'cylinder',
      pos: [0, PHALANX.pinky.distal / 2, 0],
      radius: PHALANX.pinky.radius * 0.86, height: PHALANX.pinky.distal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_pinky_dip', kind: 'sphere',
      pos: [0, PHALANX.pinky.distal, 0],
      radius: PHALANX.pinky.radius * 0.86, segments: [8, 6], mat: 'bone' },

    // ── THUMB ─ only TWO phalanges (proximal + distal) + IP joint.
    { parent: 'finger_thumb', kind: 'cylinder',
      pos: [0, PHALANX.thumb.proximal / 2, 0],
      radius: PHALANX.thumb.radius, height: PHALANX.thumb.proximal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_thumb_ip', kind: 'sphere', pos: [0, 0, 0],
      radius: PHALANX.thumb.radius * 1.10, segments: [8, 6], mat: 'bone' },
    { parent: 'finger_thumb_ip', kind: 'cylinder',
      pos: [0, PHALANX.thumb.distal / 2, 0],
      radius: PHALANX.thumb.radius * 0.92, height: PHALANX.thumb.distal, segments: 10,
      mat: 'bone' },
    { parent: 'finger_thumb_ip', kind: 'sphere',
      pos: [0, PHALANX.thumb.distal, 0],
      radius: PHALANX.thumb.radius * 0.86, segments: [8, 6], mat: 'bone' },
  ],
  slots: {
    // ── WRIST ─ now the ROOT of the hand spec (no parent, identity
    // pose). The arm lives in its own spec (src/content/arm.ts), is
    // mounted separately under the camera, and the IK chases this
    // hand's wrist position each frame. Children of wrist are still
    // authored in wrist-local space, so the entire fingers + palm +
    // metacarpals hierarchy stayed untouched by the split.
    wrist: { pos: [0, 0, 0], rot: NEW_WRIST_ROT },

    // The grip anchor a held weapon aligns to. A child of WRIST so it
    // inherits the wrist bend. Identity rotation: weapon's grip axis
    // (weapon-local +Y) maps directly to wrist's +Y — colinear with
    // the closed fingers and the forearm continuation. The fingers
    // naturally curl AROUND this axis without any wrist gymnastics.
    // The grip anchor a held weapon aligns to. A child of WRIST so it
    // inherits the wrist bend. Slightly tilted FORWARD (rot X = -0.30)
    // so the weapon's grip axis no longer runs perfectly colinear
    // with the fingers — they get a non-zero perpendicular component
    // to bend AROUND instead of along the cylinder. The blade still
    // reads as "extending forward from the fist" because the tilt is
    // small (~17°), but the fingers now have something to wrap.
    palm_anchor: {
      parent: 'wrist',
      pos: [0, 0.092, -0.011],
      // Counter the wrist's new twist so the weapon's world rotation
      // matches PALM_ANCHOR_PRESERVED_WORLD_ROT — i.e. exactly where
      // it was before the wrist rotated. The helper handles the
      // quaternion inverse-multiply.
      rot: localFromWorld(PALM_ANCHOR_PRESERVED_WORLD_ROT, NEW_WRIST_ROT),
    },

    // ── SEMANTIC INTENT ANCHORS ─────────────────────────────────────
    // These slots carry MEANING, not just position. Their local +Y
    // is the meaningful direction; the debug overlay renders them as
    // a labeled arrow instead of an axis triad so the convention is
    // visible in every snapshot.
    //
    //   palm_up      — the palm's outward-facing normal (away from
    //                  the closed fingers). Tells the rest of the
    //                  rig "this is which way the palm points." A
    //                  child of palm_anchor so it bends with the
    //                  wrist; its +Y becomes the live palm normal.
    //   blade_emerge — where a held blade should poke OUT of the
    //                  closed fist (the +Y top of the grip cylinder
    //                  at palm-anchor-local height GRIP_RADIUS * 2 — i.e.
    //                  just above where the four-finger curl
    //                  closes). Visible in debug as the spot to
    //                  verify the cross-guard sits above, not buried
    //                  inside the fist.
    palm_up:       { parent: 'palm_anchor', pos: [0, 0, 0], rot: [0, 0, 0] },
    blade_emerge:  { parent: 'palm_anchor', pos: [0, GRIP_RADIUS * 2, 0] },

    // ── PER-FINGER CONTACT TARGETS ─────────────────────────────────
    // Five named anchors on the grip cylinder surface marking WHERE
    // each fingertip is supposed to land. Authored in palm-anchor-
    // local; each sits at distance GRIP_RADIUS from the cylinder
    // axis (= palm_anchor's local +Y). The debug overlay renders
    // these as small spheres; the readout reports the distance from
    // each fingertip's DIP/IP slot to its matching contact target.
    //
    // The four long fingers wrap from BACK (+Z) to PALM (-Z) so
    // their contacts sit on the −Z (palm) side. The thumb wraps
    // from inboard across the TOP of the closed fingers, so its
    // contact sits on the +X (outboard) side, slightly above the
    // palm-anchor plane.
    contact_index:  { parent: 'palm_anchor', pos: [ 0.014, 0.006, -GRIP_RADIUS] },
    contact_middle: { parent: 'palm_anchor', pos: [ 0.002, 0.012, -GRIP_RADIUS] },
    contact_ring:   { parent: 'palm_anchor', pos: [-0.006, 0.008, -GRIP_RADIUS] },
    contact_pinky:  { parent: 'palm_anchor', pos: [-0.014, 0.000, -GRIP_RADIUS] },
    contact_thumb:  { parent: 'palm_anchor', pos: [ GRIP_RADIUS, 0.012, -0.004] },

    // ── MCP (knuckle row) ─ children of WRIST. Pre-curled ≈63° each;
    // viewmodel.ts's per-weapon grip-radius adjustment lerps from
    // here.
    finger_index:  { parent: 'wrist', pos: [ 0.025, 0.128, 0.007], rot: [MCP_CURL, 0, -0.12] },
    finger_middle: { parent: 'wrist', pos: [ 0.008, 0.134, 0.007], rot: [MCP_CURL - 0.05, 0, -0.04] },
    finger_ring:   { parent: 'wrist', pos: [-0.008, 0.130, 0.007], rot: [MCP_CURL - 0.02, 0,  0.04] },
    finger_pinky:  { parent: 'wrist', pos: [-0.023, 0.121, 0.007], rot: [MCP_CURL + 0.10, 0,  0.14] },
    // Thumb MCP — pre-rotated so the proximal phalanx wraps over the
    // top of where the closed fingers + grip sit.
    finger_thumb:  { parent: 'wrist', pos: [-0.048, 0.086, 0.007], rot: [-0.85, 0, -1.30] },

    // ── PIP (middle knuckle) ─ children of their MCP slot. Pre-curled
    // ≈49°. PIP-local pos is the END of the proximal phalanx.
    finger_index_pip:  { parent: 'finger_index',  pos: [0, PHALANX.index.proximal,  0], rot: [PIP_CURL, 0, 0] },
    finger_middle_pip: { parent: 'finger_middle', pos: [0, PHALANX.middle.proximal, 0], rot: [PIP_CURL, 0, 0] },
    finger_ring_pip:   { parent: 'finger_ring',   pos: [0, PHALANX.ring.proximal,   0], rot: [PIP_CURL, 0, 0] },
    finger_pinky_pip:  { parent: 'finger_pinky',  pos: [0, PHALANX.pinky.proximal,  0], rot: [PIP_CURL + 0.05, 0, 0] },

    // ── DIP (fingertip knuckle) ─ children of their PIP slot.
    // Pre-curled ≈17°. DIP-local pos is the END of the middle
    // phalanx.
    finger_index_dip:  { parent: 'finger_index_pip',  pos: [0, PHALANX.index.middle,  0], rot: [DIP_CURL, 0, 0] },
    finger_middle_dip: { parent: 'finger_middle_pip', pos: [0, PHALANX.middle.middle, 0], rot: [DIP_CURL, 0, 0] },
    finger_ring_dip:   { parent: 'finger_ring_pip',   pos: [0, PHALANX.ring.middle,   0], rot: [DIP_CURL, 0, 0] },
    finger_pinky_dip:  { parent: 'finger_pinky_pip',  pos: [0, PHALANX.pinky.middle,  0], rot: [DIP_CURL, 0, 0] },

    // ── THUMB IP ─ the thumb's only inter-phalangeal joint (no PIP
    // / DIP distinction since the thumb has just two phalanges).
    finger_thumb_ip:   { parent: 'finger_thumb', pos: [0, PHALANX.thumb.proximal, 0], rot: [-0.95, 0, 0] },
  },
};
