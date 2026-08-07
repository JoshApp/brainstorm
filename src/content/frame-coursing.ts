import type { PartSpec } from '../ecs/model-types';
import { courseRows, stoneHash, BRICK_W } from '../style/stone-grid';

// ── THE WALL ABOVE A DOORWAY ─────────────────────────────────────────────────
//
// Josh, on a screenshot: *"the thing above a door archway — that stacked mass
// on top of it looks ugly, it's just a dumb block. The old thing needed it to
// cover it, we can do better."*
//
// He is right about both halves. A doorway is a FULL-HEIGHT gap in the wall
// ring — `planWallRing` cuts the opening from floor to ceiling — so the frame
// has to close everything above the head, and both frames closed it with one
// untextured box. Measured over 64 generated floors, 625 doorways: that box is
// a median 2.6m tall and reaches 5.4m at the worst, with its top a median 4.8m
// up. It is not a lintel course. It is two square metres of blank wall in a
// room whose every other wall is coursed geometry.
//
// So the covering job and the looking job get split, and each goes to the thing
// that is good at it:
//
//   THE BACKING closes the hole — full width, full height, set back. Whatever
//   happens in front of it, no line of void can open. That was the old block's
//   one real job and it keeps it.
//
//   THE COURSING is what you look at. Laid on the SHARED stone grid
//   (style/stone-grid.ts), so its joints land on the same world-Y mortar lines
//   the wall texture draws and its stones are one BRICK_W each — the same
//   agreement that stopped the wall geometry and the wall shader reading as two
//   patterns. Alternate rows stagger by half a brick: running bond, which is
//   what the texture behind it is already drawing.
//
// A stone is missing here and there, and what you see through the gap is the
// backing. Nobody has repointed anything down here in a long time.

export interface CoursedPanelOpts {
  /** Panel width, centred on local x = 0. */
  width: number;
  /** Where the coursing starts — the top of the head, or of an arch. */
  baseY: number;
  /** Where it stops. The room's ceiling. */
  topY: number;
  /** Block depth along Z. Stand this PROUD of whatever backs the panel, or the
   *  two are coplanar and the pair z-fights instead of reading as stone on
   *  stone. */
  depth: number;
  /** Material id in the host model. */
  mat: string;
  /** Part-name prefix, so a model with two panels keeps them apart in the
   *  debug overlay. */
  prefix?: string;
  /** Decorrelates the dropped stones between two panels in one model. Whole
   *  numbers; the pattern is otherwise identical wherever the grid is. */
  seed?: number;
  /** Fraction of stones missing, 0..1. Ruin, not rubble — past about 0.2 the
   *  wall stops reading as a wall. */
  gaps?: number;
}

/**
 * A panel of coursed masonry, as flat-shaded boxes on the shared stone grid.
 *
 * Pure and THREE-free, like everything else a ModelSpec is made of, so both
 * frame models can call it and a test can count its stones.
 *
 * NO CAP ON COURSES. An earlier draft stopped at four rows on the grounds that
 * a tall hall puts the rest up in the dark — but the surrounding wall IS
 * coursed for its whole height, so a blank patch above a doorway reads as a
 * panel bolted onto a stone wall. Nine rows of boxes is nothing next to that.
 */
export function coursedPanel(o: CoursedPanelOpts): PartSpec[] {
  const span = o.topY - o.baseY;
  if (span <= 0.12 || o.width <= 0.12) return [];

  const prefix = o.prefix ?? 'course';
  const seed = o.seed ?? 0;
  const gaps = o.gaps ?? 0.14;
  const rows = courseRows(o.baseY, span);
  // Bricks are whole and the panel is not a whole number of them, so solve for
  // the count and let the width fall out. A panel of one-and-a-bit BRICK_W
  // stones would put a sliver at one end of every doorway in the game.
  //
  // CEIL, not round. Rounding down on a 2.4-brick panel gives 1.37m stones —
  // WIDER than the brick the wall texture behind them is drawing, which is the
  // one thing sharing a grid was supposed to prevent. Erring upward makes them
  // narrower than a brick instead, which the eye forgives and the texture does
  // not contradict.
  const perRow = Math.max(1, Math.ceil(o.width / BRICK_W));
  const brickW = o.width / perRow;
  const parts: PartSpec[] = [];

  for (let r = 0; r + 1 < rows.length; r++) {
    const y0 = o.baseY + rows[r], y1 = o.baseY + rows[r + 1];
    const h = y1 - y0;
    if (h < 0.08) continue;
    // Running bond — odd rows start half a brick over, so no joint runs up
    // through two courses. The extra block at each end is clipped to the panel.
    const stagger = r % 2 === 1 ? brickW / 2 : 0;
    for (let b = -1; b <= perRow; b++) {
      const cx = -o.width / 2 + stagger + (b + 0.5) * brickW;
      const lo = Math.max(cx - brickW / 2, -o.width / 2);
      const hi = Math.min(cx + brickW / 2, o.width / 2);
      if (hi - lo < 0.10) continue;
      // Deterministic, not rolled: these models are memoised per width and
      // ceiling, so an RNG here would hand every doorway a fresh spec and the
      // builder's CSG cache would never hit again.
      if (stoneHash(b + 3.7 + seed, r + 1.3, 0.41) < gaps) continue;
      parts.push({
        kind: 'box', name: `${prefix}-${r}-${b}`,
        pos: [(lo + hi) / 2, (y0 + y1) / 2, 0],
        size: [
          hi - lo - 0.02,
          h - 0.02,
          // Alternating depth is what makes a row of blocks read as blocks
          // rather than as one long stone under flat shading.
          o.depth - (stoneHash(b + 1.1 + seed, r + 5.2, 0.77) > 0.5 ? 0.04 : 0),
        ],
        mat: o.mat,
      } as PartSpec);
    }
  }
  return parts;
}
