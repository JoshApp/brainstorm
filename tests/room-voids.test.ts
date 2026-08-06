// A HOLE IN THE FLOOR IS THE EASIEST WAY TO KILL A RUN.
//
// A pillar you can walk around; a rift you cannot. So room-voids.ts has the same
// shape as room-interior.ts — PROPOSE, then VERIFY on the room's own floor — and
// the verify is inside `planVoids`, not the caller's job. These are the
// properties that has to have.
//
// The end-to-end proof lives in tests/poly-floor.test.ts: delete the circulation
// check and "EVERY ROOM IS REACHABLE FROM THE SPAWN" fails on a real floor.
// These pin the reasons WHY, on shapes chosen to be hostile.
//
//   npm test

import assert from 'node:assert/strict';
import { planVoids, voidAreaLoss } from '../src/level/room-voids';
import { circulates, walkableCells } from '../src/level/room-circulation';
import type { Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const fixed = (v: number) => () => v;
/** Deterministic walk through [0,1) so a multi-attempt planner is exercised. */
function seq(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++ % vals.length];
}

const rect = (w: number, d: number): Poly => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

/** A big hall with a door at each end — the shape a rift is most useful in and
 *  most dangerous in. */
const HALL = rect(12, 9);
const DOORS = [{ x: -5.6, z: 0 }, { x: 5.6, z: 0 }];

test('IT CUTS A RIFT IN A ROOM BIG ENOUGH FOR ONE', () => {
  const rift = planVoids(HALL, { doorways: DOORS, rand: seq(0.5, 0.3, 0.7) });
  assert.ok(rift && rift.length === 1, 'a 12×9 hall took no rift at all');
  assert.ok(rift![0].w > 0 && rift![0].d > 0);
});

test('...and the room STILL CIRCULATES with it in', () => {
  // The whole point. Re-flood with the shipping check rather than trusting that
  // planVoids ran it — if the verify ever moves out of the planner, this fails.
  const rift = planVoids(HALL, { doorways: DOORS, rand: seq(0.5, 0.3, 0.7) })!;
  const baseline = walkableCells(HALL, {}).size;
  assert.ok(circulates(HALL, { rects: rift }, { doorways: DOORS, maxAreaLoss: 1 }, baseline),
    'planVoids returned a rift that seals the room');
});

test('A SMALL ROOM GETS NOTHING', () => {
  // Below the area floor the rift would BE the room.
  assert.equal(planVoids(rect(5, 4), { doorways: [{ x: -2.2, z: 0 }, { x: 2.2, z: 0 }], rand: fixed(0.5) }), null);
});

test('IT NEVER OPENS AT A DOORWAY', () => {
  // Stepping out of a corridor into air is the worst version of this bug: you
  // cannot see it coming and it is not a decision.
  for (let i = 0; i < 40; i++) {
    const rift = planVoids(HALL, { doorways: DOORS, rand: seq((i % 10) / 10, ((i * 7) % 10) / 10) });
    if (!rift) continue;
    for (const v of rift) {
      for (const d of DOORS) {
        const near = Math.abs(d.x - v.x) <= v.w / 2 + 0.5 && Math.abs(d.z - v.z) <= v.d / 2 + 0.5;
        assert.ok(!near, `a rift opened on a doorway at (${d.x}, ${d.z})`);
      }
    }
  }
});

test('IT NEVER OPENS UNDER SOMETHING ALREADY THERE', () => {
  // A rift under the room's own centrepiece would drop it into the dark, and
  // the eviction pass would then move a thing that was placed deliberately.
  const avoid = [{ x: 0, z: 0, r: 2.5 }];
  for (let i = 0; i < 40; i++) {
    const rift = planVoids(HALL, { doorways: DOORS, avoid, rand: seq((i % 10) / 10, ((i * 3) % 10) / 10) });
    if (!rift) continue;
    for (const v of rift) {
      const hit = Math.abs(v.x) <= v.w / 2 + 2.5 && Math.abs(v.z) <= v.d / 2 + 2.5;
      assert.ok(!hit, 'a rift opened under a claimed circle');
    }
  }
});

test('A MUSTREACH POINT IS NEVER STRANDED', () => {
  // Circulation between doorways is not enough — a rift can leave both doors
  // connected around one end while cutting the stair off behind it. Same lesson
  // the interior planner learned about colonnades.
  const stair = { x: 4.4, z: 3.4 };
  for (let i = 0; i < 40; i++) {
    const rift = planVoids(HALL, {
      doorways: DOORS, mustReach: [stair], rand: seq((i % 10) / 10, ((i * 9) % 10) / 10),
    });
    if (!rift) continue;
    const baseline = walkableCells(HALL, {}).size;
    assert.ok(
      circulates(HALL, { rects: rift }, { doorways: DOORS, mustReach: [stair], maxAreaLoss: 1 }, baseline),
      'a rift stranded the stair while leaving the doors connected');
  }
});

test('IT RESPECTS THE AREA CAP', () => {
  // A rift that eats a quarter of the room stops being a feature of the room
  // and becomes the room.
  for (let i = 0; i < 40; i++) {
    const rift = planVoids(HALL, { doorways: DOORS, rand: seq((i % 10) / 10, ((i * 5) % 10) / 10) });
    if (!rift) continue;
    const loss = voidAreaLoss(HALL, rift);
    assert.ok(loss <= 0.23, `a rift cost ${(loss * 100).toFixed(1)}% of the floor`);
  }
});

test('the same inputs give the same rift', () => {
  // Floors regenerate on resume, descend and reload. A rift that drifted would
  // put a hole where the save file says there is floor.
  const a = planVoids(HALL, { doorways: DOORS, rand: seq(0.5, 0.3, 0.7) });
  const b = planVoids(HALL, { doorways: DOORS, rand: seq(0.5, 0.3, 0.7) });
  assert.deepEqual(a, b);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
