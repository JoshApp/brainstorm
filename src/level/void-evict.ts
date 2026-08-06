import type { PropSpec, WalkableRect } from './types';

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

/** Room/corridor rects, so a nudged prop lands on real floor rather than in the
 *  gap between two rooms. */
export interface EvictSurface {
  floors: readonly WalkableRect[];
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

/** Solid ground: inside some floor rect and outside every void. */
function solid(x: number, z: number, s: EvictSurface): boolean {
  if (overVoid(x, z, s.voids)) return false;
  return s.floors.some((r) => inRect(x, z, r, -0.35));   // inset, so not in a wall
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
