import type { Poly } from './room-shape';
import { PILASTER } from './poly-dressing';
import { MIN_WALKABLE_WIDTH } from './corridor-types';

// ── A ROOM SAYS WHERE ITS DOORS CAN BE ───────────────────────────────────────
//
// Josh: *"a room can declare possible anchors... portal carving becomes a
// problem of the room itself, and that way we can also do way better opening
// entrance geometry."*
//
// The full model is docs/SPACES-AND-THRESHOLDS.md. This file is step 1 of it:
// a room publishes the openings its own walls can afford, BEFORE any corridor
// exists to come looking for one.
//
// ── WHY, MEASURED ────────────────────────────────────────────────────────────
//
// Today a doorway is wherever a corridor rect happened to cross a wall line,
// and the corridor has no idea what it is crossing. Over 656 doorways on 48
// floors:
//
//   35% OVERLAP A CORNER — the fifth percentile is −1.52m, a doorway wrapping a
//   metre and a half PAST the corner and around onto the next wall.
//   39% have their edge within 0.3m of one.
//
// A door straddling a corner has no flat wall to be a door in. That is the
// chamfered-corner opening that `planPortals` had to grow multi-edge `cuts`
// for; it is the frame that cannot sit flat; it is the stone door photographed
// inset into a winding passage. All one cause.
//
// A wall knows where its own corners are. Nothing else does.
//
// ── WHAT AN ANCHOR PROMISES ──────────────────────────────────────────────────
//
// A RANGE, not a number. A fixed width makes every mismatch a conflict somebody
// loses; a range makes most of them agree, because the two bands overlap and
// any width inside the overlap suits both sides. The layout intersects the two
// anchors it is joining and takes the width its corridor section wants, clamped
// into the overlap.
//
// The range is DERIVED, never typed in: the flat run left on the edge after its
// corners are respected sets the max, and MIN_WALKABLE_WIDTH sets the min. An
// edge with no room for the min publishes nothing — which is how a wall says
// "not through here" without anybody writing a special case for it.

export interface PortalAnchor {
  id: string;
  /** The space this anchor belongs to. */
  space: string;
  /** Index of the polygon edge it sits on. */
  edge: number;
  /** Midpoint of the usable run, in world metres. */
  at: readonly [number, number];
  /** Unit normal, pointing OUT of the polygon. */
  normal: readonly [number, number];
  /** The usable run as distances along the edge from its start vertex. A door
   *  may sit anywhere inside this; the layout decides where. */
  t0: number;
  t1: number;
  /** [min, max] clear width this wall can afford. */
  width: readonly [number, number];
  /** [min, max] clear height. Capped by the space's own height — an opening
   *  cannot be taller than the wall it is cut into. */
  height: readonly [number, number];
}

/**
 * STONE THAT MUST REMAIN BETWEEN A DOORWAY AND A CORNER, metres.
 *
 * Derived from the two things that actually constrain it, so it moves if either
 * does rather than being a number somebody liked:
 *
 *   - half a pilaster (`PILASTER.width / 2`) — the dressing puts an engaged
 *     pier at wall ends, and a doorway cut through where the pier stands leaves
 *     the pier floating, which is issue #154 all over again;
 *   - the wall ring's own `minSpan` (0.14) — a remainder thinner than that is
 *     dropped as z-fighting rather than built, so a door that leaves less than
 *     it has effectively eaten the corner anyway.
 *
 * 0.21 + 0.14 = 0.35m. That is the hard floor. `COMFORT` above it is a separate
 * and softer claim — a door with only the structural minimum beside it still
 * reads as jammed into the corner — and is kept separate precisely so the two
 * can be argued about independently.
 */
export const CORNER_STRUCTURAL = PILASTER.width / 2 + 0.14;
export const CORNER_COMFORT = 0.35;
export const CORNER_CLEAR = CORNER_STRUCTURAL + CORNER_COMFORT;

/** The shortest edge that can host anything: clearance at both ends plus the
 *  narrowest opening a body can pass. Anything under this publishes nothing. */
export const MIN_HOSTING_EDGE = 2 * CORNER_CLEAR + MIN_WALKABLE_WIDTH;

/**
 * Every opening this polygon's walls can afford.
 *
 * Pure and THREE-free. Derived from the shape alone — no corridors, no layout,
 * nothing that has to exist first. That is the whole point: the wall answers
 * before it is asked.
 *
 * Winding order is assumed counter-clockwise, as `room-shape.ts` produces; the
 * outward normal is taken accordingly and checked against the polygon's own
 * signed area so a clockwise ring cannot silently invert every door in the room.
 */
export function deriveAnchors(
  spaceId: string, poly: Poly, height: number,
  opts: { minHeight?: number } = {},
): PortalAnchor[] {
  const out: PortalAnchor[] = [];
  const ccw = signedArea(poly) > 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < MIN_HOSTING_EDGE) continue;

    const t0 = CORNER_CLEAR, t1 = len - CORNER_CLEAR;
    const run = t1 - t0;
    if (run < MIN_WALKABLE_WIDTH) continue;

    const ux = dx / len, uz = dz / len;
    const mid = (t0 + t1) / 2;
    // Outward normal: for a counter-clockwise ring the outside is to the RIGHT
    // of the travel direction.
    const nx = ccw ? uz : -uz;
    const nz = ccw ? -ux : ux;

    out.push({
      id: `${spaceId}#a${i}`,
      space: spaceId,
      edge: i,
      at: [a[0] + ux * mid, a[1] + uz * mid],
      normal: [nx, nz],
      t0,
      t1,
      // The widest this wall can hold is its whole flat run. The layout will
      // almost never want that much — it takes what its section asks for,
      // clamped into the overlap with the other side — but the wall's job is to
      // state what it CAN do, not to guess what will be wanted.
      width: [MIN_WALKABLE_WIDTH, run],
      height: [opts.minHeight ?? 2.0, height],
    });
  }
  return out;
}

/** Does this anchor face the given direction, within a right angle? */
export function facesToward(
  anchor: PortalAnchor, dx: number, dz: number,
): boolean {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  return (anchor.normal[0] * dx + anchor.normal[1] * dz) / len > 0.35;
}

function signedArea(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  }
  return s / 2;
}
