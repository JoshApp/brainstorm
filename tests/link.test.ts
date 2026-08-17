// ── THE POLYLINE IS THE RECORD ───────────────────────────────────────────────
//
// Stage 1 of docs/LINKS-V3.md. `rectsFromLink` is the ONE derivation of corridor
// rects from a link, extracted verbatim from what `routeConnection` did inline.
// Nothing else may build a corridor rect.
//
// What is pinned here is the SHAPE of that derivation, plus the two things in it
// that are known to be wrong and are stage 3's job — the overlap and the corner
// cover. Pinning a known-wrong behaviour is deliberate: stage 3 has to change these
// numbers, and a test that fails when it does is how we know the change reached the
// one place it is supposed to live in, rather than being a second opinion added
// somewhere else.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rectsFromLink, linkRun, type Link } from '../src/level/link';

const straight = (len: number, width = 2.2): Link => ({
  fromRoom: 'a', toRoom: 'b',
  legs: [{ from: [0, 0], to: [0, len], width }],
  aAt: [0, 0], bAt: [0, len], aWidth: width, bWidth: width,
});

/** An L: down Z, then along X. */
const ell = (width = 2.2): Link => ({
  fromRoom: 'a', toRoom: 'b',
  legs: [
    { from: [0, 0], to: [0, 6], width },
    { from: [0, 6], to: [8, 6], width },
  ],
  aAt: [0, 0], bAt: [8, 6], aWidth: width, bWidth: width,
});

test('a straight link is one rect, and the overlap reaches BOTH ends', () => {
  const d = rectsFromLink(straight(10), { width: 2.2, overlap: 0.9 })!;
  assert.equal(d.rects.length, 1);
  const r = d.rects[0];
  // 10m of run plus 0.9m into each room. The overlap is a LOOKUP KEY, not
  // geometry — a rect that stops on the wall line gets no doorway cut and the
  // floor seals. Stage 3 declares the cut instead and this becomes 0.
  assert.ok(Math.abs(r.d - (10 + 1.8)) < 1e-9, `run came out ${r.d}, want 11.8`);
  assert.ok(Math.abs(r.w - 2.2) < 1e-9, 'width is not the section');
  assert.ok(Math.abs(r.z - 5) < 1e-9, 'not centred on its run');
  assert.equal(d.legAxis.length, 1);
  assert.equal(d.legAxis[0].alongX, false, 'a Z-run reported itself as X');
});

test('overlap 0 stops the corridor exactly at its thresholds', () => {
  // Stage 3's target state, verified reachable today: the derivation already
  // supports it, so dropping the overlap is a caller change plus a cutting
  // mechanism, not a rewrite of this function.
  const d = rectsFromLink(straight(10), { width: 2.2, overlap: 0 })!;
  assert.ok(Math.abs(d.rects[0].d - 10) < 1e-9, 'the corridor still overshoots');
});

test('an L covers its own corner exactly once', () => {
  // Only the leg LEAVING the joint extends back through it. Extending both puts
  // the arriving leg's end exactly ON the departing leg's edge, and the
  // orphaned-end check then decides a boundary case. This is the rule that
  // stopped "corridor cor-2-0 ends at (-7.4, 16.4) — in nothing".
  const d = rectsFromLink(ell(), { width: 2.2, overlap: 0.9 })!;
  assert.equal(d.rects.length, 2);
  const [first, second] = d.rects;
  // First leg: 0 -> 6 in Z, with 0.9 back into room A and nothing added forward.
  assert.ok(Math.abs(first.d - 6.9) < 1e-9, `first leg ${first.d}, want 6.9`);
  // Second leg: 0 -> 8 in X, pulled back half a width THROUGH the joint, plus
  // 0.9 into room B at the far end.
  assert.ok(Math.abs(second.w - (8 + 1.1 + 0.9)) < 1e-9, `second leg ${second.w}, want 10.0`);
  assert.equal(d.legAxis[0].alongX, false);
  assert.equal(d.legAxis[1].alongX, true);
});

test('a degenerate leg is refused, not built', () => {
  // A 4cm corridor is not a corridor. Returning null lets the caller fall through
  // or the floor reroll; building it puts a sliver of geometry in the world that
  // every later pass has to special-case.
  assert.equal(rectsFromLink(straight(0.02), { width: 2.2, overlap: 0 }), null);
});

test('linkRun measures the polyline, not the rects', () => {
  // The whole reason the polyline is the record. A route knows its own length; the
  // rect version of this reconstructed it from `legAxis` with a "middle rect is a
  // landing" rule, and that mismatch stepped a doorway 1.2m when a routed chord
  // came out with two legs instead of three.
  assert.ok(Math.abs(linkRun(straight(10)) - 10) < 1e-9);
  assert.ok(Math.abs(linkRun(ell()) - 14) < 1e-9, 'an L is the sum of its legs');
});
