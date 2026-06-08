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
// Opaque alpha-CUTOUT threads (not alpha-blended): the gaps are discarded, so
// the web is real geometry — lit by torchlight, and the BARRIER casts a real
// thread-shaped shadow. This is the robust path; stacked transparent quads were
// mis-rendering as a dark sticker on mobile tile GPUs. Muted dusty grey keeps it
// grimdark (a long-undisturbed web), not bright cotton.

const WEB_GREY = 0x9aa0a8;
const WEB_CUT = 0.18;   // keep spokes (a 0.42) + rings (a 0.30), discard gaps

export const COBWEB_CORNER: ModelSpec = {
  id: 'cobweb-corner',
  materials: {},
  parts: [
    // Single angled web quad. The 'cobweb' texture anchors its dense
    // hub at a corner of the quad; rot tilts it so the hub tucks into
    // the room corner and the web fans out across it. Cosmetic — no shadow.
    {
      kind: 'decal',
      pos: [0, 0, 0],
      rot: [0, 0, Math.PI * 0.25],
      size: [1.3, 1.3],
      texture: 'cobweb',
      color: WEB_GREY,
      alphaTest: WEB_CUT,
      castShadow: false,
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
    { kind: 'decal', pos: [0, 1.2, 0],    rot: [0, 0, 0.0],   size: [2.0, 2.5], texture: 'cobweb', color: WEB_GREY, alphaTest: WEB_CUT, castShadow: true },
    { kind: 'decal', pos: [-0.1, 1.1, 0.02], rot: [0, 0, 1.9], size: [1.7, 2.2], texture: 'cobweb', color: 0x8e949c, alphaTest: WEB_CUT, castShadow: true },
    { kind: 'decal', pos: [0.12, 1.3, -0.02], rot: [0, 0, 3.6], size: [1.5, 2.0], texture: 'cobweb', color: 0x868c94, alphaTest: WEB_CUT, castShadow: true },
  ],
};
