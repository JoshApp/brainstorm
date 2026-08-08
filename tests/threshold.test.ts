// THE SEAM, BEFORE ANYTHING DEPENDS ON IT.
//
// Step 1 of docs/SPACES-AND-THRESHOLDS.md. The threshold primitive is emitted
// alongside today's geometry and consumed by nobody yet, precisely so it can be
// checked against the shipping pipeline BEFORE the pipeline is rebuilt on it.
//
// The measurement this whole migration rests on, over 36 floors: 480 places
// where a corridor rect reaches inside a room polygon, median 0.73m deep and up
// to 3.60m — and 92% of those have a ceiling more than 15cm off the room's, so
// the passage stands its slab and its side walls INSIDE the room. That is the
// leak, and it is a consequence of the overshoot, not a bug in any one pass.
//
// What is checked here is the solver's contract, not the migration:
//
//   1. A threshold lands ON the boundary — inside the space, with open air one
//      step further out. If it lands short the wall is cut in the wrong place;
//      if it lands past, the corridor starts outside the room.
//   2. It agrees with the shipping answer. `planPortals` already finds these
//      openings the hard way; a solver that disagrees with it is not ready to
//      replace it, and finding that out AFTER the rebuild is how a migration
//      becomes a rewrite.
//   3. The opening is never taller than the space it is cut into. A hole above
//      the wall top is a hole in the sky.
//   4. `kind` is chosen from BOTH sides, never from width — the current
//      archway/doorframe split reads width alone, which is why a plain passage
//      keeps getting a monument.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { boundaryHit, thresholdAt, thresholdKind } from '../src/level/threshold';
import { planPortals } from '../src/level/portals';
import { pointInPoly, type Poly } from '../src/level/room-shape';
import { roomCenter } from '../src/level/floor-region';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 6, 8, 11];
const FLOORS = SEEDS.flatMap((seed) => DEPTHS.map((depth) => ({
  seed, depth, spec: generatePolyFloor(depth, seed),
})));

test('A THRESHOLD LANDS ON THE BOUNDARY — NOT SHORT, NOT PAST', () => {
  const square: Poly = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]] as const) {
    const hit = boundaryHit(square, [0, 0], dir);
    assert.ok(hit, `no boundary found going (${dir[0]}, ${dir[1]})`);
    assert.ok(pointInPoly(square, hit![0], hit![1]),
      `the hit at (${hit![0].toFixed(2)}, ${hit![1].toFixed(2)}) is already outside`);
    const len = Math.hypot(dir[0], dir[1]);
    const out: [number, number] = [hit![0] + (dir[0] / len) * 0.12, hit![1] + (dir[1] / len) * 0.12];
    assert.ok(!pointInPoly(square, out[0], out[1]),
      'a step past the hit is still inside — the boundary was not reached');
  }
  // A ray that starts outside has no answer, and must say so rather than
  // inventing one. The old helper returned null here too; the difference is
  // that this is now the ONE place the question is asked.
  assert.equal(boundaryHit(square, [40, 40], [1, 0]), null);
});

test('...and it agrees with the answer the shipping pipeline finds', () => {
  // planPortals locates the same openings by reconstructing them from which
  // edges a corridor rect happened to cross. If the declared solver cannot
  // reproduce its answers, it is not ready to replace it.
  let checked = 0, matched = 0;
  for (const { spec } of FLOORS) {
    const cors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const room of spec.rooms) {
      if (!room.poly || room.poly.length < 3) continue;
      const c = roomCenter(room.poly);
      for (const p of planPortals(room.id, room.poly, cors)) {
        checked++;
        // March from the room's centre toward the portal and see where the
        // solver says the wall is.
        const t = thresholdAt({
          id: 'probe', space: { id: room.id, poly: room.poly, height: room.height },
          other: 'x', centre: [c.x, c.z],
          toward: [p.mid[0] - c.x, p.mid[1] - c.z],
          width: p.width, height: room.height, kind: 'gap',
        });
        if (!t) continue;
        // Within a wall thickness of where the portal says the hole is. Not
        // exact: planPortals takes the midpoint of an edge span, the solver
        // takes a ray hit, and on a chamfered corner those differ legitimately.
        if (Math.hypot(t.at[0] - p.mid[0], t.at[1] - p.mid[1]) < 1.2) matched++;
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} portals sampled — this measured nothing`);
  assert.ok(matched / checked > 0.85,
    `the solver reproduced only ${((matched / checked) * 100).toFixed(0)}% of the shipping `
    + 'openings — it is not ready to replace them');
});

test('AN OPENING IS NEVER TALLER THAN THE SPACE IT IS CUT INTO', () => {
  // A hole above the wall top is a hole in the sky. This is also the field that
  // retires corridor-ceiling.ts: when the height is declared at the seam and
  // both sides build to it, there is no mismatch left to clamp.
  const square: Poly = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  const t = thresholdAt({
    id: 't', space: { id: 'a', poly: square, height: 2.4 }, other: 'b',
    centre: [0, 0], toward: [1, 0], width: 2, height: 4.6, kind: 'frame',
  });
  assert.ok(t);
  assert.equal(t!.height, 2.4, 'a 4.6m opening was cut into a 2.4m space');
});

test('WHAT A DOOR SAYS COMES FROM BOTH SIDES, NOT FROM ITS WIDTH', () => {
  const always = () => 0.01, never = () => 0.99;
  const plain = { word: 'pass', major: false };
  // A monument is earned by what it opens onto.
  assert.equal(thresholdKind({ word: 'pass', major: true }, plain, always), 'gate');
  assert.equal(thresholdKind(plain, { word: 'pass', major: true }, never), 'gate',
    'a gate must not depend on which side is listed first');
  // A tight space gets a tight opening.
  const squeeze = { word: 'squeeze', major: false };
  assert.ok(['half', 'gap'].includes(thresholdKind(squeeze, plain, always)));
  assert.ok(['half', 'gap'].includes(thresholdKind(plain, squeeze, never)));
  // And the ordinary case is a hole worn through, not a built frame — the whole
  // point of the vocabulary is that the monument becomes rare.
  let gaps = 0;
  for (let i = 0; i < 200; i++) {
    if (thresholdKind(plain, plain, () => i / 200) === 'gap') gaps++;
  }
  assert.ok(gaps > 100, `only ${gaps}/200 ordinary seams are a plain gap — the common case `
    + 'should be unmade, or every doorway is still a construction');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
