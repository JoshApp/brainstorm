import type * as THREE from 'three';
import { MASONRY_UV_TAG, WALL_TILE } from '../style/stone-grid';

// ── THE WALL UNWRAP: ONE COORDINATE AROUND THE ROOM ──────────────────────────
//
// Josh: *"we tried to make the wall texture seamless but in some places the
// texture is still misaligned over corners."*
//
// The wall shader lays stone along each wall's OWN direction (surface-detail.ts:
// U = position · along-the-wall). That fixed the stretch on chamfers and left the
// PHASE to chance: at a corner C, wall A reads U = C·tA and wall B reads U = C·tB,
// two unrelated numbers, so every vertical joint jumps at every corner. Courses
// line up (V is world Y on both), blocks do not. Two rounds were spent hiding the
// jump — the corner field fades the joints out near a corner, and real quoin
// blocks were built and then removed — but the jump was still there underneath.
//
// It cannot be fixed per wall, from the fragment or from the wall alone: offsets
// that make one corner agree move the next, and a ring of N corners only closes
// if the offsets are solved TOGETHER. That is arc length. Walk the room's outline
// once, measuring, and every point on the wall gets its distance around the ring:
// the coordinate arriving at a corner on one wall is the coordinate leaving it on
// the next, by construction, at any angle.
//
// THE RING STILL HAS TO CLOSE. Its perimeter is not a whole number of tiles, so
// coming all the way round would land mid-stone. The stones are stretched to fit
// instead — a 40m room changes stone width by at most 6%, which nothing can see,
// and there is no seam anywhere. Where a ring has a gap with NO wall over it (a
// corridor's open end) the seam is put there instead and nothing is stretched.
//
// The coordinate travels in the uv attribute every wall geometry already carries
// (see MASONRY_UV_TAG). Faces that are not the room-side face of the wall — a
// doorway's jamb, a recessed band's return — are left untagged and keep the
// shader's own projection: they are a hand's breadth wide and their stone
// belongs to the wall's thickness, not to its run.

export type V2 = readonly [number, number];

export interface RingUnwrap {
  /** Unstretched arc length at the START of each edge, measured from the seam. */
  readonly start: readonly number[];
  /** Arc length of the whole ring. */
  readonly perimeter: number;
  /** Multiplier from arc metres to texture metres. 1 when the seam is hidden. */
  readonly stretch: number;
  /** Arc position of the seam on the unseamed ring (0 = vertex 0). */
  readonly origin: number;
}

/**
 * Measure a closed ring. `seamAt` is an arc position (metres from vertex 0) where
 * no wall stands — the coordinate restarts there and is not stretched. Without one
 * the ring is stretched to a whole number of `period`s so it closes seamlessly.
 */
export function unwrapRing(ring: ReadonlyArray<V2>, seamAt?: number, period = WALL_TILE[0]): RingUnwrap {
  const n = ring.length;
  const start: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    start.push(acc);
    const a = ring[i], b = ring[(i + 1) % n];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const perimeter = acc;
  if (seamAt !== undefined || perimeter <= 1e-6) {
    return { start, perimeter, stretch: 1, origin: seamAt ?? 0 };
  }
  const tiles = Math.max(1, Math.round(perimeter / period));
  return { start, perimeter, stretch: (tiles * period) / perimeter, origin: 0 };
}

/** Arc position (metres from vertex 0) of the point `t` along edge `edge`. */
export function arcAt(u: RingUnwrap, edge: number, t: number): number {
  return u.start[edge] + t;
}

/**
 * The texture-space U at a point on edge `edge` of the ring, `along` metres from
 * the edge's start vertex. `ref` is a point a little way INTO the face this value
 * belongs to (in the same along-edge metres): it decides which side of the seam a
 * value sitting exactly on the seam is on, so a face ending at the seam reads the
 * ring's full length rather than wrapping back to zero halfway across itself.
 */
export function ringU(u: RingUnwrap, edge: number, along: number, ref = along): number {
  const P = u.perimeter;
  if (P <= 1e-6) return 0;
  const rel = (s: number) => ((s - u.origin) % P + P) % P;
  // Which lap of the ring the face is on is decided once, at `ref`, and the point
  // is measured from there — linear across the face, never wrapping inside it.
  const refArc = arcAt(u, edge, ref);
  const base = rel(refArc);
  return (base + (along - ref)) * u.stretch;
}

/**
 * Tag the room-side face of a wall piece with its ring coordinate.
 *
 * `geo` is in WORLD space. The edge runs from `a` along unit `dir`, and `inward`
 * is the room-side normal; vertices whose normal agrees with it are the face and
 * get (U, TAG + y), every other vertex is left exactly as it was. The face is one
 * plane, so its U is linear in position and interpolates exactly.
 */
export function tagWallFace(
  geo: THREE.BufferGeometry,
  u: RingUnwrap, edge: number,
  a: V2, dir: V2, inward: V2,
): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!pos || !nrm || !uv) return;
  // One reference for the whole piece — its midpoint along the edge — so every
  // vertex of it is measured on the same lap of the ring.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) - a[0]) * dir[0] + (pos.getZ(i) - a[1]) * dir[1];
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  if (!Number.isFinite(lo)) return;
  const ref = (lo + hi) / 2;
  for (let i = 0; i < pos.count; i++) {
    const facing = nrm.getX(i) * inward[0] + nrm.getZ(i) * inward[1];
    if (facing < 0.7) continue;
    const t = (pos.getX(i) - a[0]) * dir[0] + (pos.getZ(i) - a[1]) * dir[1];
    uv.setXY(i, ringU(u, edge, t, ref), MASONRY_UV_TAG + pos.getY(i));
  }
  uv.needsUpdate = true;
}

// ── A CORRIDOR'S WALLS: ONE COORDINATE ALONG EACH SIDE ───────────────────────
//
// A corridor is several rects (legs and the landings at their turns), and each
// rect unwrapped its walls on its OWN ring. Where a leg's wall carries straight
// on into its landing's, the two rings disagree and every vertical joint jumps
// at the seam (Josh, 2026-11-24: "a bit of a texture discontinuity there on the
// walls"). The link knows the whole path, so each side of it is measured once:
// the centreline offset by half the passage to the left and to the right, arc
// length along that chain. Straight joins agree by construction and the turn
// is walked round like a ring's corner.
//
// Same direction rule as the ring: U grows with travel when the room-side
// normal is to the travel's right (cross(travel, inward) > 0). The right-hand
// chain runs with the path, so it counts up; the left-hand one counts down.

/** U at a world point on one of the link's walls. */
export function linkChainU(legs: ReadonlyArray<{ from: V2; to: V2 }>, half: number): (x: number, z: number) => number {
  const pts: V2[] = [legs[0].from, ...legs.map((l) => l.to)];
  const dirs: V2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const L = Math.hypot(dx, dz) || 1;
    dirs.push([dx / L, dz / L]);
  }
  // Offset chains, mitred at each turn. left = (-dz, dx) of the travel.
  const chain = (side: 1 | -1): V2[] => pts.map((p, i) => {
    const d1 = dirs[Math.max(0, i - 1)], d2 = dirs[Math.min(dirs.length - 1, i)];
    const l1: V2 = [-d1[1], d1[0]], l2: V2 = [-d2[1], d2[0]];
    const k = half * side / (1 + l1[0] * l2[0] + l1[1] * l2[1]);
    return [p[0] + (l1[0] + l2[0]) * k, p[1] + (l1[1] + l2[1]) * k] as V2;
  });
  const sides = ([1, -1] as const).map((side) => {
    const c = chain(side);
    const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
    return { side, c, cum };
  });
  return (x, z) => {
    let best = Infinity, u = 0;
    for (const { side, c, cum } of sides) {
      for (let i = 0; i + 1 < c.length; i++) {
        const ax = c[i][0], az = c[i][1];
        const sx = c[i + 1][0] - ax, sz = c[i + 1][1] - az;
        const L2 = sx * sx + sz * sz || 1;
        let t = ((x - ax) * sx + (z - az) * sz) / L2;
        // The ends of the path run on into their rooms; inner joints clamp.
        if (i > 0) t = Math.max(0, t);
        if (i + 2 < c.length) t = Math.min(1, t);
        const px = ax + sx * t, pz = az + sz * t;
        const dist = Math.hypot(x - px, z - pz);
        if (dist < best - 1e-6) {
          best = dist;
          const arc = cum[i] + t * Math.sqrt(L2);
          u = side === -1 ? arc : -arc;   // right-hand chain counts up
        }
      }
    }
    return u;
  };
}

/** Re-tag the U of every masonry-tagged vertex from a chain (see linkChainU). */
export function retagWallU(geos: readonly THREE.BufferGeometry[], uAt: (x: number, z: number) => number): void {
  for (const g of geos) {
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (!pos || !uv) continue;
    for (let i = 0; i < pos.count; i++) {
      if (uv.getY(i) < MASONRY_UV_TAG / 2) continue;
      uv.setX(i, uAt(pos.getX(i), pos.getZ(i)));
    }
    uv.needsUpdate = true;
  }
}
