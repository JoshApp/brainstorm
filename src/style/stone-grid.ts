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
