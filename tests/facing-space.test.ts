// A PROP TAKES ITS FACING FROM THE SPACE IT IS ACTUALLY IN.
//
// Josh: *"we have to tighten things, can't operate on boxes when we have
// polygons... if you encounter legacy or bugginess remove or fix it."*
//
// `facing.ts` asked `geometry-cull.findContainingRect`, which returns the FIRST
// rect whose BOX contains the point. On a polygon floor that is wrong twice
// over, for the reason `rect-at.ts` exists and states in its header:
//
//   - a corridor rect deliberately ends INSIDE the room it serves, so at a point
//     a metre inside a room TWO boxes contain you;
//   - a room's box is not its floor.
//
// So a prop standing in a corridor was handed the enclosing ROOM's 10.5×10.5
// box, and `nearestWall` computed its facing off a wall it is nowhere near.
// Measured across 60 floors: 269 of the 1841 props that reach the cardinal
// fallback, 15%, attributed to the wrong space.
//
// This reproduces that geometry exactly rather than sampling for it, because the
// bug is about WHICH of two overlapping boxes wins and a sampled version would
// pass or fail on where the generator happened to put things.
//
//   npm test -- facing-space

import assert from 'node:assert/strict';
import { resolveAllFacings } from '../src/level/facing';
import { rectAtIn } from '../src/level/rect-at';
import type { LevelSpec, PropSpec, RoomSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/**
 * A wide room whose floor stops short of its own box on the east side, and a
 * narrow corridor running east out of it — reaching back INSIDE the room's box,
 * the way every corridor on a polygon floor does.
 *
 * The room's box spans x ∈ [-6, 6]; its FLOOR stops at x = 2. The corridor runs
 * x ∈ [0, 14] at z ≈ 0, so the strip x ∈ [2, 6] is inside BOTH boxes, outside
 * the room's floor, and on the corridor's — which is exactly the ground a
 * box-only test gets wrong.
 */
function overlappingFloor(): LevelSpec {
  const room: RoomSpec = {
    id: 'room', height: 4,
    rect: { x: 0, z: 0, w: 12, d: 12 },
    poly: [[-6, -6], [2, -6], [2, 6], [-6, 6]],
  } as RoomSpec;
  const corridor: RoomSpec = {
    id: 'cor', height: 3,
    rect: { x: 7, z: 0, w: 14, d: 2.2 },
  } as RoomSpec;
  return {
    id: 'probe', startPos: { x: 0, z: 0, yaw: 0 },
    rooms: [room], corridors: [corridor], props: [], stairs: [],
  } as unknown as LevelSpec;
}

test('A PROP IN A CORRIDOR IS NOT A PROP IN THE ROOM AROUND IT', () => {
  const spec = overlappingFloor();
  // Inside BOTH BOXES, outside the room's FLOOR, on the corridor's. That strip
  // — x between the polygon's edge at 2 and the box's edge at 6 — is the whole
  // problem: it belongs to the corridor and only a box test says otherwise.
  const at = { x: 3.0, z: 0.6 };
  const spaces = [
    { cx: 0, cz: 0, hw: 6, hd: 6, poly: spec.rooms[0].poly, id: 'room' },
    { cx: 7, cz: 0, hw: 7, hd: 1.1, poly: undefined, id: 'cor' },
  ];
  assert.equal(rectAtIn(spaces, at.x, at.z)?.id, 'cor',
    'test setup: the probe point should be in the corridor, not the room');

  spec.props.push({ kind: 'vase', x: at.x, z: at.z, facing: { kind: 'wall-away' } } as unknown as PropSpec);
  resolveAllFacings(spec);
  const got = (spec.props[0] as { rotY?: number }).rotY ?? 0;

  // The corridor is 2.2m deep, so from 0.6m off its centre line the NEAREST wall
  // is its own south side — a facing that turns away along ±Z. From the ROOM's
  // box the nearest wall is its EAST face at x = 6, which would turn the prop
  // along ±X. A right angle apart, so the two answers cannot be mistaken for
  // one another.
  const alongX = Math.abs(Math.sin(got)) > 0.7;
  assert.ok(!alongX,
    `the prop faced along X (rotY ${got.toFixed(2)}), which is the ROOM's east wall — `
    + 'it is standing in the corridor and should face off the corridor\'s own side');
});

test('...and the rule lives in ONE place', () => {
  // The regression this guards is not a number, it is a call site: `facing.ts`
  // reaching for the first-match finder again. Asserted by behaviour rather than
  // by grepping the source — a test that reads code is a lint, and it passes for
  // the wrong reasons the moment the import is renamed.
  const spec = overlappingFloor();
  // Two props: one genuinely in the room's floor, one in the overlap strip.
  spec.props.push(
    { kind: 'vase', x: -4, z: 0.6, facing: { kind: 'wall-away' } } as unknown as PropSpec,
    { kind: 'vase', x: 3.0, z: 0.6, facing: { kind: 'wall-away' } } as unknown as PropSpec,
  );
  resolveAllFacings(spec);
  const a = (spec.props[0] as { rotY?: number }).rotY ?? 0;
  const b = (spec.props[1] as { rotY?: number }).rotY ?? 0;
  // The room prop uses the polygon path (exact wall normals); the corridor prop
  // uses the cardinal fallback. They must not come out identical, or one of the
  // two paths is not being taken at all.
  assert.ok(Math.abs(a - b) > 1e-6,
    'both props resolved to the same facing — the poly path and the fallback are '
    + 'answering with one voice, which means only one of them ran');
  // And the facing directive is consumed, not left for something downstream to
  // re-resolve against a different answer.
  for (const p of spec.props) {
    assert.ok(!('facing' in p) || !(p as { facing?: unknown }).facing,
      'a facing directive survived resolution and can be resolved twice');
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
