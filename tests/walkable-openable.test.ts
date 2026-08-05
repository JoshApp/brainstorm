// OPENABLE BARRIERS — a door is not geometry.
//
// `delve reach` reported unreachable stairs on 5 of 7 sampled floors. It was
// measured, not imagined: the flood used the real WalkableRegion, and a closed
// door adds a real wall segment, so the flood stopped dead at every one. The
// tool was answering "where can the player walk WITHOUT OPENING ANYTHING",
// which is never the question anybody asks. Once measured properly, each of
// those floors had exactly ONE closed barrier with about 36% of the floor
// behind it — and on the seeds sampled, that barrier was BOSS MIST. The tool
// was reporting "you cannot reach the stairs" about floors whose stairs are
// behind the boss, which is the design.
//
// An audit that cries wolf on most of its inputs is worse than no audit — it
// trains you to ignore the one time it's right (docs/DESIGN-METHOD.md). So the
// distinction is now in the model rather than in the reader's head, and these
// are the two halves of it: a door must stop a PLAYER, and must not stop an
// AUDIT.
//
//   npm test

import assert from 'node:assert/strict';
import { WalkableRegion, type WallSegment } from '../src/level/walkable';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Two rooms side by side sharing a 1m gap at x = 0, plugged by one segment. */
function twoRooms(barrier: WallSegment) {
  return new WalkableRegion(
    [{ x: -3, z: 0, w: 6, d: 4 }, { x: 3, z: 0, w: 6, d: 4 }],
    [],
    [barrier],
  );
}
const R = 0.3;
const doorway = { ax: 0, az: -2, bx: 0, bz: 2 };

test('A CLOSED DOOR STOPS THE PLAYER', () => {
  // The flag must change NOTHING about collision. If it did, every door in the
  // game would become a curtain.
  const w = twoRooms({ ...doorway, openable: true });
  assert.equal(w.contains(0, 0, R), false, 'a player walked through a closed door');
  assert.equal(w.contains(-1, 0, R), true, 'the room in front of the door became unwalkable');
});

test('AND DOES NOT STOP AN AUDIT', () => {
  const w = twoRooms({ ...doorway, openable: true });
  assert.equal(w.contains(0, 0, R, { ignoreOpenable: true }), true,
    'a layout query still treats a door as stone — this is the bug');
});

test('a genuine wall stops both', () => {
  // The control. If ignoreOpenable let everything through, the tool would stop
  // crying wolf by never barking at all — which is a worse failure, and one an
  // "it passes now" check would happily miss.
  const w = twoRooms(doorway);                      // no openable flag
  assert.equal(w.contains(0, 0, R), false, 'a wall did not stop the player');
  assert.equal(w.contains(0, 0, R, { ignoreOpenable: true }), false,
    'a layout query walked through solid stone');
});

test('a closed door still stops an arrow', () => {
  // containsProjectile deliberately has no ignoreOpenable. The flag is about
  // what a player can EVENTUALLY get through, not what a shot can fly through
  // right now — and a door you can shoot past would be a combat bug found much
  // later than this one.
  const w = twoRooms({ ...doorway, openable: true });
  assert.equal(w.containsProjectile(0, 0, 1.0, 0.05), false, 'an arrow passed through a closed door');
});

test('THE FLOOD REACHES THE FAR ROOM ONLY WHEN THE BARRIER OPENS', () => {
  // The end-to-end shape of the bug, in miniature: flood from one room and see
  // whether the other is reachable.
  const CELL = 0.25;
  const reach = (w: WalkableRegion, ignoreOpenable: boolean): number => {
    const key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
    const seen = new Set([key(-4, 0)]);
    const q: Array<[number, number]> = [[-4, 0]];
    let farSide = 0;
    while (q.length) {
      const [x, z] = q.pop()!;
      if (x > 1) farSide++;
      for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]] as const) {
        const nx = x + dx, nz = z + dz;
        if (nx < -6 || nx > 6 || nz < -2 || nz > 2) continue;
        const k = key(nx, nz);
        if (seen.has(k)) continue;
        if (w.contains(nx, nz, R, { ignoreOpenable })) { seen.add(k); q.push([nx, nz]); }
      }
    }
    return farSide;
  };
  const door = twoRooms({ ...doorway, openable: true });
  assert.equal(reach(door, false), 0, 'the strict flood should stop at the closed door');
  assert.ok(reach(door, true) > 50, 'the layout flood never got past the door');
  const wall = twoRooms(doorway);
  assert.equal(reach(wall, true), 0, 'the layout flood walked through a real wall');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
