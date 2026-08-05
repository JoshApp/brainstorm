// WALL SURFACES — the thing that replaces `{ x, z, wall: 'W' }`.
//
// The bug this exists to make impossible: a fixture named a compass wall, the
// room's shape changed, that wall stopped existing at that coordinate, and the
// fixture hung in the void. Nothing could catch it, because 'W' is a letter.
//
// So the invariants here are all of the form "a mount is ON a wall": inside the
// room, against stone, facing the right way, clear of corners and doorways.
// Checked across every archetype, because a rule that holds for a rectangle is
// not a rule.
//
//   npm test

import assert from 'node:assert/strict';
import {
  clearDepth, describeWalls, findMountableRun, mountPoints,
} from '../src/level/wall-surfaces';
import { ARCHETYPES, generateRoomShape, pointInPoly, type Poly } from '../src/level/room-shape';
import { STARTER_POLY } from '../src/level/starter-chamber';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* shapes(): Generator<{ kind: string; poly: Poly }> {
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < 10; s++) {
      const rand = mulberry(s * 7919 + 13);
      yield { kind, poly: generateRoomShape(kind, { w: 8 + rand() * 8, d: 6 + rand() * 7, rand }) };
    }
  }
}

test('every wall knows which way the room is', () => {
  for (const { kind, poly } of shapes()) {
    for (const s of describeWalls({ poly, height: 4 })) {
      assert.ok(pointInPoly(poly, s.mid[0] + s.inward[0] * 0.1, s.mid[1] + s.inward[1] * 0.1),
        `${kind}: edge ${s.edge} inward normal points OUT of the room`);
      assert.ok(!pointInPoly(poly, s.mid[0] - s.inward[0] * 0.1, s.mid[1] - s.inward[1] * 0.1),
        `${kind}: edge ${s.edge} outward side is inside the room`);
      assert.ok(Math.abs(Math.hypot(s.inward[0], s.inward[1]) - 1) < 1e-9,
        `${kind}: inward normal is not a unit vector`);
    }
  }
});

test('FACING SENDS A PROP\'S FRONT INTO THE ROOM', () => {
  // A prop's front is its local +Z at rotY = 0, so rotY maps +Z to
  // (sin rotY, cos rotY). Swapping the atan2 arguments mirrors every wall
  // fixture in the game and still typechecks — this is the assertion that
  // catches it.
  for (const { kind, poly } of shapes()) {
    for (const s of describeWalls({ poly, height: 4 })) {
      const fx = Math.sin(s.facingY), fz = Math.cos(s.facingY);
      assert.ok(fx * s.inward[0] + fz * s.inward[1] > 0.999,
        `${kind}: edge ${s.edge} facing points away from the room interior`);
    }
  }
});

test('EVERY MOUNT IS ON A WALL, NOT IN A CORNER AND NOT IN A DOORWAY', () => {
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: 4 });
    for (const s of walls) {
      for (const m of mountPoints(s, { spacing: [3, 6] })) {
        assert.ok(pointInPoly(poly, m.x, m.z), `${kind}: mount at (${m.x}, ${m.z}) is outside the room`);
        // Against stone: a short step further OUT must leave the room.
        assert.ok(!pointInPoly(poly, m.x - s.inward[0] * 0.4, m.z - s.inward[1] * 0.4),
          `${kind}: mount on edge ${s.edge} has open floor behind it — it is not on a wall`);
        // Clear of both ends of its own run.
        const dA = Math.hypot(m.x - s.a[0], m.z - s.a[1]);
        const dB = Math.hypot(m.x - s.b[0], m.z - s.b[1]);
        assert.ok(dA > 0.3 && dB > 0.3,
          `${kind}: mount sits ${Math.min(dA, dB).toFixed(2)}m from the end of its wall`);
      }
    }
  }
});

test('mounts keep an even rhythm, or there are none', () => {
  // Repetition at a fixed interval is most of what makes masonry read as built.
  // A run that cannot hold the rhythm gets NOTHING rather than one cramped
  // fixture jammed against a corner.
  for (const { kind, poly } of shapes()) {
    for (const s of describeWalls({ poly, height: 4 })) {
      const ms = mountPoints(s, { spacing: [2.5, 4] });
      if (ms.length < 3) continue;
      const gaps: number[] = [];
      for (let i = 1; i < ms.length; i++) gaps.push(Math.hypot(ms[i].x - ms[i - 1].x, ms[i].z - ms[i - 1].z));
      const lo = Math.min(...gaps), hi = Math.max(...gaps);
      assert.ok(hi - lo < 0.02, `${kind}: spacing wanders from ${lo.toFixed(2)}m to ${hi.toFixed(2)}m`);
      assert.ok(hi <= 4.01, `${kind}: spacing ${hi.toFixed(2)}m exceeds the band`);
    }
  }
});

test('a doorway removes the mounts it swallows', () => {
  const poly: Poly = [[-6, -4], [6, -4], [6, 4], [-6, 4]];
  const plain = describeWalls({ poly, height: 4 });
  const cut = describeWalls({ poly, height: 4, openings: [{ x: 0, z: -4, w: 3, d: 1.6 }] });
  assert.equal(plain.length, 4, 'a rectangle should describe four walls');
  assert.equal(cut.length, 5, 'the doorway should split the north wall in two');
  // No mount may land inside the doorway's mouth.
  for (const s of cut) {
    for (const m of mountPoints(s, { spacing: [2, 3.5] })) {
      const inDoor = Math.abs(m.x) < 1.5 + 0.3 && Math.abs(m.z + 4) < 0.9;
      assert.ok(!inDoor, `a mount landed in the doorway at (${m.x.toFixed(2)}, ${m.z.toFixed(2)})`);
    }
  }
});

test('clear depth measures the room, not the wall', () => {
  // A 12x8 rectangle: the long walls have 8m in front, the short walls 12m.
  const poly: Poly = [[-6, -4], [6, -4], [6, 4], [-6, 4]];
  for (const s of describeWalls({ poly, height: 4 })) {
    const d = clearDepth(s, poly, 14);
    const expect = s.length > 10 ? 8 : 12;
    assert.ok(Math.abs(d - expect) < 0.3,
      `wall of length ${s.length} reports ${d.toFixed(1)}m clear, expected ~${expect}m`);
  }
});

test('THE STAIR WALL IS CHOSEN, NOT ASSUMED', () => {
  // The apse the starter chamber ships: a stair needs a run at least as wide as
  // the stairwell with its whole body clear in front. The rect path picked one
  // of four walls and hoped; this has to actually find one.
  const walls = describeWalls({ poly: STARTER_POLY, height: 5.5 });
  const run = findMountableRun(walls, STARTER_POLY, { length: 2.0, depth: 2.6, clearOfJambs: true });
  assert.ok(run, 'no wall in the starter chamber can host a stair');
  assert.ok(clearDepth(run!, STARTER_POLY, 8) >= 2.6,
    `chosen wall has only ${clearDepth(run!, STARTER_POLY, 8).toFixed(1)}m in front`);
  assert.ok(run!.length >= 2.0, 'chosen wall is shorter than the stair');
});

test('an impossible need returns null instead of a bad wall', () => {
  const poly: Poly = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  assert.equal(
    findMountableRun(describeWalls({ poly, height: 3 }), poly, { length: 3, depth: 9 }),
    null,
    'a 4x4 closet claimed it could host a 9m-deep feature',
  );
});

test('every archetype can host SOMETHING on a wall', () => {
  // If a shape has no mountable run at all it cannot be lit, and an unlit room
  // is a room the player never sees. This is the acceptance test for the shape
  // grammar as much as for this module.
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: 4 });
    const total = walls.reduce((n, s) => n + mountPoints(s, { spacing: [3, 6] }).length, 0);
    assert.ok(total >= 2, `${kind}: only ${total} mount points in the whole room`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
