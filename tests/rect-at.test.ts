// WHICH ROOM IS THIS POINT IN, AND WHICH TWO ROOMS DOES A DOORWAY JOIN.
//
// Two rules that had no test and three consumers between them.
//
//   1. `rectAtIn` — the "which room" rule. It lived in two copies (the culler's
//      and the room graph's, which said in a comment that merging them was "a
//      safe, separate follow-up"). It is one function now, and this is the
//      first thing that has ever checked the clause both copies exist for:
//      A POLYGON ROOM IS NOT ITS BOUNDING BOX. A corridor rect deliberately
//      ends INSIDE the room it serves, so a point well inside a polygon room is
//      inside the corridor's box too — and smallest-box-wins answers "corridor".
//
//   2. A FRAMED DOORWAY IS A BOUNDARY OBJECT. Josh: *"when viewing from an
//      angle it's there and then it gets culled, part of the doorframe."* An
//      archway stands IN the wall between two spaces, so resolving it to one
//      room means it vanishes when that room is culled while you are looking
//      straight at it from the other side. Measured over 72 floors: 683 of 690
//      framed doorways join two DIFFERENT rooms, so 99% of them were culled
//      wrongly from one of their two sides.
//
// The culler consumes exactly the resolution this file exercises — same
// function, same probe distance — so this measures the shipping answer rather
// than a copy of it.
//
//   npm test

import assert from 'node:assert/strict';
import { rectAtIn } from '../src/level/rect-at';
import { generatePolyFloor } from '../src/level/poly-floor';
import type { LevelSpec, PropSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Same probe the culler steps through a gate with. */
const PROBE = 1.0;

/** The culler's and the graph's node shape, reduced to what the rule reads. */
function nodesOf(spec: LevelSpec) {
  return [
    ...spec.rooms.filter((r) => !r.logicalOnly)
      .map((r) => ({ id: r.id, cx: r.rect.x, cz: r.rect.z, hw: r.rect.w / 2, hd: r.rect.d / 2, poly: r.poly })),
    ...spec.corridors
      .map((c) => ({ id: c.id, cx: c.rect.x, cz: c.rect.z, hw: c.rect.w / 2, hd: c.rect.d / 2, poly: c.poly })),
  ];
}

test('A FLOOR BEATS A BOX THAT MERELY SURROUNDS THE POINT', () => {
  // The clause both copies existed for, on a synthetic case so the failure is
  // readable: a big room with a real polygon, and a small corridor box that
  // reaches two metres inside it. Standing on the room's floor is standing in
  // the ROOM, whatever the smaller box says.
  const room = {
    id: 'room', cx: 0, cz: 0, hw: 5, hd: 5,
    poly: [[-5, -5], [5, -5], [5, 5], [-5, 5]] as [number, number][],
  };
  const corridor = { id: 'cor', cx: 0, cz: 6, hw: 1, hd: 3 };   // reaches to z = 3
  const nodes = [room, corridor];
  assert.equal(rectAtIn(nodes, 0, 4)?.id, 'room',
    'a point on the room floor resolved to the corridor whose box overlaps it');
  assert.equal(rectAtIn(nodes, 0, 8)?.id, 'cor',
    'a point in the corridor beyond the room resolved elsewhere');
  assert.equal(rectAtIn(nodes, 0, 0)?.id, 'room');
  assert.equal(rectAtIn(nodes, 40, 40), null, 'a point in no rect resolved to something');
});

test('...and among boxes alone the smallest still wins', () => {
  // The original rule, unchanged: with no polygon to prefer, the tighter box is
  // the better answer (a corridor inside a vault room's bounds).
  const big = { id: 'big', cx: 0, cz: 0, hw: 8, hd: 8 };
  const small = { id: 'small', cx: 0, cz: 0, hw: 1, hd: 4 };
  assert.equal(rectAtIn([big, small], 0, 0)?.id, 'small');
});

test('A FRAMED DOORWAY JOINS TWO ROOMS, SO IT BELONGS TO BOTH', () => {
  const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444, 555, 66, 777, 8888];
  const DEPTHS = [1, 2, 5, 6, 8, 11];
  let frames = 0, twoSided = 0;
  for (const seed of SEEDS) for (const depth of DEPTHS) {
    const spec = generatePolyFloor(depth, seed);
    const nodes = nodesOf(spec);
    for (const p of (spec.props ?? []) as PropSpec[]) {
      // `framedOpening` is the frame marker — every archway and doorframe sets
      // it and nothing else does. The builder stamps those groups
      // `dbgKind: 'frame'` off the same flag.
      const f = p as { framedOpening?: boolean; x: number; z: number; rotY?: number };
      if (!f.framedOpening) continue;
      frames++;
      // The frame's local +Z runs through the gate.
      const s = Math.sin(f.rotY ?? 0), c = Math.cos(f.rotY ?? 0);
      const a = rectAtIn(nodes, f.x + s * PROBE, f.z + c * PROBE)?.id ?? null;
      const b = rectAtIn(nodes, f.x - s * PROBE, f.z - c * PROBE)?.id ?? null;
      assert.ok(a !== null || b !== null,
        `a doorway at (${f.x.toFixed(1)}, ${f.z.toFixed(1)}) opens onto nothing on either side`);
      if (a !== null && b !== null && a !== b) twoSided++;
    }
  }
  assert.ok(frames >= 200, `only ${frames} framed doorways sampled — this test measured nothing`);
  // The claim the culling fix rests on. It is a proportion, not a universal: a
  // frame can sit between a room and a corridor the culler does not track, and
  // the OR handles that by rendering.
  assert.ok(twoSided / frames > 0.9,
    `only ${((twoSided / frames) * 100).toFixed(0)}% of doorways resolved to two rooms — `
    + 'the boundary rule is not doing what this thinks it is');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
