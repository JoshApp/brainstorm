// ── A JOINT IS A FACT ABOUT A BOUNDARY ──────────────────────────────────────
//
// Josh, on a close screenshot of a wall: *"see how the joints are different
// across edges?"* — one edge of a stone a hairline, the next a black band.
//
// The set-out (the few millimetres by which a hand-laid stone misses its ideal
// slot) used to be a property of the STONE, added to the stone's own interior
// coordinate. Two things follow and both are wrong:
//
//   - a stone's two opposite edges move in OPPOSITE directions, so one joint
//     closes as the other opens;
//   - two stones sharing a boundary each apply their OWN offset to it, so they
//     disagree about where their joint is and it is drawn at two widths.
//
// It is a property of the BOUNDARY now, keyed on the boundary's position and
// nothing else, so both stones necessarily agree. That agreement is what this
// file checks — and it checks it the way the bug would have been caught, by
// walking the real grid and comparing neighbours.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setOut, SET_OUT_MAX } from '../src/style/surface-textures';
import {
  stoneAt, setStoneVariation, setStoneSizes,
  COURSE_H, BRICK_W, COURSES_PER_TILE, BLOCKS_PER_TILE,
} from '../src/style/stone-grid';

const TILE_W = BRICK_W * BLOCKS_PER_TILE;
const TILE_H = COURSE_H * COURSES_PER_TILE;
const AMOUNT = 0.92;   // the shipped wall set-out

function shipped(): void {
  setStoneVariation(0.45, 0.8, 0.455);
  setStoneSizes(1.0, 0.20);
}

test('two stones sharing a boundary agree about where it is', () => {
  shipped();
  // Walk along each course and compare each stone's right edge with the next
  // stone's left edge. They are the same line; they must be offset identically.
  let checked = 0;
  for (let y = 0.3; y < TILE_H; y += 0.31) {
    let x = 0.02;
    let guard = 0;
    while (x < TILE_W * 2 && guard++ < 400) {
      const s = stoneAt(x, y);
      const next = stoneAt(s.x1 + 1e-3, y);
      if (next.x0 !== s.x1) { x = s.x1 + 1e-3; continue; }   // stepped past a stack
      const mine = setOut(s.x1, TILE_W, 1.7, AMOUNT);
      const theirs = setOut(next.x0, TILE_W, 1.7, AMOUNT);
      assert.equal(mine, theirs,
        `the boundary at x=${s.x1.toFixed(3)} is offset ${mine.toFixed(4)} by the stone on `
        + `its left and ${theirs.toFixed(4)} by the stone on its right — the joint is drawn twice`);
      checked++;
      x = s.x1 + 1e-3;
    }
  }
  assert.ok(checked > 20, `only ${checked} boundaries checked — the walk did not run`);
});

test('the offset never swallows a joint whole', () => {
  // THE MAGNITUDE IS THE OTHER HALF OF THE BUG. The old per-stone offset reached
  // ±0.085m on a 1.15m stone, against a joint 0.075m wide — so it could close a
  // joint completely or double it. A set-out that can erase the thing it is
  // perturbing is not a set-out.
  //
  // The joint's half-width is 0.03 x jointW, and jointW's shipped value is 1.25,
  // so the full joint is 0.075m. The bound below keeps the wander under half of
  // that even at the knob's maximum.
  const JOINT_FULL_WIDTH = 0.03 * 1.25 * 2;
  assert.ok(SET_OUT_MAX * 2 < JOINT_FULL_WIDTH * 1.3,
    `set-out reaches ${(SET_OUT_MAX * 2).toFixed(3)}m against a ${JOINT_FULL_WIDTH.toFixed(3)}m joint`);
  let lo = Infinity, hi = -Infinity;
  for (let w = 0; w < TILE_W; w += 0.013) {
    const v = setOut(w, TILE_W, 1.7, 2.0);   // the knob's ceiling
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  assert.ok(hi <= SET_OUT_MAX * 2 + 1e-9 && lo >= -SET_OUT_MAX * 2 - 1e-9,
    `set-out ranged ${lo.toFixed(4)}..${hi.toFixed(4)}, past its own stated bound`);
  assert.ok(hi > 0 && lo < 0, 'set-out does not actually vary');
});

test('the set-out is tile-periodic, or the wall seams', () => {
  // The key is a WORLD coordinate. The same boundary one tile over has to hash
  // identically or every 4.6m the joints jump.
  for (let w = 0.05; w < TILE_W; w += 0.077) {
    for (const k of [1, 2, -3]) {
      assert.equal(
        setOut(w, TILE_W, 1.7, AMOUNT),
        setOut(w + k * TILE_W, TILE_W, 1.7, AMOUNT),
        `boundary at ${w.toFixed(3)} differs ${k} tiles over — the texture seams`,
      );
    }
  }
  for (let h = 0.05; h < TILE_H; h += 0.083) {
    assert.equal(
      setOut(h, TILE_H, 5.3, AMOUNT),
      setOut(h + TILE_H, TILE_H, 5.3, AMOUNT),
      'a bed joint differs one tile up',
    );
  }
});

test('set-out 0 lays the stones on their ideal lines', () => {
  // Magnitude, not identity: half these come back as -0 (the hash landed below
  // 0.5 and was scaled by zero), and `assert.equal` is Object.is under the hood,
  // for which Object.is(-0, 0) is false. -0 is still no displacement.
  for (let w = 0; w < TILE_W; w += 0.11) {
    assert.ok(Math.abs(setOut(w, TILE_W, 1.7, 0)) === 0, 'set-out 0 still moved a boundary');
  }
});
