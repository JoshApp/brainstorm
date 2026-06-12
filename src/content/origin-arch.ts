import type { ModelSpec } from '../ecs/model-types';

// Origin arch — the SEALED round-top archway on the wall behind every
// floor's threshold bonfire. Closes the descent-continuity loop: at the
// bottom of the previous floor's stairwell you saw this same arch with
// the fire burning beyond it (interactables/stairs.ts, "THE FIRE
// BELOW"); now you are on the other side, the fire at your back, and
// the way you came is dark and shut. Pure set dressing — no collision
// (it sits flush against a wall), no interaction. The dungeon does not
// do round trips.
//
// Authoring axes (matches archway.ts):
//   +X along the wall, +Y up, +Z out of the wall toward the room.
// Place flush against a wall, rotY so +Z faces the bonfire.

const ARCH_W = 1.5;          // clear opening width
const SPRING = 1.55;         // jamb height / where the arc springs
const RISE = 0.55;           // crown rise above the spring
const JAMB_W = 0.18;
const DEPTH = 0.30;          // how far the frame stands proud of the wall

export const ORIGIN_ARCH: ModelSpec = {
  id: 'origin-arch',
  materials: {
    stone: { color: 0x232027, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
    // The sealed dark inside the arch — not quite black: the faintest
    // cold memory of the way back, never brighter than the lamp.
    void: { color: 0x05060a, roughness: 1.0, metalness: 0.0, emissive: 0x05060a, emissiveIntensity: 1.0 },
    rubble: { color: 0x1b1715, roughness: 1.0, flatShading: true },
  },
  parts: [
    // Jambs.
    { kind: 'box', pos: [-(ARCH_W / 2 + JAMB_W / 2), SPRING / 2, 0], size: [JAMB_W, SPRING, DEPTH], mat: 'stone' },
    { kind: 'box', pos: [ARCH_W / 2 + JAMB_W / 2, SPRING / 2, 0], size: [JAMB_W, SPRING, DEPTH], mat: 'stone' },
    // Crown — three wedges arcing over the opening.
    { kind: 'box', pos: [-ARCH_W * 0.27, SPRING + RISE * 0.55, 0], size: [ARCH_W * 0.36, 0.18, DEPTH * 0.9], rot: [0, 0, 0.55], mat: 'stone' },
    { kind: 'box', pos: [ARCH_W * 0.27, SPRING + RISE * 0.55, 0], size: [ARCH_W * 0.36, 0.18, DEPTH * 0.9], rot: [0, 0, -0.55], mat: 'stone' },
    { kind: 'box', pos: [0, SPRING + RISE, 0], size: [ARCH_W * 0.32, 0.20, DEPTH], mat: 'stone' },
    // The sealed dark — an inset panel filling the opening, recessed
    // behind the frame so the arch reads as depth, not paint.
    { kind: 'box', pos: [0, (SPRING + RISE * 0.5) / 2, -DEPTH * 0.25], size: [ARCH_W, SPRING + RISE * 0.5, 0.06], mat: 'void' },
    // Rubble across the threshold — the way back did not survive you.
    { kind: 'box', pos: [-0.35, 0.10, 0.16], size: [0.42, 0.22, 0.30], rot: [0, 0.5, 0.08], mat: 'rubble' },
    { kind: 'box', pos: [0.25, 0.08, 0.20], size: [0.34, 0.17, 0.26], rot: [0, -0.8, -0.06], mat: 'rubble' },
    { kind: 'box', pos: [-0.02, 0.06, 0.34], size: [0.22, 0.12, 0.18], rot: [0, 1.2, 0], mat: 'rubble' },
    { kind: 'box', pos: [0.52, 0.05, 0.05], size: [0.18, 0.10, 0.16], rot: [0, 0.3, 0], mat: 'rubble' },
  ],
};
