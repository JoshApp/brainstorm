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
// Collision is WIDTH-GATED (doorframeCollision below): wide openings get
// jamb blockers that match the visible stone; narrow ones stay collision-
// free because a 1m doorway can't spare the room — jamb blockers there
// would leave a knife-edge centre band (the soft-lock trap the archway
// threshold comment in clutter.ts documents). Emission sites attach
// `collision: doorframeCollision(width)` so geometry and blockers come
// from the same constants and can't drift.

export interface DoorframeOptions {
  /** Width of the opening this frames, in metres. Jambs sit just inside
   *  the edges. Default 1.0 (a single-cell doorway). */
  width?: number;
  /** Ceiling height of the surrounding room — the fill block rises from
   *  the lintel top to here so no void peeks above. Default 3.2m. */
  ceilingHeight?: number;
  /** Interior height of the passage behind the frame. When lower than
   *  the default lintel line the frame compresses so the lintel
   *  overlaps the passage ceiling — no void slit above a low tunnel's
   *  ceiling (same fix as ArchwayOptions.openHeight). */
  openHeight?: number;
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

// Jamb collision is worth having only when the opening can spare it.
// The passable centre band with jamb blockers is
//   width − 2·(2·JAMB_HALF_THICK) − 2·playerRadius = width − 0.96,
// so at 1.6m the band is 0.64m — just past the player's 0.6m diameter,
// and comfortably wide for every mob the nav grid routes through tight
// cells. Below the threshold the jambs stay ghost-thin to walk through
// (rare, and the divider wall still blocks everything but the gap).
const COLLISION_MIN_WIDTH = 1.6;

/** Walk-blockers matching the doorframe's jambs, or undefined when the
 *  opening is too narrow to spare the room (see COLLISION_MIN_WIDTH).
 *  Attach as the `collision` of the same prop that renders the model. */
export function doorframeCollision(
  width: number,
): import('../level/types').PropCollision[] | undefined {
  if (width < COLLISION_MIN_WIDTH) return undefined;
  const jambOffset = Math.max(JAMB_HALF_THICK + 0.01, width / 2 - JAMB_HALF_THICK);
  return [
    { kind: 'aabb', halfW: JAMB_HALF_THICK, halfD: JAMB_DEPTH / 2, ox: -jambOffset, oz: 0 },
    { kind: 'aabb', halfW: JAMB_HALF_THICK, halfD: JAMB_DEPTH / 2, ox: jambOffset, oz: 0 },
  ];
}

/** Half of the passable band through a doorframe, accounting for the
 *  collision policy: wide frames block at their jambs; narrow frames
 *  are collision-free with jambs OUTSIDE the gap, so the whole opening
 *  is the band. The NavGate half-width pathfinding funnels through. */
export function doorframePassableHalfBand(width: number): number {
  if (width < COLLISION_MIN_WIDTH) return width / 2;
  return Math.max(0.2, width / 2 - JAMB_HALF_THICK * 2);
}

export function doorframe(opts: DoorframeOptions = {}): ModelSpec {
  const width = opts.width ?? 1.0;
  const ceiling = opts.ceilingHeight ?? 3.2;
  // Jamb placement follows the collision policy so the VISUAL is honest:
  //   wide (>= COLLISION_MIN_WIDTH) — jambs inside the opening, outer face
  //     flush with the gap edge, and doorframeCollision blocks exactly them.
  //   narrow — jambs sit OUTSIDE the gap as pilasters flanking it (inner
  //     face flush with the edge). Nothing intrudes into the walk band, so
  //     "no collision" is what the eye already believes. (They used to sit
  //     inside at every width, which read as solid stone you could ghost
  //     through on every 1m door.)
  const inside = width >= COLLISION_MIN_WIDTH;
  const jambOffset = inside
    ? Math.max(JAMB_HALF_THICK + 0.01, width / 2 - JAMB_HALF_THICK)
    : width / 2 + JAMB_HALF_THICK;
  const lintelWidth = inside
    ? width + LINTEL_OVERHANG * 2
    : width + JAMB_HALF_THICK * 4 + LINTEL_OVERHANG * 2;
  const lintelBottom = opts.openHeight !== undefined
    ? Math.min(LINTEL_BOTTOM, opts.openHeight - 0.10)
    : LINTEL_BOTTOM;
  const lintelTop = lintelBottom + LINTEL_HEIGHT;
  const fillHeight = Math.max(0.1, ceiling - lintelTop);
  const fillCentreY = lintelTop + fillHeight / 2;

  const id = `doorframe-w${width.toFixed(2)}-c${ceiling.toFixed(1)}-o${lintelBottom.toFixed(2)}`;

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
      { kind: 'box', pos: [-jambOffset, lintelBottom / 2, 0], size: [JAMB_HALF_THICK * 2, lintelBottom, JAMB_DEPTH], mat: 'glow' },
      { kind: 'box', pos: [ jambOffset, lintelBottom / 2, 0], size: [JAMB_HALF_THICK * 2, lintelBottom, JAMB_DEPTH], mat: 'glow' },
      // Lintel across the top.
      { kind: 'box', pos: [0, lintelBottom + LINTEL_HEIGHT / 2, 0], size: [lintelWidth, LINTEL_HEIGHT, LINTEL_DEPTH], mat: 'glow' },
      // Fill above the lintel — closes the full-height void over the doorway.
      { kind: 'box', pos: [0, fillCentreY, 0], size: [lintelWidth, fillHeight, FILL_DEPTH], mat: 'stone' },
    ],
  };
}
