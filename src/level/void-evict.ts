import type { PropSpec, WalkableRect } from './types';
import { pointInPoly, type Poly } from './room-shape';

// ── NOTHING STANDS OVER A HOLE ───────────────────────────────────────────────
//
// Josh: *"void carves under wells/basins — props left hanging over the pit."*
//
// Three separate producers already try to prevent this and each one is right
// about its own half:
//
//   - `clutter.ts` rejects a cell within VOID_MARGIN of a void.
//   - `placement-authority.ts` refuses any non-hazard claim inside one.
//   - `vault-compose.ts`'s `freeAt` tests the real void RECTS with a lip,
//     because the occupancy grid is cell-quantised and a rect that covers three
//     quarters of a cell leaves that cell unreserved.
//
// And 17 props across 320 floors were still standing in mid-air, because none of
// those three covers the case that actually produced them: a vault whose ASCII
// AUTHORS a trap on a cell its own authored void rect happens to swallow. No
// placement decision was made at runtime, so no runtime check ran.
//
// The lesson is the one docs/DESIGN-METHOD.md already states — CHECK FINAL-STATE
// RULES AGAINST THE FINAL STATE. "Nothing stands over a hole" is a property of
// the finished floor, and every attempt to enforce it at proposal time is one
// producer away from being wrong again. So this runs LAST, on the assembled
// spec, and asks the only question that matters: is anything inside a void now?
//
// ── NUDGE, THEN DROP ─────────────────────────────────────────────────────────
//
// A spike trap over a pit can simply go — it is texture and the room has others.
// A bonfire cannot: deleting a floor's one mercy because a rift clipped it is a
// worse bug than the one being fixed. So the pass tries to MOVE a prop to solid
// ground first, out in a widening ring, and only drops it when there is nowhere
// within reach. Both outcomes are counted, because a pass that silently deletes
// content looks exactly like a floor that never had any.

/**
 * Room/corridor floors, so a nudged prop lands on real floor rather than in the
 * gap between two rooms.
 *
 * A floor may carry its POLYGON, and where it does the polygon is what counts.
 * Testing the rect alone is the codebase's oldest bug wearing a new hat — **a
 * polygon room is not its bounding box** — and it shipped here: the ring search
 * pushed a wall-rune 24cm through the wall of an ell, because the spot it found
 * was inside the room's bounding box and outside the room. One in 133, and
 * invisible until the corridor rework moved a wall under it.
 *
 * Corridors have no polygon and pass none; their rect IS their shape.
 */
export interface EvictSurface {
  floors: ReadonlyArray<WalkableRect & { poly?: Poly }>;
  voids: readonly WalkableRect[];
}

export interface EvictReport {
  /** Props moved to solid ground. */
  nudged: number;
  /** Props removed because nowhere within reach was solid. */
  dropped: number;
  /** By prop kind, for the audit — which producer keeps doing this. */
  byKind: Record<string, number>;
}

/** Margin kept between a nudged prop and the void's edge. A thing balanced on
 *  the lip reads as badly as one over the middle. */
const LIP = 0.4;
/** Rings tried, in metres. Short first — a prop clipped by a rift's corner
 *  usually only needs to step aside, and a big jump would break whatever
 *  composition put it there. */
const RINGS_M = [0.6, 1.0, 1.5, 2.2];
const RAYS = 12;

const inRect = (x: number, z: number, r: WalkableRect, pad = 0): boolean =>
  Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad;

/** Is this point over a hole (or on its lip)? */
export function overVoid(x: number, z: number, voids: readonly WalkableRect[]): boolean {
  return voids.some((v) => inRect(x, z, v, LIP));
}

/** Solid ground: inside some floor's actual shape, and outside every void. */
function solid(x: number, z: number, s: EvictSurface): boolean {
  if (overVoid(x, z, s.voids)) return false;
  return s.floors.some((r) => (r.poly
    // Inside the polygon AND off its wall line — a point exactly on the
    // boundary is a prop embedded in masonry, which is what this is preventing.
    ? pointInPoly(r.poly, x, z) && !nearPolyEdge(r.poly, x, z, 0.3)
    : inRect(x, z, r, -0.35)));   // inset, so not in a wall
}

/** Is this point within `pad` of the polygon's outline? */
function nearPolyEdge(poly: Poly, x: number, z: number, pad: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    if (Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) < pad) return true;
  }
  return false;
}

/** Nearest solid spot on a widening ring, or null if there isn't one nearby. */
function nearestSolid(x: number, z: number, s: EvictSurface): { x: number; z: number } | null {
  for (const r of RINGS_M) {
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const nx = x + Math.cos(a) * r;
      const nz = z + Math.sin(a) * r;
      if (solid(nx, nz, s)) return { x: nx, z: nz };
    }
  }
  return null;
}

/**
 * Move or remove every prop standing over a hole. Mutates `props` in place and
 * returns what it had to do.
 *
 * Deliberately NOT rand-driven: this is a correction, and a correction that
 * varied by seed would make the same floor right on one run and wrong on the
 * next.
 */
export function evictFromVoids(props: PropSpec[], s: EvictSurface): EvictReport {
  const report: EvictReport = { nudged: 0, dropped: 0, byKind: {} };
  if (!s.voids.length) return report;

  const keep: PropSpec[] = [];
  for (const p of props) {
    const q = p as { kind: string; x: number; z: number; model?: { id?: string } };
    if (typeof q.x !== 'number' || typeof q.z !== 'number' || !overVoid(q.x, q.z, s.voids)) {
      keep.push(p);
      continue;
    }
    const label = q.kind === 'model' ? `model:${q.model?.id ?? '?'}` : q.kind;
    report.byKind[label] = (report.byKind[label] ?? 0) + 1;
    const spot = nearestSolid(q.x, q.z, s);
    if (spot) {
      q.x = spot.x; q.z = spot.z;
      report.nudged++;
      keep.push(p);
    } else {
      report.dropped++;
    }
  }
  props.length = 0;
  props.push(...keep);
  return report;
}
