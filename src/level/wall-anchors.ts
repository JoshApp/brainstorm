import type { WallSurface } from './wall-surfaces';
import type { V2 } from './poly-shell-plan';
import { MIN_WALKABLE_WIDTH } from './corridor-types';

// ── WALL ANCHORS — where a room is WILLING to be cut ─────────────────────────
//
// Josh, 2026-08-17: *"shouldn't we make anchors kinda be anchor walls and then we
// can anchor there? big enough surface to cut into ... some can do small doors
// some cant."*
//
// ── WHY THIS EXISTS: THE DEPENDENCY IS THE WRONG WAY ROUND ───────────────────
//
// Today a doorway is a CONSEQUENCE. Corridors route where they like, and
// `planPortals` afterwards discovers where a corridor rect happens to overlap a
// room's outline and clips a hole out of whatever it finds. The room has no say,
// and finds out what happened to it at build time.
//
// Measured over 124 generated polygon floors (tests/portal-straddle.test.ts):
// 12.1% of doorways come out cut across a BEND, 105 of them across three or more
// edges, one across seven, and the worst across an edge and its exact reverse —
// a corridor punched through a thin pocket wall and out the far side.
//
// A cut across a bend is not planar, and that single fact produces every symptom
// Josh photographed: a half-arc opening (a curve fitted to one edge, spanning
// two), the corridor's ceiling and wall protruding into the room (a hull trimmed
// against the wrong plane), z-fighting where the two hulls end up coplanar, and
// voids where neither piece reaches.
//
// An ANCHOR inverts it. The room publishes, up front, the stretches of wall it
// can host a doorway in and how wide a one each can take. Routing then asks for
// an anchor instead of discovering a coordinate. A planar cut stops being lucky
// and becomes structural: an anchor is ONE EDGE, so there is no straddle to have.
//
// ── DERIVED, NOT AUTHORED, AND THAT IS THE LOAD-BEARING PART ─────────────────
//
// Josh's sketch was to FLAG each wall. The flag is the one thing to avoid: an
// authored property can disagree with the geometry, and that disagreement is this
// entire week's bug class — a comment asserting ZERO polygon frames while 841
// were being emitted, a frame owning the sill while the wall assumed someone else
// had it, a standoff describing an arm reach that had changed underneath it.
//
// So an anchor is derived from `describeWalls`, which is itself derived from the
// same `planWallRing` the shell builds its geometry from. An anchor therefore
// cannot disagree with the wall that gets built. What IS authored is the class
// vocabulary below — the part that is a design decision rather than a fact.

/**
 * What a stretch of wall can host.
 *
 * A vocabulary rather than a raw number, because "how wide a hole may I cut" is a
 * question a router, a content layer and a future postern all want to ask in
 * words. The thresholds are the authored part of this file.
 */
export type AnchorClass = 'gate' | 'door' | 'postern' | 'none';

/**
 * How much stone must be left standing at each end of a cut.
 *
 * 0.75m, and it is not a fresh guess — it is the quoin reach from
 * scene/corner-field.ts, where the masonry already asserts that a corner is ONE
 * BIG STONE over that distance. A doorway that eats into it contradicts the wall
 * it is cut from, so the art constraint and the structural one agree on a number,
 * which is the nicest kind of constant to have.
 *
 * It is also comfortably above `planWallRing`'s own minSpan of 0.14 ("a 4cm pier
 * beside a doorway is z-fighting, not architecture") — that bound says what is
 * unbuildable, this one says what is unconvincing.
 */
export const CORNER_MARGIN = 0.75;

/** Clear spans each class promises. `postern` bottoms out at the narrowest gap
 *  the widest roaming mob can pass — below that a door is decoration. */
export const CLASS_WIDTH: Record<Exclude<AnchorClass, 'none'>, number> = {
  gate: 2.6,
  door: 1.6,
  postern: Math.max(1.0, MIN_WALKABLE_WIDTH),
};

/** The best class a usable span can host. */
export function anchorClassFor(usable: number): AnchorClass {
  if (usable >= CLASS_WIDTH.gate) return 'gate';
  if (usable >= CLASS_WIDTH.door) return 'door';
  if (usable >= CLASS_WIDTH.postern) return 'postern';
  return 'none';
}

/** A stretch of one wall face that a doorway may be cut from. */
export interface WallAnchor {
  /** Polygon edge this belongs to. ONE edge, always — that is the point. */
  edge: number;
  /** The USABLE span, world XZ — the face inset by CORNER_MARGIN at both ends. */
  a: V2;
  b: V2;
  /** Midpoint of the usable span. */
  mid: V2;
  /** Unit vector into the room. A corridor arriving here should come along −this. */
  inward: V2;
  /** rotY for something facing into the room from this wall (see WallSurface). */
  facingY: number;
  /** The whole face, before margins. */
  faceLength: number;
  /** What is left to cut into. */
  usable: number;
  /** Widest class this anchor can host. */
  cls: AnchorClass;
}

/**
 * Publish the anchors of a room, from its wall surfaces.
 *
 * Pass surfaces from an UNCUT ring (`describeWalls` with no openings): anchors
 * describe what the room is willing to have done to it, which is a fact about the
 * room and not about whatever has already been done. Feeding it cut surfaces
 * would let existing doorways silently shrink the vocabulary.
 *
 * Faces too short to host anything are returned with `cls: 'none'` rather than
 * dropped — a router asking "what does this room offer" deserves to see the walls
 * that offer nothing, and a caller that filters is clearer than a caller that
 * cannot tell an absent wall from an unusable one.
 */
export function wallAnchors(surfaces: readonly WallSurface[]): WallAnchor[] {
  const out: WallAnchor[] = [];
  for (const s of surfaces) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
    const L = Math.hypot(dx, dz);
    const usable = Math.max(0, L - 2 * CORNER_MARGIN);
    // Inset along the face, CLAMPED AT THE MIDPOINT.
    //
    // The clamp is not defensive tidying; without it the span INVERTS. On a face
    // shorter than 2 x CORNER_MARGIN the two insets cross over, and `a` ends up
    // past `b` — which still has a positive length, so it reads as a usable
    // stretch of wall. Caught by the test on a 0.71m face: it reported 0.79m of
    // usable span, more than the wall it came from. An anchor claiming to be
    // longer than its own face is exactly the kind of quiet wrongness this whole
    // model exists to remove.
    const t = L > 1e-6 ? Math.min(0.5, CORNER_MARGIN / L) : 0.5;
    const a: V2 = [s.a[0] + dx * t, s.a[1] + dz * t];
    const b: V2 = [s.b[0] - dx * t, s.b[1] - dz * t];
    out.push({
      edge: s.edge,
      a, b,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      inward: s.inward,
      facingY: s.facingY,
      faceLength: L,
      usable,
      cls: anchorClassFor(usable),
    });
  }
  return out;
}

/** Can this anchor host a clear span of `width`? */
export function anchorFits(anchor: WallAnchor, width: number): boolean {
  return anchor.usable >= width;
}

/**
 * Where a cut of `width` would sit on this anchor, centred, as a world span.
 *
 * Returns null when it does not fit, rather than clamping — a doorway quietly
 * narrowed to fit is how a passage becomes a squeeze nobody chose.
 */
export function anchorSpan(anchor: WallAnchor, width: number): { a: V2; b: V2 } | null {
  if (!anchorFits(anchor, width)) return null;
  const dx = anchor.b[0] - anchor.a[0], dz = anchor.b[1] - anchor.a[1];
  const L = Math.hypot(dx, dz);
  if (L < 1e-6) return null;
  const half = width / 2 / L;
  const mx = (anchor.a[0] + anchor.b[0]) / 2, mz = (anchor.a[1] + anchor.b[1]) / 2;
  return {
    a: [mx - dx * half, mz - dz * half],
    b: [mx + dx * half, mz + dz * half],
  };
}

/** Anchors that can host `width`, widest usable span first — the order a router
 *  wants when it is choosing where to attach. */
export function anchorsFor(anchors: readonly WallAnchor[], width: number): WallAnchor[] {
  return anchors.filter((a) => anchorFits(a, width)).sort((x, y) => y.usable - x.usable);
}
