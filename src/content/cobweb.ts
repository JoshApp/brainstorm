import type { ModelSpec } from '../ecs/model-types';

// Cobwebs — two flavours sharing the 'cobweb' procedural texture:
//
//   COBWEB_CORNER  — pure decoration. A faint web slung into a wall/
//                    ceiling corner. No collision. Placed by the
//                    surface-clutter pass.
//   COBWEB_BARRIER — a destructible curtain that PLUGS a passage until
//                    the player slashes through it. Wrapped by
//                    spawnCobweb (destructibles.ts) so it takes a swing
//                    and clears its collision on break. Author-placed
//                    with the '%' tile.
//
// Additive + low opacity so the threads read as gossamer catching the
// torchlight, not a solid sheet — grimdark restraint, and it never
// fully hides what's behind it.

export const COBWEB_CORNER: ModelSpec = {
  id: 'cobweb-corner',
  materials: {},
  parts: [
    // Single angled web quad. The 'cobweb' texture anchors its dense
    // hub at a corner of the quad; rot tilts it so the hub tucks into
    // the room corner and the web fans out across it.
    {
      kind: 'decal',
      pos: [0, 0, 0],
      rot: [0, 0, Math.PI * 0.25],
      size: [1.3, 1.3],
      texture: 'cobweb',
      color: 0xc8ccd2,
      blending: 'additive',
      opacity: 0.40,
      fog: false,
    },
  ],
};

export const COBWEB_BARRIER: ModelSpec = {
  id: 'cobweb-barrier',
  materials: {},
  parts: [
    // Layered curtain — three overlapping web quads at slightly
    // different scales/rolls so it reads as a dense, hand-strung wall
    // of web rather than one flat sheet. Centred ~1.2m up, spanning a
    // ~1.9m doorway. Faces the prop's local +Z; placement rotY aims it
    // across the passage.
    { kind: 'decal', pos: [0, 1.2, 0],    rot: [0, 0, 0.0],   size: [2.0, 2.5], texture: 'cobweb', color: 0xd2d6dc, blending: 'additive', opacity: 0.55, fog: false },
    { kind: 'decal', pos: [-0.1, 1.1, 0.02], rot: [0, 0, 1.9], size: [1.7, 2.2], texture: 'cobweb', color: 0xc4c8ce, blending: 'additive', opacity: 0.45, fog: false },
    { kind: 'decal', pos: [0.12, 1.3, -0.02], rot: [0, 0, 3.6], size: [1.5, 2.0], texture: 'cobweb', color: 0xbcc0c6, blending: 'additive', opacity: 0.40, fog: false },
  ],
};
