import type { ModelSpec } from '../ecs/model-types';
import { DOMAINS } from './domains';

// THE RITE SIGIL — what a rite looks like lying on the floor.
//
// Josh: *"rites need to be items that you can kinda find / pick up. similar to
// relics with 2.5d etc. very similar but distinct to it."*
//
// SIMILAR: it's a found object on the ground with a domain colour and a glow,
// picked up the same way, previewed on the same card.
//
// DISTINCT, and the distinction is the point — the player has to know at a
// glance which of the two they're looking at, because one is a passive you
// hoard and the other is an active you choose between:
//
//   A RELIC is jewellery. Round, small, organic, worn — a vertebra on a cord,
//   a slime's core. It reads as something taken off a body.
//
//   A RITE is a TABLET. Upright, flat, angular, cut by hands — a slab of dark
//   stone with a burning glyph sunk into its face. It reads as something
//   INSCRIBED, which is what a rite is: an instruction the deep left behind.
//
// Standing upright rather than lying flat is most of the read at distance: in a
// room of scattered round pickups, the one thing standing on its edge is the
// silhouette that doesn't belong to the floor. The glyph is the only emissive
// part, tinted to the rite's domain, so it obeys the lighting rule — an unusual
// light means something is there (docs/VISUAL-LANGUAGE.md), and a rite is
// exactly the sort of thing that earns one.

/** Slab dimensions, metres. Tall-and-thin so it reads as standing, not lying. */
const W = 0.30, H = 0.42, T = 0.075;

/**
 * Build the sigil for one rite, tinted by its domain.
 *
 * Per-rite rather than one shared model so the colour is baked in — every other
 * found object in DELVE announces its domain by colour before you can read its
 * name, and a rack of identical grey tablets would be the one exception.
 */
export function riteSigilModel(domainId: string): ModelSpec {
  const domain = (DOMAINS as Record<string, { color?: number } | undefined>)[domainId];
  const glow = domain?.color ?? 0xffcf8a;
  return {
    id: `rite-sigil-${domainId}`,
    materials: {
      // Dark cut stone. Near-black albedo so the glyph is the only bright thing
      // on it — the same ABSORBED treatment the mundane creatures use.
      slab: { color: 0x141118, roughness: 0.95, metalness: 0, flatShading: 'auto' },
      // The chiselled bevel catches a highlight, so the slab reads as WORKED
      // stone rather than a rock. One shade up and a touch glossier is enough.
      edge: { color: 0x2a2430, roughness: 0.6, metalness: 0.1, flatShading: 'auto' },
      // The inscription. The only emissive on the object.
      glyph: { color: glow, emissive: glow, emissiveIntensity: 2.2 },
    },
    // EVERYTHING HANGS OFF THE SLAB, and only the slab is rotated.
    //
    // The first version gave every part the SAME `rot` instead of parenting
    // them, which is not the same thing at all: `rot` spins a part about its own
    // origin and leaves its `pos` where it was, so the slab leaned away while
    // the glyph stayed put and ended up buried inside it. The bench caught it in
    // one render — the FRONT view was a blank stone and the glyph was peeking
    // out of the SIDE. Parenting is what makes a lean move the whole object.
    parts: [
      // The slab, stood on end and leaned back a hair so it never reads as a
      // perfectly-placed prop — everything down here has been knocked about.
      { name: 'slab', kind: 'box', size: [W, H, T], pos: [0, H / 2, 0], rot: [-0.09, 0.22, 0.05], bevel: 0.012, mat: 'slab', jitter: 0.006 },
      // A chiselled rim top and bottom, so the light finds an edge. Positions
      // are now relative to the slab's own centre.
      { parent: 'slab', kind: 'box', size: [W * 0.96, 0.022, T * 1.15], pos: [0, H * 0.46, 0], mat: 'edge' },
      { parent: 'slab', kind: 'box', size: [W * 0.96, 0.022, T * 1.15], pos: [0, -H * 0.44, 0], mat: 'edge' },
      // THE GLYPH — three cuts, deliberately not a symmetric rune. A cross or a
      // circle would read as a UI icon stuck on a rock; an off-balance mark
      // reads as language you don't happen to speak.
      //
      // At NEGATIVE Z, which is the whole of failure mode #1 in one line: a
      // model's front in this codebase faces −Z (CLAUDE.md's coordinate
      // convention), so a glyph at +Z is carved into the BACK of the tablet. The
      // bench showed a blank stone from the front and the mark peeking round the
      // side; the arithmetic was right and the axis was wrong. Proud of the face
      // by more than the slab's half-thickness so it catches its own light.
      { parent: 'slab', kind: 'box', size: [0.020, H * 0.44, 0.012], pos: [-0.018, H * 0.04, -T * 0.62], mat: 'glyph' },
      { parent: 'slab', kind: 'box', size: [0.115, 0.020, 0.012], pos: [0.010, H * 0.12, -T * 0.62], rot: [0, 0, -0.38], mat: 'glyph' },
      { parent: 'slab', kind: 'box', size: [0.068, 0.018, 0.012], pos: [0.022, -H * 0.14, -T * 0.62], rot: [0, 0, 0.30], mat: 'glyph' },
    ],
  };
}
