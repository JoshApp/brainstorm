// ── THE STONE GRID ──────────────────────────────────────────────────────────
//
// style/stone-grid.ts is the single table the baked texture and the real wall
// geometry both lay stone on. Two things about it are load-bearing and neither
// was pinned:
//
//   1. IT TILES. The texture repeats every TILE_W x TILE_H, so a stone that
//      straddles the seam has to be the same stone on both sides or the wall
//      shows a vertical line every 4.6 metres.
//   2. EVERY STONE HAS ITS OWN IDENTITY. surface-textures.ts keys sixteen
//      per-stone properties — tone, set, tilt, dome, spall, chips, corner
//      breaks, whether the joint survives — on (ix, iy). Two stones sharing a
//      key are, to the eye, one stone.
//
// The second one was broken, silently, for as long as tall stones have existed:
// the texture reduced ix with `modf(ix, 8)`, and the upper stone of a stacked
// pair is marked `ix: i + 64`. 64 is a multiple of 8. The mark was erased and a
// stacked pair drew one identity between them — which is what Josh was looking
// at when he said *"some of the big stones are like two stones in one without a
// gap between them."*

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stoneAt, courseAt, setStoneVariation, setStoneSizes,
  COURSE_H, BRICK_W, COURSES_PER_TILE, BLOCKS_PER_TILE,
} from '../src/style/stone-grid';

const TILE_H = COURSE_H * COURSES_PER_TILE;
const TILE_W = BRICK_W * BLOCKS_PER_TILE;

/** The shipped look, so this tests the wall the game actually draws. */
function shipped(): void {
  setStoneVariation(0.45, 0.8, 0.455);
  setStoneSizes(1.0, 0.20);
}

test('every stone in the tile has its OWN identity', () => {
  shipped();
  // Walk the tile densely enough to meet every stone, and check that no two
  // DISTINCT rectangles ever answer to the same (ix, iy).
  const byKey = new Map<string, string>();
  // Rects are compared MODULO THE TILE. A stone laid near x = 0 straddles the
  // seam and `stoneAt` reports it at both ends of the tile (it tests the stone
  // shifted by +/- TILE_W, which is what makes the running bond wrap) — so the
  // two reports are one stone and SHOULD share an identity. Without this the
  // test fails on the seam and calls correct behaviour a collision, which is
  // exactly what it did on its first run.
  const wrap = (v: number) => {
    const m = ((v % TILE_W) + TILE_W) % TILE_W;
    return m.toFixed(3);
  };
  for (let y = 0.01; y < TILE_H; y += 0.05) {
    for (let x = 0.01; x < TILE_W; x += 0.05) {
      const s = stoneAt(x, y);
      const key = `${s.ix}|${s.iy}`;
      const rect = `${wrap(s.x0)},${(s.x1 - s.x0).toFixed(3)},${s.y0.toFixed(3)},${s.y1.toFixed(3)}`;
      const seen = byKey.get(key);
      if (seen === undefined) byKey.set(key, rect);
      else {
        assert.equal(seen, rect,
          `two different stones share the identity (${key}) — the texture will draw `
          + `them as one stone: ${seen} vs ${rect}`);
      }
    }
  }
  assert.ok(byKey.size > 20, `only ${byKey.size} stones in a tile — the walk collapsed`);
});

test('a stacked pair is TWO stones, not one', () => {
  // The specific case the modulo destroyed. With tall stones on, some column
  // somewhere in the tile is laid as two stacked stones sharing x-bounds; they
  // must not share an identity.
  shipped();
  let stackedPairs = 0;
  for (let x = 0.05; x < TILE_W; x += 0.07) {
    const seenInColumn = new Map<string, { y0: number; y1: number; id: string }>();
    for (let y = 0.01; y < TILE_H; y += 0.03) {
      const s = stoneAt(x, y);
      const xKey = `${s.x0.toFixed(3)}|${s.x1.toFixed(3)}`;
      const id = `${s.ix}|${s.iy}`;
      const prev = seenInColumn.get(xKey);
      if (prev && (prev.y0 !== s.y0 || prev.y1 !== s.y1)) {
        stackedPairs++;
        assert.notEqual(prev.id, id,
          `two stones stacked in one column share identity ${id} — they will draw `
          + `identical tone, set, tilt and joint, i.e. as a single stone`);
      }
      seenInColumn.set(xKey, { y0: s.y0, y1: s.y1, id });
    }
  }
  assert.ok(stackedPairs > 0, 'no stacked stones found — tall stones are not being laid');
});

test('the grid still tiles seamlessly', () => {
  // The identity fix must not cost the seam. A point and the same point one
  // tile over must land on the same stone, offset by exactly one tile.
  shipped();
  for (const [x, y] of [[0.4, 0.3], [2.1, 1.7], [3.9, 4.2], [0.05, 4.75]]) {
    const a = stoneAt(x, y);
    const b = stoneAt(x + TILE_W, y);
    assert.equal(a.ix, b.ix, `identity changed across the tile seam at (${x},${y})`);
    assert.equal(a.iy, b.iy, `course changed across the tile seam at (${x},${y})`);
    assert.ok(Math.abs((b.x0 - a.x0) - TILE_W) < 1e-6, 'stone did not shift by one tile');
    const c = stoneAt(x, y + TILE_H);
    assert.equal(a.ix, c.ix, `identity changed vertically across the seam at (${x},${y})`);
  }
});

test('a lookup always lands on a stone that contains the point', () => {
  // stoneAt has a fallback for "nothing claimed it", which should be dead code.
  // If the stone list ever fails to tile the plane, the fallback quietly returns
  // a whole course band and the wall grows a mystery slab.
  shipped();
  for (let y = 0.02; y < TILE_H; y += 0.11) {
    for (let x = 0.02; x < TILE_W; x += 0.13) {
      const s = stoneAt(x, y);
      assert.ok(x >= s.x0 - 1e-6 && x < s.x1 + 1e-6, `(${x},${y}) is outside its own stone in X`);
      assert.ok(y >= s.y0 - 1e-6 && y < s.y1 + 1e-6, `(${x},${y}) is outside its own stone in Y`);
      assert.ok(s.x1 > s.x0 && s.y1 > s.y0, 'degenerate stone');
    }
  }
});

test('courseAt agrees with the stone the point is in', () => {
  shipped();
  for (let y = 0.02; y < TILE_H; y += 0.07) {
    const c = courseAt(y);
    assert.ok(y >= c.y0 - 1e-6 && y < c.y1 + 1e-6, `courseAt(${y}) returned a band not containing it`);
  }
});
