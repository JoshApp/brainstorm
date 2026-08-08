/**
 * Wall thickness in metres.
 *
 * Lives here, in the module with no imports, because it is a fact about the
 * wall PLAN rather than about the mesh built from it. `poly-room-shell`
 * re-exports it under its old name — that is where every existing caller reads
 * it from, and none of them had to change.
 */
export const WALL_T = 0.25;

// ── THE WALL RING — pure geometry, no Three ──────────────────────────────────
//
// How do you build a polygon room's walls so they ACTUALLY CLOSE?
//
// The first attempt emitted one box per polygon edge, each stretched half a wall
// thickness past its ends so neighbours would overlap at the corners. That is
// "place slabs and hope" — it happens to seal a 90° corner, roughly seals a 45°
// chamfer, and has no answer at all for a reflex corner or for the stub left
// beside a doorway. Worse, it is unfalsifiable by looking: a hairline wedge at a
// corner is invisible in a screenshot and obvious the moment a player walks it.
//
// The construction here removes the hope. A room is a RING: an inner polyline
// (the floor's outline, what the player touches) and an OUTER polyline, produced
// by offsetting the inner one outward by the wall thickness with MITRED corners.
// Because the offset yields exactly one outer point per inner point, adjacent
// wall spans SHARE their end vertices — identical floats, not merely nearby ones.
// A gap between two spans is then not unlikely, it is unrepresentable.
//
// Openings drop out of the same structure. Cutting an edge produces a span whose
// end is a straight perpendicular JAMB (inner point → outer point) instead of a
// mitred corner, which is the doorway reveal you want anyway: a wall you can see
// the thickness of as you step through.
//
// Kept free of Three so the ring can be asserted on in a node test — closure is
// a property of the numbers, and checking it should not need a renderer.

export type V2 = readonly [number, number];
export type Ring = readonly V2[];

/** Shoelace, SIGNED. The sign is the winding, and the winding is what tells us
 *  which side of an edge is "out" — everything below depends on it. */
export function signedArea(poly: Ring): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Outward unit normal of edge i (from vertex i to vertex i+1).
 *
 * For a positively-wound outline — which is what room-shape.ts traces; see the
 * note on `chamfer` — the outward normal of a→b is (dz, −dx). Verified against
 * the plain box [[-4,-3],[4,-3],[4,3],[-4,3]]: its first edge runs +X along
 * z=−3 and this returns (0,−1), pointing away from a room that occupies z>−3.
 */
export function edgeNormal(poly: Ring, i: number): V2 {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const s = signedArea(poly) >= 0 ? 1 : -1;
  return [(dz / len) * s, (-dx / len) * s];
}

/** Longest a mitre may stretch, as a multiple of the wall thickness. A very
 *  sharp spike would otherwise throw its outer corner metres away; clamping
 *  rounds the spike off instead, which is what masonry does too. */
const MITER_LIMIT = 3.5;

/**
 * The OUTER ring: `poly` pushed outward by `t`, one output vertex per input
 * vertex, corners mitred.
 *
 * At each vertex the two adjacent offset edge-lines are intersected. The mitre
 * direction is the normalised sum of the two edge normals; the distance along it
 * is t / cos(half-angle), which is exactly where the two offset lines cross.
 * Reflex corners fall out of the same formula with a negative-ish cosine handled
 * by the clamp — no special case, which is the point.
 */
export function offsetRing(poly: Ring, t: number): V2[] {
  const n = poly.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const nPrev = edgeNormal(poly, (i - 1 + n) % n);
    const nNext = edgeNormal(poly, i);
    let mx = nPrev[0] + nNext[0], mz = nPrev[1] + nNext[1];
    const mlen = Math.hypot(mx, mz);
    if (mlen < 1e-9) {
      // A perfect 180° spike — the two edges double back. No mitre exists; push
      // straight out along one normal and let the clamp keep it sane.
      out.push([poly[i][0] + nNext[0] * t, poly[i][1] + nNext[1] * t]);
      continue;
    }
    mx /= mlen; mz /= mlen;
    const cos = mx * nNext[0] + mz * nNext[1];       // = cos(half-angle)
    const dist = Math.min(t / Math.max(0.12, Math.abs(cos)), t * MITER_LIMIT);
    out.push([poly[i][0] + mx * dist, poly[i][1] + mz * dist]);
  }
  return out;
}

/** One buildable piece of wall. `a`→`b` is the room-side face; `oa`→`ob` is the
 *  back of the same piece. Ends flagged `jamb` were cut by a doorway and need a
 *  cap face; ends not flagged are mitred corners shared with the neighbouring
 *  span, and capping them would put a wall across the corner. */
export type WallSpan = {
  /** Index of the polygon edge this came from — for naming and debugging. */
  edge: number;
  a: V2; b: V2;
  oa: V2; ob: V2;
  jambA: boolean;
  jambB: boolean;
};

export type OpeningRect = { x: number; z: number; w: number; d: number };

/**
 * Every wall piece this room needs.
 *
 * `openings` are axis-aligned rects (corridors, archways) that CUT the ring.
 * Each is clipped against each edge in edge-local 0..1 and the covered span
 * becomes a doorway. Clipping in edge-local coordinates is what makes an
 * opening work on a diagonal wall exactly as it does on an axis-aligned one.
 */
export function planWallRing(
  poly: Ring,
  thickness: number,
  openings: ReadonlyArray<OpeningRect> = [],
  /** Spans shorter than this are dropped — a 4cm pier beside a doorway is
   *  z-fighting, not architecture. */
  minSpan = 0.14,
  /** Pre-decided holes, edge-local (level/portals.ts). When given, these REPLACE
   *  the rect clipping entirely — one opening, computed once, and the ring stops
   *  guessing which edge a corridor came through. */
  cuts?: ReadonlyArray<{ edge: number; t0: number; t1: number }>,
): WallSpan[] {
  const n = poly.length;
  if (n < 3) return [];
  const ring = offsetRing(poly, thickness);
  const spans: WallSpan[] = [];

  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const nrm = edgeNormal(poly, i);

    // CUT THE PORTALS IF WE HAVE THEM.
    //
    // Rects are the legacy input and they cannot express "this corridor comes
    // through THAT edge". A corridor grazing a corner clips both edges, so the
    // ring punched two doorways for one way through — measured as 4.28m of wall
    // removed for 3.40m of corridor on poly-2. portals.ts already decides which
    // edge a corridor arrives on; handing the ring that decision is the whole
    // point of computing the opening once.
    const portalCuts = cuts?.filter((c) => c.edge === i).map((c) => [c.t0, c.t1] as [number, number]);

    // THE HOLE IS EXACTLY WHERE THE CORRIDOR IS — no padding along the edge.
    //
    // This used to clip the rect INFLATED by the wall thickness, which widened
    // every doorway by 2×t. Measured on 1203 real portals: the room's gap came
    // out 0.50m wider than the corridor, every single time. That surplus is
    // split between the two jambs, and behind each 25cm of missing room wall is
    // nothing at all — which is the "gaps where the void is visible" walking a
    // polygon floor.
    //
    // The padding was protecting a real case (a corridor stopping exactly ON the
    // wall plane would kiss the edge and leave a pane of stone across the
    // doorway), but it paid for that in the wrong axis. `padTouch` restores it
    // in the only axis it was ever about: if the unpadded clip finds nothing,
    // retry padded and take the ALONG-edge extent from the corridor's own
    // footprint rather than the inflated one.
    const gaps = portalCuts ?? openings
      .map((r) => clipEdgeToRect(a, b, r, 0) ?? narrowTo(a, b, r, clipEdgeToRect(a, b, r, thickness)))
      .filter((g): g is [number, number] => g !== null);
    const keep = subtractSpans(gaps);

    for (const [t0, t1] of keep) {
      if ((t1 - t0) * len < minSpan) continue;
      const atStart = t0 <= 1e-6, atEnd = t1 >= 1 - 1e-6;
      const ia: V2 = atStart ? a : [a[0] + dx * t0, a[1] + dz * t0];
      const ib: V2 = atEnd ? b : [a[0] + dx * t1, a[1] + dz * t1];
      // A corner end uses the MITRED ring point, so it coincides exactly with
      // the neighbouring span's. A cut end steps straight out along the edge
      // normal, which is what makes the jamb square to the doorway.
      const oa: V2 = atStart ? ring[i] : [ia[0] + nrm[0] * thickness, ia[1] + nrm[1] * thickness];
      const ob: V2 = atEnd ? ring[(i + 1) % n] : [ib[0] + nrm[0] * thickness, ib[1] + nrm[1] * thickness];
      spans.push({ edge: i, a: ia, b: ib, oa, ob, jambA: !atStart, jambB: !atEnd });
    }
  }
  return spans;
}

/**
 * A padded clip, pulled back to the rect's TRUE along-edge extent.
 *
 * Used only when the unpadded clip found nothing — a corridor that stops on the
 * wall plane instead of overlapping it. We still want a hole there, but a hole
 * the corridor's own width, not the inflated one. Clamps each end to the
 * nearest point of the real rect projected onto the edge.
 */
function narrowTo(
  a: V2, b: V2, r: OpeningRect, padded: [number, number] | null,
): [number, number] | null {
  if (!padded) return null;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return padded;
  // Project the rect's four corners onto the edge; the hole spans their range.
  const cs: V2[] = [
    [r.x - r.w / 2, r.z - r.d / 2], [r.x + r.w / 2, r.z - r.d / 2],
    [r.x + r.w / 2, r.z + r.d / 2], [r.x - r.w / 2, r.z + r.d / 2],
  ];
  let lo = Infinity, hi = -Infinity;
  for (const c of cs) {
    const t = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / len2;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  const t0 = Math.max(padded[0], lo), t1 = Math.min(padded[1], hi);
  return t1 > t0 ? [t0, t1] : null;
}

/**
 * Where does the axis-aligned rect `r` cover the edge a→b? Returns [t0, t1] in
 * edge-local 0..1, or null if it never touches.
 *
 * Liang–Barsky slab clipping. The rect is inflated by the wall thickness so a
 * corridor that stops exactly on the wall plane still cuts THROUGH it rather
 * than kissing it and leaving a pane of stone across the doorway.
 */
export function clipEdgeToRect(
  a: V2, b: V2, r: OpeningRect, pad: number,
): [number, number] | null {
  const minX = r.x - r.w / 2 - pad, maxX = r.x + r.w / 2 + pad;
  const minZ = r.z - r.d / 2 - pad, maxZ = r.z + r.d / 2 + pad;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;      // parallel: inside iff q >= 0
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!clip(-dx, a[0] - minX)) return null;
  if (!clip(dx, maxX - a[0])) return null;
  if (!clip(-dz, a[1] - minZ)) return null;
  if (!clip(dz, maxZ - a[1])) return null;
  return t1 > t0 ? [t0, t1] : null;
}

/** The parts of 0..1 NOT covered by any of `gaps`. */
export function subtractSpans(gaps: Array<[number, number]>): Array<[number, number]> {
  if (!gaps.length) return [[0, 1]];
  const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let cursor = 0;
  for (const [g0, g1] of sorted) {
    if (g0 > cursor) out.push([cursor, Math.min(1, g0)]);
    cursor = Math.max(cursor, g1);
    if (cursor >= 1) break;
  }
  if (cursor < 1) out.push([cursor, 1]);
  return out.filter(([p, q]) => q - p > 1e-6);
}
