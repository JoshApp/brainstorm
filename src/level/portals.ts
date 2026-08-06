import { clipEdgeToRect, edgeNormal, type Ring, type V2 } from './poly-shell-plan';

// ── ONE OPENING, COMPUTED ONCE ───────────────────────────────────────────────
//
// A doorway is a hole in a wall, and until now TWO different systems each
// decided where that hole was, from two different inputs, and they disagreed.
//
//   THE ROOM SIDE (`planWallRing`) clips the corridor RECT against the real
//   polygon edge — and inflates the rect by the wall thickness first, so the
//   room's gap comes out 2×0.25m WIDER than the corridor is.
//
//   THE CORRIDOR SIDE (`findOpenings`) removes its end cap wherever the room's
//   BOUNDING BOX crosses the corridor's wall line — with no padding, and with no
//   knowledge of the polygon at all. A poly room's real wall sits back from its
//   bbox, sometimes by metres.
//
// Two consequences, and they are exactly what Josh reported walking a floor:
//
//   SEE-THROUGH GAPS. The room's doorway is a quarter of a metre wider than the
//   corridor on each side, so there is a slot where neither the room's wall nor
//   the corridor's wall exists. You look through it into nothing.
//
//   WALLS LEAKING TOO FAR OR NOT FAR ENOUGH. The corridor's cap opens the moment
//   it enters the room's bounding box, which can be well short of the actual
//   wall; and where the polygon bulges out past the corridor's stop, the room's
//   wall is cut while the corridor's cap is still there.
//
// A PORTAL is that hole, computed once from the real geometry — the corridor's
// cross-section intersected with the actual polygon edge — and handed to
// everything that needs to agree about it: the room's wall ring, the corridor's
// end cap, and the archway that gets mounted in it.
//
// It carries a NORMAL and a MIDPOINT for the same reason. The rect-based
// emitter could only place an archway on one of four axis-aligned sides; a
// portal knows the edge it was cut from, so a doorway in a chamfered wall gets a
// frame square to that wall instead of square to the world.
//
// Pure — no THREE, no scene — so the agreement between the two sides is a
// property of the numbers and a test can assert it without a renderer.

export interface Rect { x: number; z: number; w: number; d: number }

export interface Portal {
  roomId: string;
  corridorId: string;
  /** Index of the polygon edge this hole is cut from. */
  edge: number;
  /** The hole's ends, ON the room's inner outline, world XZ. */
  a: V2;
  b: V2;
  /** Midpoint — where an archway or a threshold draft is mounted. */
  mid: V2;
  /** The wall's outward normal at this edge. An archway faces along it. */
  normal: V2;
  /** Yaw for a model whose lintel runs along its local X, mounted in this hole.
   *  Derived from the normal, so a chamfered wall gets a square frame. */
  rotY: number;
  /** Hole width in metres, measured along the edge. */
  width: number;
  /** The hole as an edge-local span, 0..1 — what the wall ring cuts. */
  t0: number;
  t1: number;
}

/** Widths below this are build noise (a corridor kissing a corner), not a way
 *  through. The wall ring already drops spans shorter than 0.14m. */
const MIN_WIDTH = 0.7;

/**
 * Every hole in this room's wall, one per corridor that actually reaches it.
 *
 * A corridor can graze several edges at a corner; the portal is taken on the
 * edge it covers MOST, because that is the one it comes through. Taking all of
 * them would punch a second doorway in the wall around the corner.
 */
export function planPortals(
  roomId: string,
  poly: Ring,
  corridors: ReadonlyArray<{ id: string; rect: Rect }>,
): Portal[] {
  const out: Portal[] = [];
  for (const c of corridors) {
    let best: { edge: number; t0: number; t1: number; len: number } | null = null;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (edgeLen < 1e-4) continue;
      // NO PADDING. The hole is where the corridor actually is — the wall ring
      // used to inflate this by the wall thickness, which is the quarter-metre
      // slot on each side of every doorway.
      const hit = clipEdgeToRect(a, b, c.rect, 0);
      if (!hit) continue;
      const span = (hit[1] - hit[0]) * edgeLen;
      if (!best || span > best.len) best = { edge: i, t0: hit[0], t1: hit[1], len: span };
    }
    if (!best || best.len < MIN_WIDTH) continue;

    const a = poly[best.edge], b = poly[(best.edge + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const pa: V2 = [a[0] + dx * best.t0, a[1] + dz * best.t0];
    const pb: V2 = [a[0] + dx * best.t1, a[1] + dz * best.t1];
    const nrm = edgeNormal(poly, best.edge);
    out.push({
      roomId, corridorId: c.id, edge: best.edge,
      a: pa, b: pb,
      mid: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2],
      normal: nrm,
      // A lintel runs ALONG the wall, i.e. perpendicular to the normal. atan2(x, z)
      // — x first — is the codebase's direction→yaw convention (CLAUDE.md).
      rotY: Math.atan2(nrm[0], nrm[1]) + Math.PI / 2,
      width: best.len,
      t0: best.t0, t1: best.t1,
    });
  }
  return out;
}

/**
 * The portal, expressed as a range on a corridor's own wall line.
 *
 * This is the half that makes the two sides agree: the corridor subtracts
 * EXACTLY the span the room opened, on the same axis, instead of deriving its
 * own from the room's bounding box.
 *
 * Returns null when the portal does not lie on this wall line at all.
 */
export function portalOnWall(
  p: Portal,
  we: { perpAxis: 'x' | 'z'; perpCoord: number; wallStart: number; wallEnd: number },
  tol = 0.6,
): { start: number; end: number } | null {
  // Does the hole sit on this line? The room's wall and the corridor's end are
  // a wall-thickness apart at most, so the tolerance is generous by design —
  // being strict here is how you get a cap that never opens.
  const perp = we.perpAxis === 'z' ? [p.a[1], p.b[1]] : [p.a[0], p.b[0]];
  const nearest = Math.min(...perp.map((v) => Math.abs(v - we.perpCoord)));
  if (nearest > tol) return null;

  const along = we.perpAxis === 'z' ? [p.a[0], p.b[0]] : [p.a[1], p.b[1]];
  const start = Math.max(we.wallStart, Math.min(...along));
  const end = Math.min(we.wallEnd, Math.max(...along));
  return end > start + 1e-3 ? { start, end } : null;
}

/**
 * The edge-local cuts a room's wall ring should make, given the rects that reach
 * it. THE call — the shell uses it and so does the test, so neither can measure
 * a path the other doesn't take.
 */
export function wallCutsFor(
  poly: Ring, rects: ReadonlyArray<Rect>,
): Array<{ edge: number; t0: number; t1: number }> {
  return planPortals('shell', poly, rects.map((rect, i) => ({ id: `o${i}`, rect })))
    .map((p) => ({ edge: p.edge, t0: p.t0, t1: p.t1 }));
}

/**
 * Where does this wall line run INSIDE a polygon?
 *
 * The other half of the doorway, and it is not a mirror of the room's half.
 *
 * poly-floor builds corridors that OVERLAP into the room by 0.9m so the opening
 * rect straddles the wall it is meant to cut. A consequence nobody wired up: the
 * last 0.9m of that corridor is INSIDE the room, and its side walls were still
 * being built there — two slabs of masonry standing in open floor, sticking out
 * of the wall into the room. That is "wall faces leaking too far".
 *
 * The rule is simply stated: A WALL SEGMENT INSIDE A ROOM IS NOT A WALL. Which
 * needs the polygon, not the bounding box — the whole reason the rect-based
 * opening finder could never get this right.
 *
 * Exact, not sampled: intersect the infinite wall line with every polygon edge,
 * sort the crossings along the wall's running axis, and pair them up. An odd
 * crossing count means the line starts inside, which cannot happen for a wall
 * on a room's own boundary but can for a corridor that ends in one — so the
 * pairing starts from the first crossing either way.
 */
export function insidePolyRanges(
  we: { perpAxis: 'x' | 'z'; perpCoord: number; wallStart: number; wallEnd: number },
  polys: ReadonlyArray<Ring>,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const poly of polys) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      // Coordinates: `p` is the axis the wall line is CONSTANT on, `q` the axis
      // it runs along.
      const pa = we.perpAxis === 'z' ? a[1] : a[0];
      const pb = we.perpAxis === 'z' ? b[1] : b[0];
      const qa = we.perpAxis === 'z' ? a[0] : a[1];
      const qb = we.perpAxis === 'z' ? b[0] : b[1];
      // Half-open test so a vertex exactly on the line is counted once, not
      // twice — the classic even-odd fencepost.
      if ((pa <= we.perpCoord) === (pb <= we.perpCoord)) continue;
      const t = (we.perpCoord - pa) / (pb - pa);
      xs.push(qa + (qb - qa) * t);
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const start = Math.max(we.wallStart, xs[i]);
      const end = Math.min(we.wallEnd, xs[i + 1]);
      if (end > start + 1e-3) out.push({ start, end });
    }
  }
  return out;
}
