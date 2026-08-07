import type { ModelSpec } from '../ecs/model-types';

// ── WHAT A CORRIDOR LEAVES ON YOU ────────────────────────────────────────────
//
// Rooms stage events. Corridors hold EVIDENCE — the residue of something that
// already happened, which you read at walking pace with a lamp and never stop
// for. Nothing in this file is interactable, nothing in it is lit, and nothing
// in it takes a decision: a corridor that asks you a question is a room.
//
// Both marks here are near-flat on purpose. The narrowest section is 1.55m and
// its whole point is that you cannot sidestep, so the only things it can carry
// are things pressed INTO the stone. That constraint is enforced in data
// (level/corridor-decor.ts computes eligibility from footprint), but it is also
// why these two exist rather than another mound: they are the beats a squeeze
// is allowed to have.

/**
 * CLAW RAKE — four parallel grooves torn down a wall at chest height.
 *
 * Authored facing local +Z, like every other wall piece, so the placer rotates
 * it to face out of the stone. The grooves run slightly off-vertical and are
 * not evenly spaced; four fingers of something that was moving while it cut.
 *
 * Very shallow (0.03m proud) — this is a mark, not a prop. In a squeeze it sits
 * a hand's width from your shoulder as you pass, which is the entire idea.
 */
export const CLAW_RAKE: ModelSpec = {
  id: 'claw-rake',
  class: 'clutter',
  materials: {
    // Darker than any stone the shader produces, so it reads as depth rather
    // than as a painted-on stripe. No emissive: the lamp has to find it.
    groove: { color: 0x0a0806, roughness: 1.0, flatShading: true },
  },
  parts: [
    { kind: 'box', pos: [-0.17, 0.02, 0.015], size: [0.035, 0.62, 0.03], rot: [0, 0, 0.07], mat: 'groove' },
    { kind: 'box', pos: [-0.05, 0.00, 0.015], size: [0.040, 0.74, 0.03], rot: [0, 0, 0.04], mat: 'groove' },
    { kind: 'box', pos: [0.06, -0.02, 0.015], size: [0.038, 0.70, 0.03], rot: [0, 0, 0.02], mat: 'groove' },
    // The fourth is shorter and further out — the finger that lost purchase.
    { kind: 'box', pos: [0.19, -0.10, 0.014], size: [0.030, 0.44, 0.028], rot: [0, 0, -0.03], mat: 'groove' },
  ],
};

/**
 * DRAG SMEAR — a long dark streak along the floor, tapering at one end.
 *
 * The placer lays this ALONG the corridor's run and points the taper the way
 * the thing was going, which is the one piece of authoring a room's clutter
 * pass cannot do: a room has no direction, and a corridor is nothing but one.
 * Read it in the direction you're walking and something was dragged ahead of
 * you; read it behind and something was dragged out.
 *
 * Flat to 0.012m so you walk straight over it — it must never trip the vault
 * or read as a step. Its long axis is local Z.
 */
export const DRAG_SMEAR: ModelSpec = {
  id: 'drag-smear',
  class: 'clutter',
  materials: {
    // Old blood gone to rust-black. Warmer than the claw groove and much
    // lower contrast — you see it late, and only when your lamp is on it.
    smear: { color: 0x140b09, roughness: 1.0 },
  },
  parts: [
    { kind: 'box', pos: [0, 0.012, 0], size: [0.30, 0.008, 1.30], mat: 'smear' },
    // The taper: two narrower segments running on past the main body, so the
    // streak thins out instead of stopping square.
    { kind: 'box', pos: [0.03, 0.012, 0.85], size: [0.18, 0.008, 0.52], rot: [0, 0.05, 0], mat: 'smear' },
    { kind: 'box', pos: [0.06, 0.012, 1.24], size: [0.09, 0.008, 0.34], rot: [0, 0.09, 0], mat: 'smear' },
    // And a scuff off to one side where whatever it was caught the wall side.
    { kind: 'box', pos: [-0.16, 0.012, -0.34], size: [0.11, 0.008, 0.46], rot: [0, -0.12, 0], mat: 'smear' },
  ],
};
