// THE FRAME OWNS THE FLOOR OF ITS OWN THRESHOLD.
//
// Josh: *"it's the same as a pipe and the pipe's plug or connector."*
//
// The floor at a doorway has three owners, going outward from the room:
//
//   [ .. outline ]              the room's plate
//   [ outline .. +WALL_T ]      the room's WALL — masonry with a hole in it
//   [ +WALL_T .. ]              the corridor's plate
//
// The middle band is the doorway, and nothing floored it. The corridor covered
// for that by running its slab 0.10m PAST the outline — through all 0.25m of
// masonry and out the far side, so slab, wall and doorframe all claimed one
// strip of ground. That is the z-fighting; anywhere the reach fell short of it
// was the gap.
//
// So the corridor stops at the wall's outer face and the FRAME carries the sill.
//
// ── WHY THIS FILE EXISTS SEPARATELY ──────────────────────────────────────────
//
// The poly-floor suite asserts the corridor half — and reverting it turns 937
// plates red. It asserts the sill half only as arithmetic over the constants,
// which stayed green with the sill deleted entirely. A joint proved on one side
// is not proved. This checks the geometry actually comes out of the builder.
//
//   npm test -- frame-sill

import assert from 'node:assert/strict';
import { chooseFrameModel, ARCHWAY_MIN_WIDTH } from '../src/level/frame';
import { WALL_T } from '../src/level/poly-room-shell';
import { WALL_SEAT, LAP } from '../src/level/corridor-trim';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

type Box = { kind: string; name?: string; pos?: number[]; size?: number[] };
const sillOf = (width: number, wallDepth = WALL_T) => {
  const { model } = chooseFrameModel({ width, ceilingHeight: 3.2, wallDepth });
  return (model.parts as Box[]).find((p) => p.name === 'sill');
};

test('EVERY FRAME KIND CARRIES ONE', () => {
  // Both sides of the archway/doorframe split, because the sill is added at the
  // one seam they share — and the whole point of putting it there was that a
  // sill authored twice disagrees with itself the first time one is tuned.
  const narrow = ARCHWAY_MIN_WIDTH - 0.5, wide = ARCHWAY_MIN_WIDTH + 1.0;
  assert.equal(chooseFrameModel({ width: narrow, ceilingHeight: 3.2, wallDepth: WALL_T }).kind, 'doorframe');
  assert.equal(chooseFrameModel({ width: wide, ceilingHeight: 3.2, wallDepth: WALL_T }).kind, 'archway');
  assert.ok(sillOf(narrow), 'a doorframe has no sill');
  assert.ok(sillOf(wide), 'an archway has no sill');
});

test('THE SILL SPANS THE WALL AND LAPS PAST BOTH FACES', () => {
  // Local frame: +X along the opening, +Z THROUGH it, y = 0 the floor. So the
  // wall band is z in [-WALL_T/2, +WALL_T/2] and the sill must be deeper than
  // it on both sides, or the joint meets exactly and is one rounding away from
  // a hairline of void.
  for (const width of [1.4, 2.2, 3.6, 5.0]) {
    const sill = sillOf(width)!;
    assert.ok(sill, `no sill at width ${width}`);
    const [sx, sy, sz] = sill.size as [number, number, number];
    assert.ok(sz > WALL_T, `the sill is ${sz.toFixed(2)}m deep in a ${WALL_T}m wall — it does not reach both faces`);
    // The lap on the corridor side has to cover the setback the trim leaves.
    const lapEachSide = (sz - WALL_T) / 2;
    assert.ok(WALL_T / 2 + lapEachSide > WALL_SEAT - LAP - WALL_T / 2 + 1e-9,
      'the sill stops short of where the corridor plate starts — that is the gap');
    // Wider than the opening, so it passes UNDER the jambs rather than butting
    // into them and leaving two bare corners on the floor.
    assert.ok(sx > width, `a ${sx.toFixed(2)}m sill under a ${width}m opening`);
    // A threshold, not a step. Anything you can feel underfoot here reads as a
    // bug even when it is deliberate.
    const top = (sill.pos as number[])[1] + sy / 2;
    assert.ok(top > 0 && top < 0.02,
      `the sill's top sits at ${top.toFixed(3)}m — that is a step, not a threshold`);
  }
});

test('A WALL WITH NO THICKNESS GETS NO SILL', () => {
  // Rect-era rooms pass wallDepth 0: their wall is a single plane with no band
  // to floor. Inventing a slab there would put a lip in every tilemap doorway
  // in the game, which is the retrofit-the-old-path-with-the-new failure Josh
  // asked to avoid rather than accumulate.
  assert.equal(sillOf(2.2, 0), undefined, 'a zero-thickness wall grew a sill');
  const { model } = chooseFrameModel({ width: 2.2, ceilingHeight: 3.2 });
  assert.ok(!(model.parts as Box[]).some((p) => p.name === 'sill'),
    'a frame with no declared wall depth grew a sill');
});

test('THE SILL CHANGES THE MODEL ID', () => {
  // Models are built through a cache keyed on id. A sill that did not move the
  // key would be dropped for whatever was built first at that width — invisible,
  // and only on the second doorway of a floor.
  const withDepth = chooseFrameModel({ width: 2.2, ceilingHeight: 3.2, wallDepth: WALL_T }).model.id;
  const without = chooseFrameModel({ width: 2.2, ceilingHeight: 3.2 }).model.id;
  assert.notEqual(withDepth, without, 'the sill does not appear in the build-cache key');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
