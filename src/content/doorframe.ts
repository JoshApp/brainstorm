import type { ModelSpec } from '../ecs/model-types';

// Doorframe — the LIGHT cousin of the corridor archway (content/archway.ts).
// Where the archway is an ornate gate for wide corridor mouths (columns with
// plinths + capitals + keystone), the doorframe is a plain stone surround for
// a NARROW opening: a doorway punched through an interior wall divider, a
// sealed door, a cobweb-gated choke.
//
// Why it exists: an opening carved in a thin wall shows the wall's bare
// cross-section — a flat "paper" edge orthogonal to the passage. The frame
// hides that edge: slim jambs give the opening visible depth, a lintel caps
// it, and a fill block closes the void above (the door cell is floor, so the
// divider wall has a full-height GAP there that would otherwise reveal the
// dark behind the wall).
//
// Authoring axes (same convention as archway.ts):
//   - +X = along the lintel (the opening's running direction / the wall line)
//   - +Y = up
//   - +Z = INTO the passage (through the gate)
// The placer sets rotY so +X aligns with the wall the opening sits in.
//
// No collision is emitted: the divider wall already blocks; the opening must
// stay passable, and a 1m doorway can't spare room for column blockers.

export interface DoorframeOptions {
  /** Width of the opening this frames, in metres. Jambs sit just inside
   *  the edges. Default 1.0 (a single-cell doorway). */
  width?: number;
  /** Ceiling height of the surrounding room — the fill block rises from
   *  the lintel top to here so no void peeks above. Default 3.2m. */
  ceilingHeight?: number;
}

const JAMB_HALF_THICK = 0.09;     // half the jamb's size along the wall (X)
const JAMB_DEPTH      = 0.55;     // depth along the passage (Z) — gives mass
const LINTEL_BOTTOM   = 2.60;     // clear opening height (a door is 2.6 tall)
const LINTEL_HEIGHT   = 0.24;
const LINTEL_DEPTH    = 0.60;
const LINTEL_OVERHANG = 0.08;     // lintel extends past the jambs each side
// The fill block caps the void above the lintel. Deep enough (Z) to cover a
// one-cell-thick divider from both faces; the overshoot sits up in the dark
// ceiling where it's never seen.
const FILL_DEPTH      = 1.10;

const LINTEL_TOP = LINTEL_BOTTOM + LINTEL_HEIGHT;

export function doorframe(opts: DoorframeOptions = {}): ModelSpec {
  const width = opts.width ?? 1.0;
  const ceiling = opts.ceilingHeight ?? 3.2;
  // Jamb centre: outer face flush with the opening edge.
  const jambOffset = Math.max(JAMB_HALF_THICK + 0.01, width / 2 - JAMB_HALF_THICK);
  const lintelWidth = width + LINTEL_OVERHANG * 2;
  const fillHeight = Math.max(0.1, ceiling - LINTEL_TOP);
  const fillCentreY = LINTEL_TOP + fillHeight / 2;

  const id = `doorframe-w${width.toFixed(2)}-c${ceiling.toFixed(1)}`;

  return {
    id,
    materials: {
      stone: { color: 0x231d16, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
      // Same 'glow' contract as the archway: emissive 0 at rest, raised by the
      // threshold proximity system so the frame warms as the player nears,
      // marking the way through (see builder's proximityGlow handling).
      glow: { color: 0x231d16, roughness: 1.0, metalness: 0.0, flatShading: true, emissive: 0xff8c3a, emissiveIntensity: 0, detail: 'dressed' },
    },
    parts: [
      // Side jambs — slim posts framing the opening, with depth so the thin
      // divider reads as a doorway you pass THROUGH, not a hole in paper.
      { kind: 'box', pos: [-jambOffset, LINTEL_BOTTOM / 2, 0], size: [JAMB_HALF_THICK * 2, LINTEL_BOTTOM, JAMB_DEPTH], mat: 'glow' },
      { kind: 'box', pos: [ jambOffset, LINTEL_BOTTOM / 2, 0], size: [JAMB_HALF_THICK * 2, LINTEL_BOTTOM, JAMB_DEPTH], mat: 'glow' },
      // Lintel across the top.
      { kind: 'box', pos: [0, LINTEL_BOTTOM + LINTEL_HEIGHT / 2, 0], size: [lintelWidth, LINTEL_HEIGHT, LINTEL_DEPTH], mat: 'glow' },
      // Fill above the lintel — closes the full-height void over the doorway.
      { kind: 'box', pos: [0, fillCentreY, 0], size: [lintelWidth, fillHeight, FILL_DEPTH], mat: 'stone' },
    ],
  };
}
