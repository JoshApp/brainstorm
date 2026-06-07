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
    // ── ELBOW JOINT bulb ─ sphere at the elbow position. Big enough
    // to fully cover the humerus → forearm junction so any small
    // residual mis-alignment between cylinders reads as a joint, not
    // a gap. Sits at the elbow slot's origin (= bottom of the forearm
    // = top of the humerus).
    { parent: 'elbow', kind: 'sphere',
      pos: [0, 0, 0],
      radius: 0.028, segments: [12, 10],
      mat: 'bone' },

    // ── HUMERUS ─ upper-arm bone spanning shoulder → elbow. Joint-
    // first authoring: the cylinder's pos, rotation, and length are
    // computed from the SHOULDER and ELBOW slot positions at build
    // time. Move either joint and the bone reflows — no possibility
    // of a "humerus floating off the shoulder" gap.
    //
    // Parent defaults to `from` (shoulder), so when the shoulder
    // rotates the bone rotates with it (the elbow + everything below
    // are also children of shoulder, so the whole arm swings as one).
    { name: 'humerus', kind: 'bone',
      from: 'shoulder', to: 'elbow',
      radius: 0.022, radiusTop: 0.018,
      mat: 'bone' },

    // ── FOREARM ─ radius (thumb-side, −X) + ulna (pinky-side, +X) +
    // central sinew. All span elbow → wrist; `offset` shifts the
    // pair off the centerline. Parented to elbow so they swing when
    // the elbow rotates (and inherit shoulder rotation transitively).
    { name: 'radius', kind: 'bone',
      from: 'elbow', to: 'wrist', offset: [-0.013, 0, 0],
      radius: 0.018, radiusTop: 0.014,
      mat: 'bone' },
    { name: 'ulna', kind: 'bone',
      from: 'elbow', to: 'wrist', offset: [0.013, 0, 0],
      radius: 0.017, radiusTop: 0.013,
      mat: 'bone' },
    { kind: 'bone',
      from: 'elbow', to: 'wrist',
      radius: 0.012, segments: 8,
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
    // ── SHOULDER ─ top of the kinematic chain. Sits off-screen
    // behind+below the camera (the delver's own body is mostly
    // behind their eyes). FK-only — no IK solver; if some future
    // feature wants the hand to reach for a doorknob, this is the
    // anchor an IK solver would target.
    shoulder: { pos: [0.10, -0.62, 0.20] },

    // ── ELBOW ─ child of shoulder, sits at the bottom of the visible
    // forearm. Pushed slightly further "down + back" from shoulder
    // than before so the external elbow angle opens from ~118° toward
    // ~127° — closer to a relaxed neutral hold instead of the over-
    // flexed look. Hand-local elbow position stays at (0, -0.45, 0)
    // so the wrist + fingers don't need to move; only the shoulder
    // and humerus rearranged.
    elbow: { parent: 'shoulder', pos: [-0.10, 0.17, -0.205] },

    // ── WRIST ─ the joint between forearm and hand. Combined
    // rotation: a forward flexion (≈30° around X) PLUS a 90° twist
    // around Z. The twist exists to cancel palm_anchor's Z rotation
    // in WORLD space — without it the perpendicular grip Josh wanted
    // also tilted the BLADE 90° (the weapon's grip + blade are
    // colinear in the mesh), which broke every weapon animation. The
    // wrist twist puts the BLADE back in its original world direction
    // while leaving palm_anchor's perpendicular grip intact:
    //
    //   weapon-local +Y  →  palm_anchor +X  →  wrist +X  →  elbow-local Y'
    //
    //   where Y' is the SAME direction the old weapon used to point
    //   (mostly hand-local +Y, slight forward tilt). The fingers
    //   (parented to wrist but NOT palm_anchor) follow wrist's +Y,
    //   which is now pointing INBOARD (hand-local −X) — i.e.
    //   perpendicular to the weapon. Grip + finger axis stay
    //   orthogonal; weapon world direction is unchanged.
    wrist: { parent: 'elbow', pos: [0, 0.37, 0], rot: [-0.30, 0, 1.5708] },

    // The grip anchor a held weapon aligns to. A child of WRIST so it
    // inherits the wrist bend. The Z rotation here is the LOAD-BEARING
    // bit Josh kept flagging: a weapon's grip cylinder extends along
    // its local +Y, and palm_anchor's +Y inherits the wrist's +Y —
    // which is ALSO the direction the closed fingers point along.
    // Without rotating, the grip is CO-AXIAL with the fingers, so
    // "weapon parallel with arm" no matter what the wrist does. The
    // −π/2 around Z maps weapon-local +Y → palm-anchor-local +X
    // (across the palm), so the grip passes THROUGH the closed fist
    // perpendicular to the finger axis — the way a sword is actually
    // held.
    palm_anchor: { parent: 'wrist', pos: [0, 0.092, -0.011], rot: [0, 0, -1.5708] },

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
