// ── A LINK IS A POLYLINE ─────────────────────────────────────────────────────
//
// Stage 1 of docs/LINKS-V3.md. Josh, after a day of patches that each hit an
// assumption from before anchors existed: *"can we just redo all of this properly
// so it supports gameplay?"* — then, on the plan: *"thats right, we can start with
// flat corridors and then take it further, so lets do it, new system."*
//
// ── WHAT THIS FILE IS FOR ────────────────────────────────────────────────────
//
// A corridor's truth is a POLYLINE between two sockets: a few axis-aligned legs,
// a width, and the two thresholds where it meets the walls. `corridor-route.ts`
// has produced exactly that for months. And then `routeConnection` converted it
// to rects INLINE, threw the polyline away, and every consumer downstream read the
// rects as though they were the record.
//
// Every corridor defect chased on 2026-08-17 traces to that one lossy conversion:
//
//   the 0.9m OVERLAP        so a rect can re-derive a cut the route already stated
//   corridor-trim           to undo the overlap again
//   `legAxis` + "rect 1     because a rect cannot say how long its own slope is,
//     is the landing"       which stepped a doorway 1.2m when a route had 2 legs
//   width in two places     the rect says 2.20m, the frame says 1.03m, and a mob
//                           walks a corridor it cannot get out of
//
// So this module owns the polyline and the ONE derivation from it. Nothing else
// may build a corridor rect. Rects do not go away — nav, culling and occupancy
// read them — they stop being the record and become a view.
//
// ── STAGE 1 CHANGES NO GEOMETRY, ON PURPOSE ──────────────────────────────────
//
// `rectsFromLink` is a faithful extraction of what `routeConnection` did inline,
// including the overlap and the corner-cover rule, which are wrong and are
// stage 3's job. A refactor that also changes output cannot be verified: the gate
// here is BYTE-IDENTICAL FLOORS. Moving the code and changing it at once is how a
// migration becomes a rewrite, and this file exists because that already happened
// once.

import type { LinkRoute } from './corridor-route';
import type { PortalAnchor } from './anchors';

export type P2 = readonly [number, number];
type Box = { x: number; z: number; w: number; d: number };

/** One straight run of a link. Axis-aligned; diagonals are deliberately not yet a
 *  thing (see the charter's stage list). */
export interface LinkLeg {
  from: P2;
  to: P2;
  /** Clear width of this leg. Per-leg because a route's END legs may be wider
   *  where their wall afforded a bigger mouth — not yet used by the derivation,
   *  which takes one width, and the reason width still has two owners. */
  width: number;
}

/**
 * The polyline. THE record for a corridor.
 *
 * `aAt`/`bAt` are the thresholds — ON the wall, not past it. That is the whole
 * difference from a rect, which can only imply where it meets a wall and needs to
 * stab through it to be found.
 */
export interface Link {
  fromRoom: string;
  toRoom: string;
  legs: LinkLeg[];
  aAt: P2;
  bAt: P2;
  /** What each wall agreed to, independently. They need not match. */
  aWidth: number;
  bWidth: number;
  /** The hole this link needs in each room's wall — see WallCut. */
  aCut: WallCut;
  bCut: WallCut;
}

/**
 * A DECLARED hole in a room's wall.
 *
 * ── STAGE 3'S WHOLE IDEA, IN ONE TYPE ────────────────────────────────────────
 *
 * The router picks an anchor on a wall and negotiates a width against it. At that
 * moment it knows exactly which edge the doorway is in and exactly how far along
 * that edge it runs. Then it threw that away, built a rect that stabs 0.9m THROUGH
 * the wall, and a later pass intersected the rect with the polygon to work out
 * where the hole must have been meant to go.
 *
 * Everything that hurt today came out of that round trip. The overshoot puts a
 * corridor's floor and ceiling slabs inside the room (a ledge underfoot, a soffit
 * overhead, and the room culling flickering as you step across it), so
 * `corridor-trim` samples `pointInPoly` every 5cm to find the wall again and pull
 * the slabs back — measuring a number the router had computed exactly. And a cut
 * recovered from a bounding box lands wherever the box happens to cross, which is
 * how a doorway ends up wrapped around a corner with no flat wall to sit in.
 *
 * So the link states it. `planWallRingFull` has always accepted exactly this shape
 * — "pre-decided holes, edge-local; when given, these REPLACE the rect clipping
 * entirely" — it was simply never handed any.
 *
 * EDGE-LOCAL 0..1, matching `planWallRingFull`'s `cuts`. Note this is NOT the
 * convention `PortalAnchor` uses: an anchor's `t0`/`t1` are METRES along its edge.
 * Two parameterisations of the same idea is exactly the kind of thing that makes a
 * conversion lossy, so the metres→fraction division happens once, here, at the one
 * point that owns the declaration.
 */
export interface WallCut {
  /** Index of the polygon edge holding the hole. */
  edge: number;
  /** Start and end along that edge, 0..1 from the edge's first vertex. */
  t0: number;
  t1: number;
  /**
   * How TALL the hole is — the clear height of the passage behind it, metres.
   *
   * The same rule as the width, one axis over. The hole used to be cut floor to
   * ceiling, because an opening carried no height at all, and a LINTEL was then built
   * to close it back down. Where that lintel started was solved from the ARCHWAY that
   * was supposed to fill the doorway — its voussoir ring and hood stand above the
   * clear opening, so the lintel was placed to hide behind the hood.
   *
   * With archways switched off (see level/dressing.ts, Josh's call: "can we just get
   * rid of the archways and do corridor cutting geometry first") there is nothing
   * filling that band, and measured over 648 doorways the lintel sat above the passage
   * on 39.2% of them — up to 0.21m of raw void over a doorway, which is what Josh saw
   * as "corridor ceiling lower than the carved entrance height".
   *
   * Josh, on the whole arrangement: *"that kinda sounds like this is messy and we
   * should redo it completely."* So a cut has a height and the wall is simply never
   * removed above it. No lintel to place, nothing to guess, and no band that depends
   * on a decoration being switched on to look right. An archway later sits INSIDE the
   * hole instead of being load-bearing for the geometry around it.
   */
  height: number;
}

/**
 * Adopt a solved route as a link. The route already IS this shape.
 *
 * `width` is the width the corridor will actually be BUILT to, which is not always
 * the width the router negotiated: the section word is chosen afterwards and quantises
 * it (see `sectionForWidth`). The declared cut has to be derived from the built width
 * or the hole and the passage disagree by up to a section step — a 2.13m cut in a
 * 2.20m rect, which is a cobweb spun 7cm wider than the opening it hangs in. One
 * width, both derivations. Omitted → the negotiated width, for callers with no
 * section.
 */
export function linkFromRoute(
  fromRoom: string, toRoom: string, r: LinkRoute, width?: number,
  /** The passage's clear height — see WallCut.height. Defaults to what the walls can
   *  afford, for callers with no section. */
  height?: number,
): Link {
  return {
    fromRoom,
    toRoom,
    legs: r.legs.map((l) => ({ from: l.from, to: l.to, width: l.width })),
    aAt: r.aAt,
    bAt: r.bAt,
    aWidth: r.aWidth,
    bWidth: r.bWidth,
    aCut: cutFor(r.a, r.aAt, Math.min(width ?? r.aWidth, r.aWidth),
                 height ?? r.a.height[1]),
    bCut: cutFor(r.b, r.bAt, Math.min(width ?? r.bWidth, r.bWidth),
                 height ?? r.b.height[1]),
  };
}

/**
 * The hole an anchor's wall needs, given where the route met it and how wide the
 * two ends agreed to be.
 *
 * The threshold is projected back onto the anchor's OWN edge rather than trusted as
 * a point in space. They should be the same thing, and if they ever are not, the
 * edge is the one that matters: it is the stone the hole gets cut in.
 *
 * Clamped to the anchor's published span, in metres, before converting. That span
 * is what the wall said it could afford — clearance from every corner of the
 * outline, structurally — so a cut may not exceed it even if a width negotiation
 * upstream ever asks for more.
 */
function cutFor(anchor: PortalAnchor, at: P2, width: number, height: number): WallCut {
  const [ax, az] = anchor.edgeFrom;
  const len = anchor.edgeLength;
  const ux = (anchor.edgeTo[0] - ax) / len, uz = (anchor.edgeTo[1] - az) / len;
  const mid = (at[0] - ax) * ux + (at[1] - az) * uz;
  const half = width / 2;
  const lo = Math.max(anchor.t0, mid - half);
  const hi = Math.min(anchor.t1, mid + half);
  // Clamped to what the wall can hold: an opening cannot be taller than the wall it
  // is cut into, which is what the anchor's height range already states.
  return {
    edge: anchor.edge, t0: lo / len, t1: hi / len,
    height: Math.min(height, anchor.height[1]),
  };
}

/** Total run of the polyline, metres. What a ramp has to fall over. */
export function linkRun(link: Link): number {
  return link.legs.reduce(
    (s, l) => s + Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]), 0);
}

export interface DerivedRects {
  rects: Box[];
  /**
   * Which rects are LANDINGS rather than legs — the square at a bend.
   *
   * A landing is a different thing from a leg and several passes care which they are
   * looking at: elevation keeps it level while the legs fall, the decor pass has no
   * business dressing a 2.2m turning square, and a sightline check counts legs to
   * decide whether a bend is an L or a Z. They used to be told by rect COUNT, which
   * only worked while exactly one producer emitted them.
   */
  isLanding: boolean[];
  /** Travel axis per rect, for consumers that cannot derive it. Stage 5 removes
   *  the need: a leg states its own axis and its own heights. */
  legAxis: Array<{ alongX: boolean; fromIsLo: boolean }>;
}

export interface DeriveOpts {
  /** One width for every rect. Stage 4 replaces this with the per-leg widths the
   *  polyline already carries, once width has a single owner. */
  width: number;
  /**
   * How far each END rect pushes PAST its threshold, into the room.
   *
   * Not geometry — a lookup key. `findOpenings` and `planPortals` cut a hole where
   * a rect crosses a wall LINE, so an end that stops exactly on the wall gets no
   * doorway at all and the floor seals. Stage 3 deletes this by declaring the cut
   * instead, at which point the corridor can stop where it actually stops.
   */
  overlap: number;
}

/**
 * The ONE derivation of rects from a polyline.
 *
 * Extracted verbatim from `routeConnection`. Returns null when a leg comes out
 * degenerate, exactly as the inline version did — a link with a 4cm leg is not a
 * corridor and refusing it lets the caller fall through or the floor reroll.
 */
export function rectsFromLink(link: Link, opts: DeriveOpts): DerivedRects | null {
  const { width, overlap } = opts;
  const rects: Box[] = [];
  const legAxis: Array<{ alongX: boolean; fromIsLo: boolean }> = [];
  const isLanding: boolean[] = [];
  const n = link.legs.length;

  // ── A LEG, THEN A LANDING, THEN A LEG ──────────────────────────────────────
  //
  // A joint used to be covered by the DEPARTING leg extending back half a width
  // through it, with the arriving leg stopping dead on the corner's centre. Two things
  // were wrong with that, and they are the same thing seen from two sides:
  //
  //   THE WALL. A corridor builds side walls along its whole length, so the arriving
  //   leg's last half-width of wall stood across the passage it had just joined. At
  //   2.20m that left 1.10m clear and nobody noticed; sections now come from the space
  //   the walls afford, so squeezes are common, and at 1.55m it leaves 0.77m.
  //
  //   THE FALL. A bend is where a player's footing is least predictable, so the
  //   architecture is leg-landing-leg: the cross piece is LEVEL and the fall lives on
  //   the legs. That needs the corner to be its own rect. Only `connectL` — the
  //   pre-anchor router — emitted one, so `poly-elevation` recognised a dogleg as
  //   "three rects, the middle is the landing" and a routed L, being two rects, could
  //   not carry a fall at all. That is why the chord router was gated to flat floors,
  //   and why connectL was still alive to serve the elevated ones.
  //
  // So the corner is stated. Legs stop at the landing's edge (plus a lap, because a
  // joint that meets exactly is one rounding away from a hairline of void), and the
  // landing is a square of the passage's own width centred on the joint — which covers
  // the corner completely, by construction, for any number of legs.
  const JOINT_LAP = 0.05;
  const half = width / 2;
  for (let i = 0; i < n; i++) {
    const leg = link.legs[i];
    const alongX = Math.abs(leg.to[0] - leg.from[0]) > Math.abs(leg.to[1] - leg.from[1]);
    let t0 = alongX ? leg.from[0] : leg.from[1];
    let t1 = alongX ? leg.to[0] : leg.to[1];
    const lat = alongX ? leg.from[1] : leg.from[0];
    const dir = Math.sign(t1 - t0) || 1;
    // The ends of the whole polyline reach into their rooms by `overlap`; the ends that
    // meet a landing stop at its edge, lapped.
    if (i === 0) t0 -= dir * overlap;
    else t0 += dir * (half - JOINT_LAP);
    if (i === n - 1) t1 += dir * overlap;
    else t1 -= dir * (half - JOINT_LAP);

    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    // A leg swallowed entirely by its own landings is not a leg. Refusing the link
    // lets the caller try another pair or the floor reroll, where building it would
    // put a sliver of geometry in the world that every later pass special-cases.
    if (hi - lo < 0.1) return null;
    rects.push(alongX
      ? { x: (lo + hi) / 2, z: lat, w: hi - lo, d: width }
      : { z: (lo + hi) / 2, x: lat, d: hi - lo, w: width });
    legAxis.push({ alongX, fromIsLo: t0 <= t1 });
    isLanding.push(false);

    // THE LANDING between this leg and the next.
    if (i < n - 1) {
      rects.push({ x: leg.to[0], z: leg.to[1], w: width, d: width });
      isLanding.push(true);
      // A landing turns; it has no travel axis of its own. Recorded as this leg's so
      // the array stays index-aligned with `rects`, and so a consumer that reads it
      // anyway gets the axis the player arrives on rather than undefined.
      legAxis.push({ alongX, fromIsLo: t0 <= t1 });
    }
  }
  return { rects, legAxis, isLanding };
}
