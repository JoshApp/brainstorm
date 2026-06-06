import type { ModelSpec } from '../ecs/model-types';

// First-person RIGHT hand — a skeletal bone hand with FULL articulated
// finger joints (MCP + PIP + DIP per finger, MCP + IP for the thumb).
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
//   - origin       = centre of the closed fist (= where a weapon's
//                    grip_anchor lines up)
//   - +Y           = up, out of the top of the fist
//   - +X           = OUTBOARD (pinky side, away from body)
//   - −X           = INBOARD  (thumb side, toward body)
//   - +Z           = back of hand (faces camera)
//   - −Z           = palm side (faces scene)
//
// ── Rig hierarchy ───────────────────────────────────────────────────
//
//   forearm bones, sinew gap          (top-level, NOT under wrist)
//   wrist slot                        (top-level, pre-tilted forward)
//     ├── carpus                      ─┐
//     ├── metacarpals × 5             ─┤  all bend with the wrist
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
// All positions inside the wrist-rooted subtree are WRIST-LOCAL —
// they bend with the wrist as one rigid rotation. Forearm + sinew
// stay outside so the bones don't bend with the wrist (the wrist is
// where the fist meets the arm, not where the arm meets the elbow).
//
// Sub-slot positions (PIP relative to MCP, DIP relative to PIP) are
// PHALANX-LOCAL — placed at the proximal phalanx's TOP in MCP-local
// space, the middle phalanx's top in PIP-local space, etc. So when a
// joint rotates, every distal segment cascades the rotation
// correctly without any per-finger re-tuning.

// ── Anchor + length constants ───────────────────────────────────────
// Wrist sits at hand-local (0, WRIST_Y, WRIST_Z). Everything in the
// wrist-rooted subtree is authored in wrist-local space — i.e. with
// these constants subtracted from the prior hand-local positions.
const WRIST_Y = -0.080;
const WRIST_Z =  0.005;

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
// total ~140° wraps comfortably around a standard grip without any
// single joint having to bend past 90° (the lo-fi-but-still-real-anat
// constraint). Per-weapon grip-radius adjustment in
// held-weapon-compose.ts still tweaks the MCP layer; PIP + DIP stay
// at these baseline angles.
const MCP_CURL = -1.10;   // ≈ 63°
const PIP_CURL = -0.85;   // ≈ 49°
const DIP_CURL = -0.30;   // ≈ 17°

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
    // ── FOREARM ─ radius (thumb-side, −X) + ulna (pinky-side, +X),
    // NOT children of the wrist — these stay rigid along the forearm
    // axis even when the wrist bends.
    { name: 'radius', kind: 'cylinder',
      pos: [-0.013, -0.27, 0.005],
      radius: 0.018, radiusTop: 0.014, height: 0.36, segments: 12,
      mat: 'bone' },
    { name: 'ulna',   kind: 'cylinder',
      pos: [ 0.013, -0.27, 0.005],
      radius: 0.017, radiusTop: 0.013, height: 0.36, segments: 12,
      mat: 'bone' },
    { kind: 'cylinder',
      pos: [0, -0.27, 0.005],
      radius: 0.012, height: 0.34, segments: 8,
      mat: 'boneDark' },

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
    // ── WRIST ─ the top of the kinematic chain. Pre-rotated forward
    // so the WHOLE FIST (carpus + metacarpals + fingers + held weapon)
    // bends at the wrist relative to the forearm, the way a real
    // hand grips a weapon.
    wrist: { pos: [0, WRIST_Y, WRIST_Z], rot: [-0.55, 0, 0] },

    // The grip anchor a held weapon aligns to. A child of WRIST so
    // it inherits the wrist bend along with the fingers. No further
    // rotation needed — the wrist does the work.
    palm_anchor: { parent: 'wrist', pos: [0, 0.092, -0.011] },

    // ── MCP (knuckle row) ─ children of WRIST. Pre-curled ≈63° each;
    // viewmodel.ts's per-weapon grip-radius adjustment lerps from
    // here.
    finger_index:  { parent: 'wrist', pos: [ 0.025, 0.128, 0.007], rot: [MCP_CURL, 0, -0.12] },
    finger_middle: { parent: 'wrist', pos: [ 0.008, 0.134, 0.007], rot: [MCP_CURL - 0.05, 0, -0.04] },
    finger_ring:   { parent: 'wrist', pos: [-0.008, 0.130, 0.007], rot: [MCP_CURL - 0.02, 0,  0.04] },
    finger_pinky:  { parent: 'wrist', pos: [-0.023, 0.121, 0.007], rot: [MCP_CURL + 0.10, 0,  0.14] },
    // Thumb MCP — pre-rotated so the proximal phalanx wraps over the
    // top of where the closed fingers + grip sit.
    finger_thumb:  { parent: 'wrist', pos: [-0.048, 0.086, 0.007], rot: [-0.55, 0, -1.10] },

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
    finger_thumb_ip:   { parent: 'finger_thumb', pos: [0, PHALANX.thumb.proximal, 0], rot: [-0.65, 0, 0] },
  },
};
