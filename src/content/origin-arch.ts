import type { ModelSpec } from '../ecs/model-types';

// Origin arch — the round-top archway on the wall behind every floor's
// threshold bonfire, holding TWO CLOSED timber doors. Closes the
// descent-continuity loop: at the bottom of the previous floor's
// stairwell stood this same arch with its doors AJAR and the fire
// shimmering through the crack (interactables/stairs.ts, "THE DOORS");
// you passed through, and they closed behind you. Same leaves, same
// iron bands — shut. Pure set dressing — no collision (it sits flush
// against a wall), no interaction. They do not open from this side.
//
// Authoring axes (matches archway.ts):
//   +X along the wall, +Y up, +Z out of the wall toward the room.
// Place flush against a wall, rotY so +Z faces the bonfire.

const ARCH_W = 1.5;          // clear opening width
const SPRING = 1.55;         // jamb height / where the arc springs
const RISE = 0.55;           // crown rise above the spring
const JAMB_W = 0.18;
const DEPTH = 0.30;          // how far the frame stands proud of the wall
const LEAF_H = SPRING + RISE * 0.45;   // door tops tuck behind the crown

export const ORIGIN_ARCH: ModelSpec = {
  id: 'origin-arch',
  materials: {
    stone: { color: 0x232027, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
    // Door leaves + bands — same palette as the stairwell's ajar pair
    // (style timber / dark iron), so the player recognises the doors.
    timber: { color: 0x3a2a18, roughness: 1.0, metalness: 0.0, flatShading: true },
    iron: { color: 0x15171b, roughness: 0.55, metalness: 0.55, flatShading: true },
    // Thin dark seam between/around the closed leaves.
    void: { color: 0x05060a, roughness: 1.0, metalness: 0.0, emissive: 0x05060a, emissiveIntensity: 1.0 },
  },
  parts: [
    // Jambs.
    { kind: 'box', pos: [-(ARCH_W / 2 + JAMB_W / 2), SPRING / 2, 0], size: [JAMB_W, SPRING, DEPTH], mat: 'stone' },
    { kind: 'box', pos: [ARCH_W / 2 + JAMB_W / 2, SPRING / 2, 0], size: [JAMB_W, SPRING, DEPTH], mat: 'stone' },
    // Crown — three wedges arcing over the opening.
    { kind: 'box', pos: [-ARCH_W * 0.27, SPRING + RISE * 0.55, 0], size: [ARCH_W * 0.36, 0.18, DEPTH * 0.9], rot: [0, 0, 0.55], mat: 'stone' },
    { kind: 'box', pos: [ARCH_W * 0.27, SPRING + RISE * 0.55, 0], size: [ARCH_W * 0.36, 0.18, DEPTH * 0.9], rot: [0, 0, -0.55], mat: 'stone' },
    { kind: 'box', pos: [0, SPRING + RISE, 0], size: [ARCH_W * 0.32, 0.20, DEPTH], mat: 'stone' },
    // Dark backing panel — the hair of shadow framing the closed leaves,
    // recessed behind them so the doors read as set INTO the wall.
    { kind: 'box', pos: [0, (SPRING + RISE * 0.5) / 2, -DEPTH * 0.30], size: [ARCH_W, SPRING + RISE * 0.5, 0.05], mat: 'void' },
    // THE CLOSED DOORS — two leaves filling the opening, a thin seam
    // between them. The same pair that stood ajar at the bottom of the
    // stairwell you just descended; they closed behind you.
    { kind: 'box', pos: [-(ARCH_W / 4 + 0.005), LEAF_H / 2, -DEPTH * 0.12], size: [ARCH_W / 2 - 0.015, LEAF_H, 0.08], mat: 'timber' },
    { kind: 'box', pos: [ARCH_W / 4 + 0.005, LEAF_H / 2, -DEPTH * 0.12], size: [ARCH_W / 2 - 0.015, LEAF_H, 0.08], mat: 'timber' },
    // Iron bands — two per leaf, matching the stairwell pair.
    { kind: 'box', pos: [-(ARCH_W / 4), LEAF_H * 0.28, -DEPTH * 0.12 + 0.01], size: [ARCH_W / 2 - 0.05, 0.07, 0.085], mat: 'iron' },
    { kind: 'box', pos: [ARCH_W / 4, LEAF_H * 0.28, -DEPTH * 0.12 + 0.01], size: [ARCH_W / 2 - 0.05, 0.07, 0.085], mat: 'iron' },
    { kind: 'box', pos: [-(ARCH_W / 4), LEAF_H * 0.72, -DEPTH * 0.12 + 0.01], size: [ARCH_W / 2 - 0.05, 0.07, 0.085], mat: 'iron' },
    { kind: 'box', pos: [ARCH_W / 4, LEAF_H * 0.72, -DEPTH * 0.12 + 0.01], size: [ARCH_W / 2 - 0.05, 0.07, 0.085], mat: 'iron' },
  ],
};
