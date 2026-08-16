// ── THE STONE GRID ───────────────────────────────────────────────────────────
//
// Josh: *"if we do this kinda wall irregularities shouldn't that sync with the
// stone shader so it doesn't read chaotic?"*
//
// Yes, and it is the sharpest note in the batch. The dungeon draws its masonry
// TWICE, from two places that had never been introduced:
//
//   - surface-textures.ts bakes a tiling stone pattern, world-projected. Walls
//     are a running bond of bricks; floors are a Voronoi of irregular slabs.
//   - wall-courses.ts builds REAL GEOMETRY — courses with depth, broken blocks,
//     a tinted slab pattern on the floor plate.
//
// Each was reasonable alone and each invented its own numbers: 0.6m courses in
// the texture against 0.42m courses in the geometry, 1.05m Voronoi slabs against
// a 1.15m rectangular grid. Two patterns at different scales on one surface is
// not twice the detail; it is noise, and the eye reads it as exactly that.
//
// This module is the single grid both of them lay stone on. It is deliberately
// tiny, pure, and free of THREE — the texture baker and the geometry builder
// both import it, so they cannot drift apart again, and a third consumer (a
// decal placer, a damage pass) gets the same answer for free.
//
// ── WHAT ALIGNS, AND WHAT ONLY SHARES A SCALE ────────────────────────────────
//
// The textures are WORLD-PROJECTED (see surface-detail.ts): a wall's vertical
// texture axis is ALWAYS world Y, and a floor's axes are world X/Z. So:
//
//   - COURSES ALIGN EXACTLY, on every wall, at any angle. Course lines live at
//     world Y = k · COURSE_H, and geometry authored to that grid puts its
//     light-catching step precisely where the texture puts its mortar line.
//   - FLOOR SLABS ALIGN EXACTLY, because both read `flagstoneCell` at the same
//     world point.
//   - A WALL'S VERTICAL JOINTS only align on an AXIS-ALIGNED wall, because the
//     texture's horizontal axis is a world axis while a polygon wall's own axis
//     runs at whatever angle the room wanted. Sharing BRICK_W still matters:
//     agreeing about how big a stone is, is most of what stops two patterns
//     reading as two patterns. Perfect phase on a slanted wall is not available
//     and is not what the eye is complaining about.

/** Course height, world metres. The texture's brick rows and the geometry's
 *  courses are both this tall, and both start from world Y = 0. */
export const COURSE_H = 0.6;

/** Brick width, world metres. Alternate courses are laid offset by half of it
 *  (running bond) in the texture; geometry that cuts a block should use the
 *  same size so a proud stone is ONE stone rather than a stone and a half. */
export const BRICK_W = 1.15;

/** Voronoi flagstone cell size, world metres, and the period the pattern
 *  repeats over. Both must match the baked floor texture exactly. */
export const FLAG_CELL = 1.05;
export const FLAG_PERIOD = 5;

// ── VARIABLE COURSING — size, not wobble ────────────────────────────────────
//
// Josh, looking at reference masonry: *"they almost do no wobble but rather have
// some stones bigger and smaller work together, and in some screenshots some are
// way bigger / smaller."*
//
// That is a different MODEL of irregularity from the one this grid had, and the
// better one. Ours came from wobble — a domain warp bending the whole grid and a
// per-brick jitter nudging boundaries — so every joint was slightly off-true.
// Real masons produce the opposite: every joint dead straight, struck against a
// line, but the STONES are different sizes because that is what came out of the
// quarry. Wobble reads as melted; size variation reads as built. It is also why
// no amount of grit or erosion could rescue the wall — the detail was sitting on
// a grid whose fundamental structure said "machine-made, then bent".
//
// So courses vary in HEIGHT and blocks vary in WIDTH, and nothing bends.
//
// ── WHY IT LIVES HERE ───────────────────────────────────────────────────────
// This module exists so the texture and the real geometry cannot invent
// different masonry (see the header). A variable grid makes that far easier to
// get wrong than a constant did: COURSE_H is a number anyone can read, whereas
// "where does course 5 start" is a computation, and two implementations of a
// computation drift. So the table is built once here and both sides ask it.
//
// The variation amounts are pushed in rather than imported, because this module
// is deliberately free of the knob system and of THREE — whoever owns the
// sliders calls setStoneVariation and every consumer sees the same grid.
//
// PERIODS ARE UNCHANGED: 8 courses over 4.8m and 4 nominal blocks over 4.6m are
// exactly the tile the texture already repeats on, so seamlessness is preserved
// by construction rather than by tuning.
export const COURSES_PER_TILE = 8;
export const BLOCKS_PER_TILE = 4;
const TILE_H = COURSE_H * COURSES_PER_TILE;
const TILE_W = BRICK_W * BLOCKS_PER_TILE;

// ── AND SOME STONES SPAN TWO COURSES ────────────────────────────────────────
// Josh: *"its boring if the walls are always as big as the strip. the most
// interesting thing was something where there were also bigger stones and then
// side to side with smaller stones."*
//
// Right, and varying the widths could never give it. However much a course's
// stones differ from each other, every one of them is still exactly one course
// tall, so the wall stays a stack of ribbons. The thing the reference has is a
// stone that is TWICE as tall as its neighbours, with two small ones stacked
// beside it — and that is a two-dimensional fact the row-by-row table could not
// express.
//
// So the grid stops being rows of blocks and becomes a LIST OF STONES, each
// with its own rectangle. Courses may PAIR: a paired pair shares one set of
// vertical joints, and each column within it is either one tall stone or two
// stacked ones. That is exactly how mixed ashlar is laid, and it is the smallest
// change that makes "bigger stones side by side with smaller" representable at
// all rather than approximable.
//
// Pairing is decided per course from the hash and never straddles the tile
// boundary, so the wall still repeats seamlessly — checked, not assumed.
let vCourse = 0, vBlock = 0, vTall = 0;

export interface Stone { x0: number; x1: number; y0: number; y1: number; ix: number; iy: number; }
let courseEdges: number[] = [];
/** Stones bucketed by the course they START in, so a lookup only ever scans one
 *  or two small buckets rather than the whole tile. */
let stonesByCourse: Stone[][] = [];

function widths(seed: number, n: number, total: number, vary: number): number[] {
  const w: number[] = []; let t = 0;
  for (let i = 0; i < n; i++) {
    const k = 1 + (stoneHash(seed, i, 5.77) - 0.5) * 2 * vary;
    w.push(Math.max(0.25, k)); t += k > 0.25 ? k : 0.25;
  }
  return w.map((k) => (k / t) * total);
}

function rebuildGrid(): void {
  // COURSES. Weights from the hash, normalised so they sum to the tile exactly —
  // normalising rather than clamping is what keeps the pattern seamless however
  // wild the variation gets.
  const cw: number[] = []; let tot = 0;
  for (let i = 0; i < COURSES_PER_TILE; i++) {
    const k = Math.max(0.25, 1 + (stoneHash(i, 0, 3.31) - 0.5) * 2 * vCourse);
    cw.push(k); tot += k;
  }
  courseEdges = [0];
  let acc = 0;
  for (let i = 0; i < COURSES_PER_TILE; i++) { acc += (cw[i] / tot) * TILE_H; courseEdges.push(acc); }
  courseEdges[COURSES_PER_TILE] = TILE_H;

  // PAIRING. A course may pair with the one above it, but only if that one is
  // inside the tile and not already spoken for — otherwise a pair would wrap and
  // the texture would seam.
  const paired: boolean[] = new Array(COURSES_PER_TILE).fill(false);
  for (let c = 0; c < COURSES_PER_TILE - 1; c++) {
    if (paired[c]) continue;
    if (stoneHash(c, 2, 8.19) < vTall) { paired[c] = true; paired[c + 1] = true; }
  }

  stonesByCourse = Array.from({ length: COURSES_PER_TILE }, () => [] as Stone[]);
  const spread = Math.round(vBlock * 2.4);
  for (let c = 0; c < COURSES_PER_TILE; c++) {
    const isPairLower = paired[c] && !(c > 0 && paired[c - 1] && stoneHash(c - 1, 2, 8.19) < vTall);
    // The upper half of a pair places nothing of its own — its stones belong to
    // the column decisions made below.
    if (paired[c] && !isPairLower) continue;

    const n = Math.max(2, BLOCKS_PER_TILE + Math.round((stoneHash(c, 1, 7.13) - 0.5) * 2 * spread));
    const ws = widths(c, n, TILE_W, vBlock);
    // Running bond at zero width-variation, faded out as real variation arrives.
    const bond = (c % 2 === 1) ? BRICK_W * 0.5 * (1 - Math.min(1, vBlock)) : 0;
    let x = -bond;
    const yLo = courseEdges[c];
    const yMid = courseEdges[c + 1];
    const yHi = isPairLower ? courseEdges[c + 2] : yMid;
    for (let i = 0; i < n; i++) {
      const x0 = x, x1 = x + ws[i]; x = x1;
      if (!isPairLower) {
        stonesByCourse[c].push({ x0, x1, y0: yLo, y1: yMid, ix: i, iy: c });
      } else if (stoneHash(c, i, 2.53) < 0.45) {
        // ONE TALL STONE across both courses.
        stonesByCourse[c].push({ x0, x1, y0: yLo, y1: yHi, ix: i, iy: c });
      } else {
        // Two stacked, and the split is not the halfway point — a pair of
        // unequal stones reads as laid, an even split reads as a grid.
        const split = yLo + (yHi - yLo) * (0.34 + stoneHash(c, i, 9.02) * 0.32);
        stonesByCourse[c].push({ x0, x1, y0: yLo, y1: split, ix: i, iy: c });
        stonesByCourse[c].push({ x0, x1, y0: split, y1: yHi, ix: i + 64, iy: c });
      }
    }
  }
}

/** Set how far the masonry departs from the uniform grid. All zero = the old
 *  constant grid exactly, so this is off until someone asks for it. */
export function setStoneVariation(courseVar: number, blockVar: number, tallVar = 0): void {
  if (courseVar === vCourse && blockVar === vBlock && tallVar === vTall && courseEdges.length) return;
  vCourse = courseVar; vBlock = blockVar; vTall = tallVar;
  rebuildGrid();
}

/** Which course world-Y lands in. Kept for consumers that only need the row. */
export function courseAt(y: number): { i: number; y0: number; y1: number } {
  if (!courseEdges.length) rebuildGrid();
  const tiles = Math.floor(y / TILE_H);
  const ly = y - tiles * TILE_H;
  for (let i = 0; i < COURSES_PER_TILE; i++) {
    if (ly < courseEdges[i + 1]) {
      return { i, y0: tiles * TILE_H + courseEdges[i], y1: tiles * TILE_H + courseEdges[i + 1] };
    }
  }
  const last = COURSES_PER_TILE - 1;
  return { i: last, y0: tiles * TILE_H + courseEdges[last], y1: (tiles + 1) * TILE_H };
}

/** THE STONE at a world point: its full rectangle, whatever height it is.
 *  Scans the bucket for this course and the one below, because a tall stone
 *  starting below reaches up into this one. */
export function stoneAt(x: number, y: number): Stone {
  if (!stonesByCourse.length) rebuildGrid();
  const ty = Math.floor(y / TILE_H), tx = Math.floor(x / TILE_W);
  const ly = y - ty * TILE_H, lx = x - tx * TILE_W;
  let ci = COURSES_PER_TILE - 1;
  for (let i = 0; i < COURSES_PER_TILE; i++) if (ly < courseEdges[i + 1]) { ci = i; break; }
  for (const c of [ci, ci - 1, ci - 2]) {
    if (c < 0) continue;
    for (const st of stonesByCourse[c]) {
      // x wraps within the tile, so test the stone shifted by one tile too —
      // the running-bond offset can push a stone across the seam.
      for (const off of [0, TILE_W, -TILE_W]) {
        if (lx >= st.x0 + off && lx < st.x1 + off && ly >= st.y0 && ly < st.y1) {
          return {
            x0: tx * TILE_W + st.x0 + off, x1: tx * TILE_W + st.x1 + off,
            y0: ty * TILE_H + st.y0, y1: ty * TILE_H + st.y1, ix: st.ix, iy: st.iy,
          };
        }
      }
    }
  }
  // Nothing claimed it (should not happen; the stones tile the plane). Fall back
  // to the course band so a lookup can never return nonsense.
  const c = courseAt(y);
  return { x0: tx * TILE_W, x1: tx * TILE_W + TILE_W, y0: c.y0, y1: c.y1, ix: 0, iy: c.i };
}

const fract = (x: number) => x - Math.floor(x);
const modf = (x: number, y: number) => x - y * Math.floor(x / y);

/** The texture baker's hash. Shared so cell ids agree bit for bit. */
export function stoneHash(x: number, y: number, z: number): number {
  let px = fract(x * 0.3183099 + 0.1), py = fract(y * 0.3183099 + 0.1), pz = fract(z * 0.3183099 + 0.1);
  px *= 17; py *= 17; pz *= 17;
  return fract(px * py * pz * (px + py + pz));
}

/**
 * Which flagstone is at this world point.
 *
 * The periodic Voronoi the floor texture draws, evaluated at a point instead of
 * baked into a tile. Returns the cell's id — the same pair the texture uses to
 * pick that slab's tone — so a per-slab vertex tint lands on THE SLAB THE
 * PLAYER CAN SEE THE EDGES OF, rather than on a rectangle of its own invention.
 *
 * Only the nearest-site pass; the texture's second pass computes the distance to
 * the cell EDGE, which is what draws the seam. A tint does not need the seam,
 * only which side of it it is on.
 *
 * Returns TWO identities and they are not interchangeable:
 *   `gx, gy`  — the cell id MODULO the period. This is what the texture hashes
 *               to pick a slab's tone, so anything that wants to agree with the
 *               texture's colour must use it.
 *   `sx, sy`  — the unwrapped site index. Unique per PHYSICAL slab on the floor.
 *               Anything caching a per-slab fact about a place (how far it is
 *               from a wall, whether something stands on it) must use this, or
 *               two slabs five metres apart share one answer.
 */
export function flagstoneCell(wx: number, wz: number): { gx: number; gy: number; sx: number; sy: number } {
  const x = wx / FLAG_CELL, y = wz / FLAG_CELL;
  const ipx = Math.floor(x), ipy = Math.floor(y), fpx = fract(x), fpy = fract(y);
  let md = 9, mgx = 0, mgy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = modf(ipx + i, FLAG_PERIOD), cy = modf(ipy + j, FLAG_PERIOD);
      const ox = 0.5 + 0.42 * (stoneHash(cx, cy, 0.13) * 2 - 1);
      const oy = 0.5 + 0.42 * (stoneHash(cx, cy, 4.71) * 2 - 1);
      const rx = i + ox - fpx, ry = j + oy - fpy;
      const dd = rx * rx + ry * ry;
      if (dd < md) { md = dd; mgx = ipx + i; mgy = ipy + j; }
    }
  }
  return { gx: modf(mgx, FLAG_PERIOD), gy: modf(mgy, FLAG_PERIOD), sx: mgx, sy: mgy };
}

/**
 * Course boundaries for a wall standing on `baseY` and `height` tall, returned
 * in the wall's LOCAL space (0 at the base).
 *
 * Snapped to the world grid, so the first boundary above the floor is wherever
 * the texture's next mortar line falls — which is why this takes a world Y and
 * not just a height. A wall on a raised plateau has a part-course at the bottom
 * and that is exactly right; masonry meets a floor wherever the floor is.
 */
export function courseRows(baseY: number, height: number): number[] {
  const rows: number[] = [0];
  const first = Math.ceil(baseY / COURSE_H) * COURSE_H - baseY;
  for (let y = first; y < height - 0.02; y += COURSE_H) {
    if (y > 0.02) rows.push(y);
  }
  rows.push(height);
  return rows;
}
