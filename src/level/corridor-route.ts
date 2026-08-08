import type { Poly } from './room-shape';
import { pointInPoly } from './room-shape';
import type { PortalAnchor } from './anchors';
import { anchorSpan, type LinkSide, type OpeningWant } from './link-anchors';

// ── A CORRIDOR IS A ROUTE, NOT A DIRECTION ───────────────────────────────────
//
// Josh: *"can't we just make the corridor shape be more than a linear line?
// That should get around rooms not facing each other. We made a room flexible;
// making the corridors flexible is good as well."*
//
// Yes, and it dissolves the constraint rather than working around it. The
// straight-corridor model needs two walls to FACE each other AND to overlap
// laterally by a door's width — a conjunction of two accidents. 17% of the
// links the generator makes could not satisfy it.
//
// A routed corridor needs neither. It leaves A perpendicular to A's wall,
// arrives at B perpendicular to B's wall, and bends in between. The two ends
// stop being one opening that both sides must accept and become **two
// thresholds**, each negotiated with the single wall it is cut into — which is
// also simpler, and is the splayed mouth falling out for free: a 3.5m mouth on
// a 2.2m passage is just a threshold that is wider than the leg behind it.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
//
// Diagonals. 11% of anchors sit on chamfered edges with exact 45° normals, and
// they are skipped. Everything downstream — the wall ring, the nav band, the
// decor spacing, the plate trim — assumes axis-aligned runs, and diagonal
// geometry is precisely where this codebase's geometry bugs have lived. The
// normals being EXACTLY 45° means diagonal legs can be added later as their own
// case rather than as a generalisation that destabilises the axis-aligned one.

/** One straight run of a corridor's centreline. Axis-aligned. */
export interface RouteLeg {
  from: readonly [number, number];
  to: readonly [number, number];
  /** Clear width of this leg. The body legs carry the section; the two end
   *  legs may be wider where their wall afforded a bigger mouth. */
  width: number;
}

export interface LinkRoute {
  a: PortalAnchor;
  b: PortalAnchor;
  /** Where each end actually meets its wall — ON the wall, not past it. These
   *  are the two thresholds; there is nothing to overshoot toward. */
  aAt: readonly [number, number];
  bAt: readonly [number, number];
  /** Each mouth is negotiated with its OWN wall. They need not match. */
  aWidth: number;
  bWidth: number;
  legs: RouteLeg[];
  /** 0 straight, 1 an L, 2 a Z, 3 a U. Fewer is preferred, but only after
   *  "does it exist at all". */
  bends: number;
}

/**
 * How much straight run a leg needs BEFORE IT MAY TURN — a bend arriving
 * immediately inside a splayed mouth reads as a mistake, and gives the frame
 * nowhere to sit. In section widths, so it scales with the passage.
 *
 * It applies only to legs that meet a bend. A straight run has no such floor:
 * two rooms a metre apart joined by a short straight passage is a thick
 * doorway, which is fine and is a thing real buildings do. Applying the bend
 * rule to straight runs cost a link that the old straight-only chooser served
 * — the router refusing work the thing it replaces could do is the one
 * regression a migration must not ship.
 */
export const MIN_LEG_FACTOR = 1.2;

/** Lateral agreement tolerance for calling two opposed anchors collinear. */
const COLLINEAR_EPS = 0.05;

/** How far into a room a route's two extreme ends may legitimately reach — the
 *  mouth. Beyond this, a leg inside a room is a corridor laying its floor and
 *  ceiling indoors, which is the bug this whole model exists to end. */
const MOUTH_DEPTH = 1.2;

export interface RouteObstacle {
  id: string;
  poly: Poly;
}

/**
 * Route between two specific anchors, or null if no axis-aligned route works.
 *
 * `obstacles` are the OTHER rooms on the floor — a corridor that drives through
 * a third room is not a corridor, it is a hole in that room. The two endpoint
 * rooms are excluded by id.
 */
export function routeBetween(
  a: PortalAnchor, aPoly: Poly, aWidth: number,
  b: PortalAnchor, bPoly: Poly, bWidth: number,
  section: number, obstacles: readonly RouteObstacle[],
): LinkRoute | null {
  if (!isAxis(a.normal) || !isAxis(b.normal)) return null;

  const sa = anchorSpan(a, aPoly), sb = anchorSpan(b, bPoly);
  // Where along each wall the mouth may be centred, once its own width is
  // reserved. An empty range means the wall cannot hold this mouth at all.
  const ra = centreRange(sa, aWidth), rb = centreRange(sb, bWidth);
  if (!ra || !rb) return null;

  /**
   * A LEG MAY NOT LIE INSIDE ITS OWN ROOMS EITHER.
   *
   * The obstacle list is the OTHER rooms, and checking only those was wrong in
   * a way that took a full wiring pass to surface: a room is not convex. An
   * ell's wall can face outward while the straight line from it re-enters the
   * room's own missing quadrant, so the corridor lays 15m of floor and ceiling
   * INSIDE the room it started from. Measured on the first wired build: 31 of
   * 894 plates reached more than 0.3m into a room, worst 15.88m.
   *
   * The two ends are legitimately inside — that is the mouth — so the check
   * skips a margin at each extreme of the ROUTE (not of each leg; an interior
   * leg gets no exemption at all).
   */
  const selfRooms: RouteObstacle[] = [
    { id: '#a', poly: aPoly }, { id: '#b', poly: bPoly },
  ];
  const free = (legs: RouteLeg[]) => legs.every((l, i) => {
    if (!legClear(l, obstacles, 0, 0)) return false;
    return legClear(l, selfRooms, i === 0 ? MOUTH_DEPTH : 0,
      i === legs.length - 1 ? MOUTH_DEPTH : 0);
  });
  const minLeg = section * MIN_LEG_FACTOR;

  const aAxisX = Math.abs(a.normal[0]) > 0.5;   // A exits along X
  const bAxisX = Math.abs(b.normal[0]) > 0.5;

  // ── STRAIGHT ───────────────────────────────────────────────────────────────
  // Opposed normals, and a lateral both runs can host. This is the old model,
  // kept as the preferred case because a straight passage IS the right answer
  // when it is available.
  if (aAxisX === bAxisX && opposed(a.normal, b.normal)) {
    const lo = Math.max(ra[0], rb[0]), hi = Math.min(ra[1], rb[1]);
    if (hi >= lo - COLLINEAR_EPS) {
      const lat = (Math.max(lo, Math.min(hi, mid(ra))) + Math.max(lo, Math.min(hi, mid(rb)))) / 2;
      const from = onWall(sa, lat, aAxisX), to = onWall(sb, lat, bAxisX);
      const legs = [{ from, to, width: section }];
      // No length floor: a straight run has no bend to give room to.
      if (len(from, to) > 0.01 && free(legs)) {
        return { a, b, aAt: from, bAt: to, aWidth, bWidth, legs, bends: 0 };
      }
    }
  }

  // ── L ──────────────────────────────────────────────────────────────────────
  // Perpendicular normals: one corner, at the intersection of the two exit
  // lines. This is the case that serves rooms which do not face each other at
  // all, and it is why the router exists.
  if (aAxisX !== bAxisX) {
    for (const la of candidates(ra)) for (const lb of candidates(rb)) {
      const from = onWall(sa, la, aAxisX), to = onWall(sb, lb, bAxisX);
      // A exits along its normal axis; B is entered along its normal axis. The
      // corner takes A's travel coordinate from B and B's from A.
      const corner: [number, number] = aAxisX ? [to[0], from[1]] : [from[0], to[1]];
      // Both legs must run FORWARD out of their own wall, or the route doubles
      // back through the room it just left.
      if (!forward(from, corner, a.normal) || !forward(to, corner, b.normal)) continue;
      if (len(from, corner) < minLeg || len(to, corner) < minLeg) continue;
      const legs = [
        { from, to: corner, width: section },
        { from: corner, to, width: section },
      ];
      if (free(legs)) return { a, b, aAt: from, bAt: to, aWidth, bWidth, legs, bends: 1 };
    }
  }

  // ── Z ──────────────────────────────────────────────────────────────────────
  // Opposed normals whose runs do not share a lateral: out, across, in. The
  // crossing happens in the gap between the rooms, so it needs the gap to be
  // wide enough to hold two bends.
  if (aAxisX === bAxisX && opposed(a.normal, b.normal)) {
    for (const la of candidates(ra)) for (const lb of candidates(rb)) {
      const from = onWall(sa, la, aAxisX), to = onWall(sb, lb, bAxisX);
      const t0 = aAxisX ? from[0] : from[1], t1 = aAxisX ? to[0] : to[1];
      const gap = Math.abs(t1 - t0);
      if (gap < 2 * minLeg) continue;
      for (const f of [0.5, 0.35, 0.65]) {
        const cross = t0 + (t1 - t0) * f;
        const c1: [number, number] = aAxisX ? [cross, from[1]] : [from[0], cross];
        const c2: [number, number] = aAxisX ? [cross, to[1]] : [to[0], cross];
        if (len(c1, c2) < minLeg) continue;
        const legs = [
          { from, to: c1, width: section },
          { from: c1, to: c2, width: section },
          { from: c2, to, width: section },
        ];
        if (free(legs)) return { a, b, aAt: from, bAt: to, aWidth, bWidth, legs, bends: 2 };
      }
    }
  }

  // A U (both walls facing the same way) is left unrouted on purpose. It is
  // rare, it is four legs, and a link that needs one is usually a link that
  // should have picked a different pair of anchors — which the chooser above
  // this will do, because it tries them all.
  return null;
}

/**
 * Best route between two rooms, over every anchor pair they publish.
 *
 * Preference: fewest bends, then shortest. A straight corridor is better than
 * an L when both exist — the bend is there to make an impossible link possible,
 * not to be spent for its own sake. (Kinking a straight run for the sake of the
 * reveal is a separate, deliberate decision that already lives in `connect`.)
 */
export function chooseLinkRoute(
  A: LinkSide, B: LinkSide, want: OpeningWant,
  mouth: (anchor: PortalAnchor, want: OpeningWant) => number | null,
  obstacles: readonly RouteObstacle[] = [],
  /**
   * Invert the bend preference — take the kinked route when one exists.
   *
   * A straight corridor between two rooms is a telescope: you stand in one
   * doorway and read the whole of the next before committing to it, which is
   * the single thing that makes a procedural floor read as a diagram. The
   * layout rolls for this deliberately. It is a request for a REVEAL, not a
   * different geometry model — the route is still anchored at both ends.
   */
  preferBend = false,
): LinkRoute | null {
  let best: LinkRoute | null = null;
  const better = (r: LinkRoute, than: LinkRoute) => (preferBend
    ? (r.bends > than.bends || (r.bends === than.bends && routeLength(r) < routeLength(than)))
    : (r.bends < than.bends || (r.bends === than.bends && routeLength(r) < routeLength(than))));
  for (const a of A.anchors) {
    const wa = mouth(a, want);
    if (wa == null) continue;
    for (const b of B.anchors) {
      const wb = mouth(b, want);
      if (wb == null) continue;
      const r = routeBetween(a, A.poly, wa, b, B.poly, wb, want.section, obstacles);
      if (!r) continue;
      if (!best || better(r, best)) best = r;
    }
  }
  return best;
}

export function routeLength(r: LinkRoute): number {
  return r.legs.reduce((s, l) => s + len(l.from, l.to), 0);
}

// ── geometry ─────────────────────────────────────────────────────────────────

const isAxis = (n: readonly [number, number]) =>
  Math.abs(Math.abs(n[0]) - 1) < 0.02 || Math.abs(Math.abs(n[1]) - 1) < 0.02;

const opposed = (m: readonly [number, number], n: readonly [number, number]) =>
  m[0] * n[0] + m[1] * n[1] < -0.9;

const len = (p: readonly [number, number], q: readonly [number, number]) =>
  Math.hypot(q[0] - p[0], q[1] - p[1]);

const mid = (r: readonly [number, number]) => (r[0] + r[1]) / 2;

/** Does the segment p→q leave p in the direction of `n`? */
function forward(
  p: readonly [number, number], q: readonly [number, number], n: readonly [number, number],
): boolean {
  return (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] > 0.01;
}

/** Where along a wall run a mouth of `width` may be CENTRED, in the lateral
 *  coordinate. Null when the run cannot hold it. */
function centreRange(
  s: ReturnType<typeof anchorSpan>, width: number,
): [number, number] | null {
  const a = s.alongX ? s.from[0] : s.from[1];
  const b = s.alongX ? s.to[0] : s.to[1];
  const lo = Math.min(a, b) + width / 2, hi = Math.max(a, b) - width / 2;
  return hi >= lo ? [lo, hi] : null;
}

/** The point on a wall run at lateral `lat`. `exitsAlongX` is the anchor's
 *  travel axis, so the wall itself runs along the other one. */
function onWall(
  s: ReturnType<typeof anchorSpan>, lat: number, exitsAlongX: boolean,
): [number, number] {
  return exitsAlongX ? [s.from[0], lat] : [lat, s.from[1]];
}

/** Positions to try along a run: its middle first, then progressively toward
 *  the ends. The middle is preferred because a door centred on its wall reads
 *  as designed; the ends exist so a link is not lost for want of 30cm. */
function candidates(r: readonly [number, number]): number[] {
  const c = mid(r);
  if (r[1] - r[0] < 0.02) return [c];
  return [c, r[0] + (c - r[0]) * 0.4, r[1] - (r[1] - c) * 0.4, r[0], r[1]];
}

/**
 * Does this leg run clear of every room that is not one of its endpoints?
 *
 * Sampled along the centreline AND both edges of the band, because a leg can
 * clip a corner without its centre ever entering. Sampling rather than exact
 * polygon clipping is deliberate: at a 0.25m step against rooms metres across
 * it cannot miss an intersection that matters, and it stays readable.
 */
function legClear(
  leg: RouteLeg, obstacles: readonly RouteObstacle[],
  skipStart = 0, skipEnd = 0,
): boolean {
  if (obstacles.length === 0) return true;
  const dx = leg.to[0] - leg.from[0], dz = leg.to[1] - leg.from[1];
  const L = Math.hypot(dx, dz);
  if (L < 1e-6) return true;
  const ux = dx / L, uz = dz / L;
  // Perpendicular, for the band edges.
  const px = -uz, pz = ux;
  const t0 = skipStart, t1 = L - skipEnd;
  if (t1 <= t0) return true;
  const steps = Math.max(2, Math.ceil((t1 - t0) / 0.25));
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (i / steps) * (t1 - t0);
    for (const off of [0, leg.width / 2, -leg.width / 2]) {
      const x = leg.from[0] + ux * t + px * off;
      const z = leg.from[1] + uz * t + pz * off;
      for (const o of obstacles) if (pointInPoly(o.poly, x, z)) return false;
    }
  }
  return true;
}
