import { clipEdgeToRect, edgeNormal, WALL_T, type Ring, type V2 } from './poly-shell-plan';
import { plateExtentFor } from './corridor-trim';

/** One edge of the room's outline, clipped to a corridor's footprint. */
type Hit = { edge: number; t0: number; t1: number; len: number };

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
  /** Index of the polygon edge this hole is cut from — the DOMINANT one when
   *  the opening straddles a corner. The frame is mounted square to this edge. */
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
  /**
   * How much OUTLINE the hole eats, in metres, summed across every edge of the
   * run. This is the CUT — what the wall ring must lose — and it is not a
   * distance across anything.
   */
  width: number;
  /**
   * The clear span a frame square to this doorway has to cover: the extent of
   * the hole PROJECTED onto the lead edge, then capped by the corridor's own
   * clear width.
   *
   * ── WHY THESE ARE TWO NUMBERS ────────────────────────────────────────────
   *
   * They were one, and it shipped the bug Josh photographed: *"a smaller
   * corridor connected to a big gate by embedding a tiny corridor inside the
   * middle of the big gate."*
   *
   * A corridor crossing a CHAMFERED corner clips three edges, and the outline
   * around a corner is longer than the straight line across it. Sizing the
   * frame from the arc length built a 4.94m gate for a 2.20m passage — 2.25x —
   * on 5% of doorways, with the corridor's own side walls then standing inside
   * the frame's opening, which is the z-fighting at the jambs.
   *
   * The cut wants the arc: every edge the corridor crosses must go, or a wall
   * is left standing across the passage (measured: 24 of 72 floors had rooms
   * nobody could reach when this was got wrong the other way). The frame wants
   * the chord: it is a door, and a door is as wide as what walks through it.
   * One number could not be both, and the one it was is the one the wall ring
   * needed — so the frame was the caller that had to change.
   */
  clearWidth: number;
  /** The hole as an edge-local span on `edge`, 0..1. */
  t0: number;
  t1: number;
  /**
   * EVERY edge-local span this one opening removes — what the wall ring cuts.
   *
   * Usually the single span above. TWO OR THREE when a corridor arrives across a
   * CHAMFERED CORNER, which is the case that used to seal rooms: the opening was
   * taken on the best single edge and the rest of it stayed as stone.
   */
  cuts: ReadonlyArray<{ edge: number; t0: number; t1: number }>;
}

/**
 * Widths below this are build noise (a corridor kissing a corner), not a way
 * through. The wall ring already drops spans shorter than 0.14m.
 *
 * RAISED FROM 0.7. At 0.7 the generator shipped 99 doorways under 1.2m across
 * 240 floors, the narrowest 0.71m — and the player's collision diameter is
 * 0.60m, so that is five centimetres of clearance on each side of a hole you
 * are meant to fight your way back through. It passed every reachability test
 * precisely because it was passable; it was never walkable.
 *
 * A span this short is a corridor grazing a corner rather than meeting it, so
 * refusing it leaves WALL, and the corridor comes in through the edge it
 * actually covers. Verified across 144 floors: every room still reachable,
 * every stair still takeable, no corridor end orphaned — and no doorway under
 * 1.2m anywhere.
 */
const MIN_WIDTH = 1.2;

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
  const n = poly.length;
  const out: Portal[] = [];
  for (const c of corridors) {
    // Every edge this corridor reaches, with the length it covers.
    const gather = (rect: Rect): Hit[] => {
      const hits: Hit[] = [];
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (edgeLen < 1e-4) continue;
        // NO PADDING. The hole is where the corridor actually is — the wall ring
        // used to inflate this by the wall thickness, which is the quarter-metre
        // slot on each side of every doorway.
        const hit = clipEdgeToRect(a, b, rect, 0);
        if (!hit) continue;
        hits.push({ edge: i, t0: hit[0], t1: hit[1], len: (hit[1] - hit[0]) * edgeLen });
      }
      return hits;
    };

    // ── CUT AGAINST WHAT IS BUILT, NOT AGAINST THE BOOKKEEPING ─────────────
    //
    // Josh, on a phone: *"it was carved but there is a small void between the
    // doorframe and the room's wall."*
    //
    // A corridor's RECT deliberately runs deep into the room — that overlap is
    // what makes every connection rule work. Its FLOOR does not: the trim pulls
    // the plate back to the wall's outer face. Clipping the doorway against the
    // rect therefore chases the room's outline further than the corridor
    // actually goes, and on a chamfer it chases it around a corner the plate's
    // rectangle never reaches. Wall is removed; nothing is built behind it.
    //
    // Measured across 144 floors: 120.7m of cut wall with no corridor floor
    // behind it, 2.3% of all cut length, 130 places with more than 0.4m bare —
    // about one per floor, which is the rate at which you find one by walking.
    //
    // So clip against the PLATE, grown along the corridor's long axis by the
    // wall band it has to cross to reach the room at all. Not grown laterally:
    // sideways is the passage's own width, and widening that is the opposite of
    // the question being asked.
    const plate = plateExtentFor(c.rect, [poly]);
    const alongX = plate.w >= plate.d;
    const socket: Rect = {
      x: plate.x, z: plate.z,
      w: plate.w + (alongX ? 2 * WALL_T : 0),
      d: plate.d + (alongX ? 0 : 2 * WALL_T),
    };
    // ...BUT A SEALED ROOM IS A FAR WORSE BUG THAN A VOID.
    //
    // A corridor almost entirely swallowed by its rooms trims to `MIN_REMAINING`
    // and its plate can stop short of the wall it is supposed to open. Tightening
    // this rule without a way back is what sealed 24 of 72 floors the last time
    // (see the note on `width` below). 18 of 1943 doorways — 0.9% — need the
    // rect, and they get it: a doorway that would vanish falls back to the old
    // clip and keeps its surplus.
    // ── ONE OPENING MAY SPAN A CORNER ──────────────────────────────────────
    //
    // This used to take the single best edge and refuse the corridor if THAT
    // edge came up short of MIN_WIDTH. A polygon room is chamfered, so a
    // corridor arriving at a corner splits its opening across two edges — 0.8m
    // here and 0.7m there — and neither half cleared a 1.2m bar that the whole
    // easily clears.
    //
    // That was not a cosmetic loss. `wallCutsFor` is this same function, and
    // when it hands the ring a cut list, the cuts REPLACE the ring's own rect
    // clipping (poly-shell-plan.ts) — so a corridor with no portal got no hole
    // at all. Measured across 72 floors: 24 of them had rooms the player could
    // never reach, and on four the ENTRANCE itself was sealed, an unbroken
    // 37.7m of wall around the spawn.
    //
    // So group the hits into runs of ADJACENT edges and measure the run. Runs,
    // not "all hits": a corridor that overlaps a small room deeply can clip the
    // FAR wall too, and merging those two into one opening would invent a
    // doorway through the room rather than into it.
    //
    // The opening is chosen from the socket if that yields one, and from the
    // rect if it does not — the fallback described above. Stated as "pick the
    // widest run, and if it is not a doorway try the wider clip" rather than as
    // two code paths, so the corner rule below can never apply to one and not
    // the other.
    // Returns the hits TOO, not just the winning run: the `cuts` this portal
    // publishes are every hit, and they have to come from the same clip the run
    // did or the ring opens one shape while the frame is sized for another.
    const openingFrom = (rect: Rect): { best: { parts: Hit[]; len: number }; hits: Hit[] } | null => {
      const hits = gather(rect);
      if (!hits.length) return null;
      let widest: { parts: Hit[]; len: number } | null = null;
      for (const r of adjacentRuns(hits, n)) if (!widest || r.len > widest.len) widest = r;
      return widest && widest.len >= MIN_WIDTH ? { best: widest, hits } : null;
    };
    const opening = openingFrom(socket) ?? openingFrom(c.rect);
    if (!opening) continue;
    const { best, hits } = opening;

    // The frame is square to the edge that carries most of the hole; the width
    // is the WHOLE hole, so a gate straddling a chamfer still covers it.
    const lead = best.parts.reduce((m, h) => (h.len > m.len ? h : m), best.parts[0]);
    const a = poly[lead.edge], b = poly[(lead.edge + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const pa: V2 = [a[0] + dx * lead.t0, a[1] + dz * lead.t0];
    const pb: V2 = [a[0] + dx * lead.t1, a[1] + dz * lead.t1];
    const nrm = edgeNormal(poly, lead.edge);
    // Midpoint of the WHOLE opening, so a gate on a corner sits in the middle of
    // the way through rather than at the middle of its widest face.
    let mx = 0, mz = 0, wsum = 0;
    for (const h of best.parts) {
      const ea = poly[h.edge], eb = poly[(h.edge + 1) % n];
      const ex = eb[0] - ea[0], ez = eb[1] - ea[1];
      const t = (h.t0 + h.t1) / 2;
      mx += (ea[0] + ex * t) * h.len; mz += (ea[1] + ez * t) * h.len; wsum += h.len;
    }
    out.push({
      roomId, corridorId: c.id, edge: lead.edge,
      a: pa, b: pb,
      mid: [mx / wsum, mz / wsum],
      normal: nrm,
      // THE FRAME FACES ALONG THE NORMAL, and that is the whole of it.
      //
      // A frame model is authored with +X along the gate and +Z THROUGH it
      // (see archway.ts), so aiming its +Z down the wall's normal already puts
      // the lintel along the wall. The extra quarter-turn that used to be here
      // came from reading "the lintel runs along the wall" as an instruction
      // instead of as a consequence — and it turned every doorway in the game
      // edge-on. The rect emitter has always agreed with this: rotY 0 on a
      // north/south wall, π/2 on an east/west one, which is what atan2(nx, nz)
      // returns (modulo the half-turn a symmetric frame cannot show).
      //
      // atan2(x, z) — x FIRST — is the codebase's direction→yaw convention.
      rotY: Math.atan2(nrm[0], nrm[1]),
      width: best.len,
      clearWidth: clearSpan(poly, best.parts, lead, c.rect),
      t0: lead.t0, t1: lead.t1,
      // ── CUT EVERY EDGE THE CORRIDOR CROSSES, NOT JUST THE THRESHOLD RUN ──
      //
      // The frame goes on ONE run — the way in. The wall ring has to lose them
      // ALL, because the rule is the same one this generator already lives by
      // from the other side (`insidePolyRanges`): A WALL SEGMENT INSIDE A
      // CORRIDOR IS NOT A WALL.
      //
      // A polygon room is notched, and a corridor coming down a notch clips the
      // room's outline TWICE — once at the wall it enters through, and again
      // across the three sides of the bite it then runs down. Keeping only the
      // biggest run picked the bite and left the entry wall standing straight
      // across the passage: measured on seed 555 depth 11, a wall at z=31.6
      // spanning the corridor's whole 2.2m width, and four rooms behind it that
      // the player could never reach.
      cuts: hits.map((h) => ({ edge: h.edge, t0: h.t0, t1: h.t1 })),
    });
  }
  return out;
}

/**
 * Group edge hits into runs of edges that are adjacent around the ring.
 *
 * Adjacency wraps, because edge n−1 and edge 0 meet at a corner like any other
 * pair — and a corridor arriving at exactly that corner is not a special case
 * anywhere else in this file.
 */
function adjacentRuns<T extends { edge: number; len: number }>(
  hits: readonly T[], n: number,
): Array<{ parts: T[]; len: number }> {
  const byEdge = new Map<number, T>();
  for (const h of hits) byEdge.set(h.edge, h);
  const seen = new Set<number>();
  const runs: Array<{ parts: T[]; len: number }> = [];
  for (const h of hits) {
    if (seen.has(h.edge)) continue;
    const parts: T[] = [];
    // Walk backward to the start of this run, then forward through it.
    let start = h.edge;
    while (byEdge.has((start - 1 + n) % n) && (start - 1 + n) % n !== h.edge) start = (start - 1 + n) % n;
    let e = start;
    do {
      const p = byEdge.get(e);
      if (!p || seen.has(e)) break;
      seen.add(e); parts.push(p);
      e = (e + 1) % n;
    } while (e !== start);
    runs.push({ parts, len: parts.reduce((m, p) => m + p.len, 0) });
  }
  return runs;
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
  // EVERY cut, not just the leading edge's. A corridor arriving across a
  // chamfered corner opens two edges, and returning one of them leaves the
  // other as stone across half the doorway — see the note in planPortals.
  return planPortals('shell', poly, rects.map((rect, i) => ({ id: `o${i}`, rect })))
    .flatMap((p) => p.cuts.map((c) => ({ edge: c.edge, t0: c.t0, t1: c.t1 })));
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
/**
 * The clear span across an opening, in the direction a frame square to `lead`
 * would run.
 *
 * Projects every part of the run onto the lead edge's own axis and takes the
 * extent — so a chamfer's contribution counts for its shadow on that axis
 * rather than its full length — then caps by the corridor's clear width,
 * because a frame wider than the passage behind it is a hole with a tunnel in
 * the middle of it.
 */
function clearSpan(
  poly: Ring,
  parts: ReadonlyArray<{ edge: number; t0: number; t1: number }>,
  lead: { edge: number },
  rect: { w: number; d: number },
): number {
  const n = poly.length;
  const a = poly[lead.edge], b = poly[(lead.edge + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  let lo = Infinity, hi = -Infinity;
  for (const h of parts) {
    const ea = poly[h.edge], eb = poly[(h.edge + 1) % n];
    const ex = eb[0] - ea[0], ez = eb[1] - ea[1];
    for (const t of [h.t0, h.t1]) {
      const s = (ea[0] + ex * t) * ux + (ea[1] + ez * t) * uz;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
  }
  const projected = hi - lo;
  // The corridor's clear width is its SHORT side — the long one is its length.
  // Less the REVEAL, below.
  return Math.max(0.6, Math.min(projected, Math.min(rect.w, rect.d)) - JAMB_REVEAL);
}

/**
 * A FRAME IS SLIGHTLY NARROWER THAN THE PASSAGE IT SITS IN.
 *
 * Josh, on a phone: *"the doorframes are stuck inside the corridor's walls so
 * it's z-fighting on the inside of the corridor where it meets the door frame
 * ... it's the same as a pipe and the pipe's connector."*
 *
 * Exactly, and this is the millimetre that makes the connector a connector.
 * Sizing the frame to the corridor's clear width — which is what this function
 * did an hour before this line was written, and was right about — puts the
 * JAMBS precisely on the corridor's own side-wall planes. Two coplanar
 * surfaces, both drawn, both claiming the same depth: a shimmer down both sides
 * of every doorway.
 *
 * So the frame gives up a few centimetres a side and stands PROUD into the
 * opening. Nothing is coplanar any more, the jamb reads as masonry the passage
 * runs into rather than as part of the wall, and it is what a real doorframe
 * does: a reveal is always tighter than the passage behind it.
 *
 * Small on purpose. Big enough that no depth buffer can confuse the two,
 * small enough that it never narrows a doorway a body has to fit through —
 * `gateAdmits` works on the frame's half-band, so a reveal that ate real width
 * would start refusing mobs the corridor admits.
 */
const JAMB_REVEAL = 0.07;

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
