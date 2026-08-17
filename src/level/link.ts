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
}

/** Adopt a solved route as a link. The route already IS this shape. */
export function linkFromRoute(fromRoom: string, toRoom: string, r: LinkRoute): Link {
  return {
    fromRoom,
    toRoom,
    legs: r.legs.map((l) => ({ from: l.from, to: l.to, width: l.width })),
    aAt: r.aAt,
    bAt: r.bAt,
    aWidth: r.aWidth,
    bWidth: r.bWidth,
  };
}

/** Total run of the polyline, metres. What a ramp has to fall over. */
export function linkRun(link: Link): number {
  return link.legs.reduce(
    (s, l) => s + Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1]), 0);
}

export interface DerivedRects {
  rects: Box[];
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
  const n = link.legs.length;
  for (let i = 0; i < n; i++) {
    const leg = link.legs[i];
    const alongX = Math.abs(leg.to[0] - leg.from[0]) > Math.abs(leg.to[1] - leg.from[1]);
    let t0 = alongX ? leg.from[0] : leg.from[1];
    let t1 = alongX ? leg.to[0] : leg.to[1];
    const lat = alongX ? leg.from[1] : leg.from[0];
    const dir = Math.sign(t1 - t0) || 1;
    if (i === 0) t0 -= dir * overlap;
    if (i === n - 1) t1 += dir * overlap;
    // ── WHO COVERS THE CORNER ─────────────────────────────────────────────────
    // Only the leg LEAVING a joint extends back through it; the leg arriving stops
    // dead on the corner's centre. Extending both was the obvious symmetric thing
    // and it is wrong — the arriving leg's far end then lands exactly ON the
    // departing leg's outer edge, and the orphaned-end check ends up deciding a
    // boundary case. Stopping at the centre puts that end half a width INSIDE its
    // neighbour with no epsilon to argue about, and the departing leg's own
    // half-width covers the corner square by itself.
    if (i > 0) t0 -= dir * width / 2;

    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    if (hi - lo < 0.1) return null;
    rects.push(alongX
      ? { x: (lo + hi) / 2, z: lat, w: hi - lo, d: width }
      : { z: (lo + hi) / 2, x: lat, d: hi - lo, w: width });
    legAxis.push({ alongX, fromIsLo: t0 <= t1 });
  }
  return { rects, legAxis };
}
