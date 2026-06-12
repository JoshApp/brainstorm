import type { ModelSpec } from '../ecs/model-types';

// Origin arch — the round-top archway holding TWO CLOSED timber doors,
// placed on the wall behind every floor's spawn point. Closes the
// descent-continuity loop: at the bottom of the previous floor's
// stairwell stood the same doors AJAR with firelight through the crack
// (interactables/stairs.ts, "THE DOORS"); you passed through, and they
// shut at your back. Pure set dressing — no collision (flush against a
// wall), no interaction. They do not open from this side.
//
// Built CHUNKY on purpose: deep jambs standing proud of the wall, a
// real five-stone voussoir arc, plank leaves with depth jitter, iron
// straps and pull rings — at spawn the player stands 3-4m away in a
// lit room, so the doorway must read as architecture against the brick,
// not as a few pasted tiles (the first pass's failure, from the field).
//
// Authoring axes (matches archway.ts):
//   +X along the wall, +Y up, +Z out of the wall toward the room.

const OPEN_W = 1.9;            // clear opening width
const LEAF_H = 2.15;           // door leaves / where the arc springs
const JAMB_W = 0.24;
const JAMB_D = 0.36;           // depth — stands ~0.18 proud of the wall
const ARC_R = OPEN_W / 2 + 0.10;
const ARC_SQUASH = 0.66;       // circular → romanesque flattened arc

// Voussoir arc — five stones on the arc, tangent-rotated. Generated as
// data so the arc is one constant away from rounder/flatter.
const VOUSSOIRS = [22, 56, 90, 124, 158].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const cx = Math.cos(a) * ARC_R;
  const cy = LEAF_H + Math.sin(a) * ARC_R * ARC_SQUASH;
  return {
    kind: 'box' as const,
    pos: [cx, cy, 0.14] as [number, number, number],
    size: (deg === 90 ? [0.42, 0.34, 0.34] : [0.46, 0.28, 0.30]) as [number, number, number],
    rot: [0, 0, a - Math.PI / 2] as [number, number, number],
    mat: 'stone',
  };
});

// Plank leaves — three planks each with depth jitter so the wood reads
// as boards, not a slab. Leaf spans from centre seam to jamb.
const PLANKS = [-1, 1].flatMap((side) => [0, 1, 2].map((i) => {
  const plankW = OPEN_W / 6 - 0.012;
  const x = side * (0.04 + plankW / 2 + i * (plankW + 0.012));
  const z = 0.08 + (i % 2) * 0.025;    // alternate depth — board relief (all PROUD of the wall)
  return {
    kind: 'box' as const,
    pos: [x, LEAF_H / 2, z] as [number, number, number],
    size: [plankW, LEAF_H, 0.10] as [number, number, number],
    mat: 'timber',
  };
}));

export const ORIGIN_ARCH: ModelSpec = {
  id: 'origin-arch',
  materials: {
    // Dressed framing stone — deliberately LIGHTER than the wall brick
    // so the doorway separates from the masonry it sits in.
    stone: { color: 0x3a363e, roughness: 0.92, metalness: 0.0, flatShading: true, detail: 'dressed' },
    timber: { color: 0x5c4326, roughness: 1.0, metalness: 0.0, flatShading: true },
    iron: { color: 0x17191d, roughness: 0.5, metalness: 0.6, flatShading: true },
    // The hair of dark framing the recessed leaves.
    void: { color: 0x05060a, roughness: 1.0, metalness: 0.0, emissive: 0x05060a, emissiveIntensity: 1.0 },
  },
  parts: [
    // Jambs with plinth feet.
    { kind: 'box', pos: [-(OPEN_W / 2 + JAMB_W / 2), LEAF_H / 2 + 0.1, 0.12], size: [JAMB_W, LEAF_H + 0.2, JAMB_D], mat: 'stone' },
    { kind: 'box', pos: [OPEN_W / 2 + JAMB_W / 2, LEAF_H / 2 + 0.1, 0.12], size: [JAMB_W, LEAF_H + 0.2, JAMB_D], mat: 'stone' },
    { kind: 'box', pos: [-(OPEN_W / 2 + JAMB_W / 2), 0.14, 0.15], size: [JAMB_W + 0.12, 0.28, JAMB_D + 0.10], mat: 'stone' },
    { kind: 'box', pos: [OPEN_W / 2 + JAMB_W / 2, 0.14, 0.15], size: [JAMB_W + 0.12, 0.28, JAMB_D + 0.10], mat: 'stone' },
    // Worn threshold sill across the opening.
    { kind: 'box', pos: [0, 0.045, 0.18], size: [OPEN_W + 0.10, 0.09, 0.42], mat: 'stone' },
    // The voussoir arc.
    ...VOUSSOIRS,
    // Dark backing — shadow gap behind the recessed leaves and filling
    // the lunette under the arc.
    { kind: 'box', pos: [0, (LEAF_H + ARC_R * ARC_SQUASH * 0.9) / 2, 0.02], size: [OPEN_W, LEAF_H + ARC_R * ARC_SQUASH * 0.9, 0.04], mat: 'void' },
    // THE CLOSED LEAVES — recessed into the reveal.
    ...PLANKS,
    // Iron bands — two per leaf, sitting proud of the planks.
    { kind: 'box', pos: [-(OPEN_W / 4 + 0.02), 0.50, 0.15], size: [OPEN_W / 2 - 0.06, 0.085, 0.05], mat: 'iron' },
    { kind: 'box', pos: [OPEN_W / 4 + 0.02, 0.50, 0.15], size: [OPEN_W / 2 - 0.06, 0.085, 0.05], mat: 'iron' },
    { kind: 'box', pos: [-(OPEN_W / 4 + 0.02), 1.70, 0.15], size: [OPEN_W / 2 - 0.06, 0.085, 0.05], mat: 'iron' },
    { kind: 'box', pos: [OPEN_W / 4 + 0.02, 1.70, 0.15], size: [OPEN_W / 2 - 0.06, 0.085, 0.05], mat: 'iron' },
    // Hinge straps — tapering from the jambs onto the leaves.
    { kind: 'box', pos: [-(OPEN_W / 2 - 0.17), 1.10, 0.15], size: [0.34, 0.07, 0.05], mat: 'iron' },
    { kind: 'box', pos: [OPEN_W / 2 - 0.17, 1.10, 0.15], size: [0.34, 0.07, 0.05], mat: 'iron' },
    // Pull rings — one per leaf, flanking the centre seam.
    { kind: 'torus', pos: [-0.18, 1.04, 0.17], radius: 0.085, tube: 0.022, rot: [Math.PI / 2 - 0.5, 0, 0], mat: 'iron' },
    { kind: 'torus', pos: [0.18, 1.04, 0.17], radius: 0.085, tube: 0.022, rot: [Math.PI / 2 - 0.5, 0, 0], mat: 'iron' },
  ],
};
