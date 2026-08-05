// ── ROOM SHAPE v2: rooms are POLYGONS ────────────────────────────────────────
//
// The first piece of the generator that replaces the ASCII vaults. See
// docs/LEVEL-ARCHITECTURE.md §3 for why they're going (36 of 37 were a bordered
// rectangle; the whole library held 21 placed props) and §8 for what replaces
// them.
//
// A room's floor is an ORTHOGONAL POLYGON with optionally chamfered corners, not
// a rect and not a cell grid. That single change is what buys:
//
//   - non-blocky rooms. A finer grid gives you smaller stair-steps; a chamfer
//     gives you an actual diagonal wall. (LEVEL-ARCHITECTURE §7.)
//   - voids and obstacles as polygon ops instead of rasterised cells with a
//     rim-margin constant per consumer.
//   - shapes that respond to the size the floor plan hands them, instead of a
//     frozen 12x9 tilemap.
//
// ── HOW THE SHAPE IS BUILT ───────────────────────────────────────────────────
//
//   spine        one rect, the room's main axis
//   + lobes      1-3 rects unioned on — alcoves, transepts, a wider end
//   - bites      0-2 rects subtracted at corners — a notch, a collapse
//   ~ chamfer    convex corners cut at 45 degrees
//
// ── A NOTE ON THE UNION, BECAUSE IT LOOKS LIKE A GRID ────────────────────────
//
// The rect union is computed by rasterising at UNION_STEP and tracing the
// boundary. That is a grid — but it is a grid INSIDE one function, not a
// representation. Every rect is snapped to UNION_STEP first, so the trace is
// EXACT rather than approximate, and what comes out is a float polygon that
// nothing downstream re-samples. Doing polygon booleans properly would be more
// code for an identical answer on axis-aligned input.

/** A closed polygon in world metres. Points are in order; the closing edge from
 *  the last point back to the first is implied. */
export type Poly = ReadonlyArray<readonly [number, number]>;

export interface Rect { x: number; z: number; w: number; d: number }

/** Grid step for the boolean. Every rect snaps to it, so the trace is exact. */
const UNION_STEP = 0.5;

const snap = (v: number): number => Math.round(v / UNION_STEP) * UNION_STEP;

// ── boolean ──────────────────────────────────────────────────────────────────

/**
 * Union of `add` minus `sub`, as one polygon.
 *
 * Returns the LARGEST connected component — a bite that severs a lobe leaves an
 * island, and a room is one space by definition. Returns [] if nothing survives.
 */
export function combineRects(add: readonly Rect[], sub: readonly Rect[] = []): Poly {
  if (!add.length) return [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of add) {
    minX = Math.min(minX, snap(r.x - r.w / 2));
    maxX = Math.max(maxX, snap(r.x + r.w / 2));
    minZ = Math.min(minZ, snap(r.z - r.d / 2));
    maxZ = Math.max(maxZ, snap(r.z + r.d / 2));
  }
  const cols = Math.round((maxX - minX) / UNION_STEP);
  const rows = Math.round((maxZ - minZ) / UNION_STEP);
  if (cols <= 0 || rows <= 0) return [];

  const cell = new Uint8Array(cols * rows);
  const stamp = (r: Rect, v: 0 | 1): void => {
    const c0 = Math.round((snap(r.x - r.w / 2) - minX) / UNION_STEP);
    const c1 = Math.round((snap(r.x + r.w / 2) - minX) / UNION_STEP);
    const r0 = Math.round((snap(r.z - r.d / 2) - minZ) / UNION_STEP);
    const r1 = Math.round((snap(r.z + r.d / 2) - minZ) / UNION_STEP);
    for (let rr = Math.max(0, r0); rr < Math.min(rows, r1); rr++) {
      for (let cc = Math.max(0, c0); cc < Math.min(cols, c1); cc++) cell[rr * cols + cc] = v;
    }
  };
  for (const r of add) stamp(r, 1);
  for (const r of sub) stamp(r, 0);

  keepLargestComponent(cell, cols, rows);
  const loop = traceBoundary(cell, cols, rows);
  if (!loop.length) return [];
  return simplify(loop.map(([c, r]) => [minX + c * UNION_STEP, minZ + r * UNION_STEP] as const));
}

/** Flood from the biggest seed and clear everything else — a room is one space. */
function keepLargestComponent(cell: Uint8Array, cols: number, rows: number): void {
  const label = new Int32Array(cell.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < cell.length; i++) {
    if (!cell[i] || label[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const c = p % cols, r = (p - c) / cols;
      const push = (cc: number, rr: number): void => {
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return;
        const q = rr * cols + cc;
        if (cell[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      };
      push(c - 1, r); push(c + 1, r); push(c, r - 1); push(c, r + 1);
    }
    sizes.push(n);
  }
  if (sizes.length <= 1) return;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < cell.length; i++) if (label[i] !== best) cell[i] = 0;
}

/**
 * Trace the outer boundary as a sequence of GRID CORNERS.
 *
 * Walks edges counter-clockwise keeping filled cells on the left. Concave
 * corners and long straight runs both fall out; `simplify` then drops the
 * collinear points so a 20m wall is two vertices rather than forty.
 */
function traceBoundary(cell: Uint8Array, cols: number, rows: number): Array<[number, number]> {
  const filled = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && cell[r * cols + c] === 1;

  // Start at the lowest-then-leftmost filled cell's top-left corner.
  let sc = -1, sr = -1;
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (filled(c, r)) { sc = c; sr = r; break outer; }
  }
  if (sc < 0) return [];

  // Direction 0=+x, 1=+z, 2=-x, 3=-z. Start heading +x along the top edge.
  const out: Array<[number, number]> = [];
  let cx = sc, cz = sr, dir = 0;
  const MAX = cols * rows * 8;
  for (let guard = 0; guard < MAX; guard++) {
    out.push([cx, cz]);
    // At corner (cx,cz), the four cells touching it:
    //   NW = (cx-1, cz-1)  NE = (cx, cz-1)
    //   SW = (cx-1, cz)    SE = (cx, cz)
    // Turn LEFT if we can, else straight, else right, else back — the standard
    // square-tracing rule, which keeps the filled region on our left.
    const left: 0 | 1 | 2 | 3 = ((dir + 3) % 4) as 0 | 1 | 2 | 3;
    const tryDirs: Array<0 | 1 | 2 | 3> = [left, dir as 0 | 1 | 2 | 3,
      ((dir + 1) % 4) as 0 | 1 | 2 | 3, ((dir + 2) % 4) as 0 | 1 | 2 | 3];
    let moved = false;
    for (const d of tryDirs) {
      // The cell that must be filled for edge `d` to be a boundary we can walk.
      const ok =
        d === 0 ? filled(cx, cz) && !filled(cx, cz - 1) :
        d === 1 ? filled(cx - 1, cz) && !filled(cx, cz) :
        d === 2 ? filled(cx - 1, cz - 1) && !filled(cx - 1, cz) :
                  filled(cx, cz - 1) && !filled(cx - 1, cz - 1);
      if (!ok) continue;
      cx += d === 0 ? 1 : d === 2 ? -1 : 0;
      cz += d === 1 ? 1 : d === 3 ? -1 : 0;
      dir = d;
      moved = true;
      break;
    }
    if (!moved) break;
    if (cx === sc && cz === sr) break;
  }
  return out;
}

/** Drop points that sit on a straight line between their neighbours. */
function simplify(pts: ReadonlyArray<readonly [number, number]>): Poly {
  const n = pts.length;
  if (n < 3) return pts;
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

// ── chamfer ──────────────────────────────────────────────────────────────────

/**
 * Cut CONVEX corners at 45 degrees — the thing that actually makes a room stop
 * reading as blocky.
 *
 * Only convex corners (the ones that stick out) are cut; chamfering a concave
 * corner reads as damage rather than architecture. `amount` is clamped per corner
 * to a third of the shorter adjacent edge, so a chamfer can never eat a wall.
 */
export function chamfer(poly: Poly, amount: number, pick: (i: number) => boolean = () => true): Poly {
  const n = poly.length;
  if (n < 3 || amount <= 0) return poly;
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    // The traced outline has POSITIVE signed area, so a positive cross is the
    // convex (outward) turn. Verified rather than reasoned: a plain 8x6 box
    // traces to [[-4,-3],[4,-3],[4,3],[-4,3]] with signed area +48, and all four
    // of its corners are convex. Getting this backwards cut the concave corners
    // instead — which still produces a valid polygon, so only an area assertion
    // catches it.
    if (cross <= 0 || !pick(i)) { out.push(b); continue; }
    const lenAB = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lenBC = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = Math.min(amount, lenAB / 3, lenBC / 3);
    if (k < 0.2) { out.push(b); continue; }
    out.push([b[0] + (a[0] - b[0]) / lenAB * k, b[1] + (a[1] - b[1]) / lenAB * k]);
    out.push([b[0] + (c[0] - b[0]) / lenBC * k, b[1] + (c[1] - b[1]) / lenBC * k]);
  }
  return out;
}

// ── measurement ──────────────────────────────────────────────────────────────

export function polyArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function polyBounds(poly: Poly): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Even-odd point-in-polygon. THE walkability predicate for a v2 room — one
 *  question, continuous, no cell size and no rim margin to forget. */
export function pointInPoly(poly: Poly, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ── the archetypes ───────────────────────────────────────────────────────────

export type Archetype =
  | 'hall' | 'chamber' | 'apse' | 'ell' | 'cross' | 'notched'
  | 'rotunda' | 'tomb' | 'cavern' | 'wedge';

export const ARCHETYPES: readonly Archetype[] = [
  'hall', 'chamber', 'apse', 'ell', 'cross', 'notched',
  'rotunda', 'tomb', 'cavern', 'wedge',
];

/**
 * How hard each archetype wants its corners cut, as a FRACTION of the room's
 * short side. The chamfer is not a uniform polish pass — it's most of what makes
 * one archetype read differently from another. A rotunda is a square cut so hard
 * it becomes an octagon; a tomb is barely cut at all, because a tomb should read
 * as masonry.
 */
const CHAMFER_FRACTION: Record<Archetype, number> = {
  hall: 0.10, chamber: 0.10, apse: 0.16, ell: 0.08, cross: 0.07, notched: 0.06,
  rotunda: 0.30,   // square → octagon
  tomb: 0.03,      // cut masonry, sharp
  cavern: 0.26,    // carved, not built
  wedge: 0.14,
};

export interface ShapeOpts {
  /** Bounding size the floor plan handed this room. The shape fills it or less,
   *  never more. */
  w: number;
  d: number;
  rand: () => number;
  /** Corner cut in metres. 0 for hard corners. */
  chamfer?: number;
}

/**
 * Build a room floor.
 *
 * Every archetype is a handful of rects and one rule. The point is not that any
 * one is clever — it's that a shape RESPONDS to the size it's given, where a
 * tilemap could only ever be the size it was drawn at.
 */
export function generateRoomShape(kind: Archetype, opts: ShapeOpts): Poly {
  // Quantise the budget DOWN to the union step before anything is laid out.
  // combineRects snaps every rect edge to UNION_STEP, and snapping rounds to
  // NEAREST — so an un-quantised 12.6m budget could snap out to 13.0m and the
  // room would overlap its neighbour. Shrinking the budget first makes overflow
  // impossible rather than unlikely.
  const w = Math.floor(opts.w / UNION_STEP) * UNION_STEP;
  const d = Math.floor(opts.d / UNION_STEP) * UNION_STEP;
  const { rand } = opts;
  const j = (a: number, b: number): number => a + rand() * (b - a);
  const add: Rect[] = [];
  const sub: Rect[] = [];

  switch (kind) {
    case 'hall': {
      // Long spine, sometimes flaring at one end. Length is the point.
      const bw = Math.min(w, Math.max(4, d * j(0.55, 0.8)));
      add.push({ x: 0, z: 0, w: bw, d });
      // A hall ALWAYS gets something — either a flared end or a side recess.
      // Without this it is one rect, i.e. a rectangle, i.e. the thing we are
      // replacing: 41% of samples came out plain before the test caught it.
      if (rand() < 0.6) {
        const endD = j(2.5, 4);
        add.push({ x: 0, z: (d - endD) / 2 * (rand() < 0.5 ? 1 : -1), w: Math.min(w, bw * j(1.3, 1.7)), d: endD });
      } else {
        // Twin side recesses — a nave with shallow aisles.
        const recess = Math.min((w - bw) / 2, j(1.5, 2.5));
        if (recess >= 0.5) {
          const along = d * j(0.35, 0.6);
          for (const side of [-1, 1]) {
            add.push({ x: side * (bw + recess) / 2, z: j(-d / 6, d / 6), w: recess, d: along });
          }
        } else {
          const endD = j(2.5, 4);
          add.push({ x: 0, z: (d - endD) / 2 * (rand() < 0.5 ? 1 : -1), w: bw, d: endD });
        }
      }
      break;
    }
    case 'chamber': {
      // Near-square with a shallow alcove or two — the connective majority.
      // The alcoves eat INTO the budget rather than extending past it: the body
      // is inset by the alcove depth so the outer edge still lands on ±w/2.
      // Pushing them outward instead overflowed the room into its neighbour,
      // which is the bug the budget test caught.
      // Clamp the alcove depth so the body keeps a usable core AND the total
      // still fits. A Math.max floor on the body instead of a clamp on the depth
      // is what broke the budget on small rooms: on a 6.2m side the body floored
      // at 4m while the alcoves still reached out 2.5m, for 9m in a 6.2m slot.
      const MIN_CORE = 4;
      const depth = Math.min(j(1.5, 2.5), (w - MIN_CORE) / 2, (d - MIN_CORE) / 2);
      if (depth < 0.5) { add.push({ x: 0, z: 0, w, d }); break; }
      const bodyW = w - depth * 2;
      const bodyD = d - depth * 2;
      add.push({ x: 0, z: 0, w: bodyW, d: bodyD });
      const n = rand() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const onX = rand() < 0.5;
        const along = j(2.5, Math.max(3, (onX ? bodyD : bodyW) * 0.7));
        const side = rand() < 0.5 ? 1 : -1;
        add.push(onX
          ? { x: side * (bodyW + depth) / 2, z: j(-bodyD / 4, bodyD / 4), w: depth, d: along }
          : { x: j(-bodyW / 4, bodyW / 4), z: side * (bodyD + depth) / 2, w: along, d: depth });
      }
      break;
    }
    case 'apse': {
      // A body plus a narrower end that holds the focus. The chamfer does the
      // work here — a cut apse end reads as apsidal rather than as a bump.
      const bodyD = d * j(0.6, 0.75);
      const apseD = d - bodyD;
      add.push({ x: 0, z: (d - bodyD) / 2, w, d: bodyD });           // body, flush to +z
      add.push({ x: 0, z: -bodyD / 2, w: w * j(0.45, 0.65), d: apseD }); // apse, flush to −z
      break;
    }
    case 'ell': {
      // Two arms at right angles. Two sightlines that don't see each other,
      // which is the cheapest way to make a small room feel like two places.
      const armW = Math.max(3.5, w * j(0.45, 0.6));
      const armD = Math.max(3.5, d * j(0.45, 0.6));
      add.push({ x: -(w - armW) / 2, z: 0, w: armW, d });
      add.push({ x: 0, z: (d - armD) / 2 * (rand() < 0.5 ? 1 : -1), w, d: armD });
      break;
    }
    case 'cross': {
      const armW = Math.max(3.5, w * j(0.4, 0.55));
      const armD = Math.max(3.5, d * j(0.4, 0.55));
      add.push({ x: 0, z: 0, w: armW, d });
      add.push({ x: 0, z: 0, w, d: armD });
      break;
    }
    case 'rotunda': {
      // A square cut so hard it reads as a polygon room. The heaviest chamfer in
      // the table does the work — this is the only shape in the set with no
      // dominant axis, which is exactly why it stands out among halls and ells.
      const side = Math.min(w, d);
      add.push({ x: 0, z: 0, w: side, d: side });
      // A shallow cross of lobes stops it from being a plain octagon.
      if (rand() < 0.6) {
        const lobe = side * j(0.12, 0.2);
        add.push({ x: 0, z: 0, w: Math.min(w, side + lobe * 2), d: side * j(0.45, 0.6) });
        add.push({ x: 0, z: 0, w: side * j(0.45, 0.6), d: Math.min(d, side + lobe * 2) });
      }
      break;
    }
    case 'tomb': {
      // Long and narrow with burial niches down both sides. The niches are part
      // of the SHAPE, not props — a recess you can step into reads completely
      // differently from an alcove model stood against a flat wall.
      const naveW = Math.max(3, Math.min(w * 0.5, 5));
      add.push({ x: 0, z: 0, w: naveW, d });
      const nicheD = Math.min((w - naveW) / 2, j(1.2, 2));
      if (nicheD >= 0.5) {
        const count = Math.max(2, Math.floor(d / j(3, 4.5)));
        const span = d / count;
        for (let i = 0; i < count; i++) {
          const z = -d / 2 + span * (i + 0.5);
          const nicheLen = Math.min(span * 0.6, 2.5);
          for (const side of [-1, 1]) {
            if (rand() < 0.22) continue;   // a few collapsed or bricked up
            add.push({ x: side * (naveW + nicheD) / 2, z, w: nicheD, d: nicheLen });
          }
        }
      }
      break;
    }
    case 'cavern': {
      // Not built — carved. Many overlapping rects at wandering offsets, then
      // the second-heaviest chamfer. The only shape in the set with no straight
      // through-line, which is what makes it read as natural rather than ruined.
      const blobs = 4 + Math.floor(rand() * 3);
      for (let i = 0; i < blobs; i++) {
        const bw = w * j(0.35, 0.62);
        const bd = d * j(0.35, 0.62);
        add.push({
          x: j(-(w - bw) / 2, (w - bw) / 2),
          z: j(-(d - bd) / 2, (d - bd) / 2),
          w: bw, d: bd,
        });
      }
      break;
    }
    case 'wedge': {
      // Tapers along its length — you can tell which way you're facing from the
      // walls alone, which no symmetric room gives you.
      const steps = 3 + Math.floor(rand() * 2);
      const wide = w, narrow = w * j(0.35, 0.55);
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const sw = wide + (narrow - wide) * t;
        const sd = d / steps;
        add.push({ x: 0, z: -d / 2 + sd * (i + 0.5), w: sw, d: sd });
      }
      break;
    }
    case 'notched': {
      // A rectangle the dungeon took a bite out of. Collapse, not design.
      add.push({ x: 0, z: 0, w, d });
      const n = rand() < 0.6 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const bw = j(2, Math.max(2.5, w * 0.35));
        const bd = j(2, Math.max(2.5, d * 0.35));
        sub.push({
          x: (rand() < 0.5 ? -1 : 1) * (w - bw) / 2,
          z: (rand() < 0.5 ? -1 : 1) * (d - bd) / 2,
          w: bw, d: bd,
        });
      }
      break;
    }
  }

  const poly = combineRects(add, sub);
  // Chamfer scales with the ROOM, not with a global constant — a 1.1m cut is a
  // detail on a 16m hall and a demolition on a 6m closet.
  const cut = opts.chamfer ?? CHAMFER_FRACTION[kind] * Math.min(w, d);
  if (cut <= 0) return poly;
  // Rotunda and cavern cut EVERY corner; the built shapes cut most, so a few
  // sharp corners survive and the room still reads as masonry.
  const all = kind === 'rotunda' || kind === 'cavern';
  return chamfer(poly, cut, () => all || rand() < 0.75);
}

// ── CEILINGS ─────────────────────────────────────────────────────────────────
//
// Measured 2026-08-05 on 846 generated rooms: **772 of them have a 3.2m
// ceiling.** Ceiling STYLE already varied (flat / barrel / pitched, by depth and
// tag) but HEIGHT came from `Vault.roomHeight`, an optional per-vault override
// that almost nothing set — so nearly every room in the game is exactly as tall
// as every other room. That single constant is a large part of "the floors feel
// same-y", and it costs nothing to fix because height is already a field.
//
// The rule: **a room's height comes from its FOOTPRINT and its ARCHETYPE.** A
// big room that is only 3.2m tall reads as a warehouse; a small room that is 6m
// tall reads as a shaft. Both are wrong, and both are what a constant produces.

export interface Ceiling {
  /** Wall height in metres. */
  height: number;
  style: 'flat' | 'barrel' | 'pitched';
  /** Extra rise at the crown for barrel/pitched. */
  rise: number;
}

/** Metres of ceiling per metre of room "span" (the geometric mean of the
 *  footprint's sides). Squat rooms feel like cellars; this is the slope that
 *  makes a big room feel like a hall without making a corridor feel like a well. */
// Calibrated to keep the CRUSH. The first pass put a median room at 5.7m and a
// rotunda at 8.3m, which reads as a cathedral — and DELVE's oppression is part
// of its identity (CLAUDE.md: grimdark through restraint). Trading "everything
// is 3.2m" for "everything is 6m" would be the same mistake wearing a hat.
//
// The target spread: small and tomb-like rooms stay at or below today's 3.2m,
// the common case lands 3.4-4.5m, and only genuinely big or ceremonial rooms
// reach past 6m — so height BECOMES A SIGNAL instead of a setting.
const HEIGHT_PER_SPAN = 0.19;
const HEIGHT_MIN = 2.4;
// Capped well under the first pass's 9m: torch mounts, hanging chandeliers and
// the wall shell all assume a room you can light from a 2.4m sconce.
const HEIGHT_MAX = 7.5;

/** Per-archetype ceiling character — a multiplier on the size-derived height,
 *  plus the vault style that suits the plan. A tomb is low and flat because it
 *  was cut to fit a body; a rotunda is tall and domed because it was built to be
 *  stood in. This is where an archetype stops being a floor outline and starts
 *  being a KIND OF PLACE. */
const CEILING_CHARACTER: Record<Archetype, { mul: number; style: Ceiling['style']; rise: number }> = {
  hall:     { mul: 1.15, style: 'barrel',  rise: 1.4 },
  chamber:  { mul: 1.00, style: 'flat',    rise: 0 },
  apse:     { mul: 1.25, style: 'barrel',  rise: 1.8 },
  ell:      { mul: 0.95, style: 'flat',    rise: 0 },
  cross:    { mul: 1.20, style: 'barrel',  rise: 1.6 },
  notched:  { mul: 0.90, style: 'pitched', rise: 0.9 },
  rotunda:  { mul: 1.45, style: 'barrel',  rise: 2.6 },   // built to be stood in
  tomb:     { mul: 0.80, style: 'flat',    rise: 0 },     // cut to fit a body
  cavern:   { mul: 1.10, style: 'pitched', rise: 1.9 },   // no ceiling, a roof of rock
  wedge:    { mul: 1.00, style: 'pitched', rise: 1.1 },
};

/**
 * How tall this room should be.
 *
 * `span` is the geometric mean of the footprint's sides — better than area
 * alone, because a 20×4 corridor and an 9×9 chamber have the same area and
 * should NOT have the same ceiling.
 *
 * `variance` (0..1) is a per-room jitter so two rooms of the same size and kind
 * still differ; pass a seeded random.
 */
export function ceilingFor(kind: Archetype, w: number, d: number, variance = 0.5): Ceiling {
  const span = Math.sqrt(Math.max(1, w) * Math.max(1, d));
  const c = CEILING_CHARACTER[kind];
  const jitter = 0.88 + variance * 0.24;                  // ±12%
  const raw = (HEIGHT_MIN + span * HEIGHT_PER_SPAN) * c.mul * jitter;
  const height = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, raw)) * 10) / 10;
  return { height, style: c.style, rise: c.rise };
}
