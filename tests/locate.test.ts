// NAMING A WORLD POINT IN THE FLOOR PLAN'S OWN TERMS.
//
// A bug report's coordinates are useless on their own — "(12.4, 0, -8.1)" names
// nothing a reader can open a file about. locateInLevel turns a point into room
// and corridor IDS, which is what makes "some rare corridors generate faulty"
// into "corridor c7, link r2→r5".
//
// The cases that matter are the awkward ones, and they are awkward because the
// reports are: a point in the OVERLAP where a corridor meets a room (which is
// where doorway bugs live), and a point inside NOTHING (which is what a void
// gap is — the whole question being "what is this hole next to").
//
//   npm test -- locate

import assert from 'node:assert/strict';
import { locateInLevel } from '../src/level/locate';
import type { LevelSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Two rooms joined by a dogleg whose two legs share one linkId, with the first
 *  leg overlapping room A's mouth — the shape every doorway report is about. */
function floor(): LevelSpec {
  return {
    id: 'test', depth: 1, displayName: 'test', fogColor: 0,
    startPos: { x: 0, z: 0, yaw: 0 },
    rooms: [
      { id: 'roomA', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 3 },
      { id: 'roomB', rect: { x: 20, z: 0, w: 8, d: 8 }, height: 3 },
    ],
    corridors: [
      // Leg 1 spans x 3..9, so it reaches INSIDE roomA (-4..4) — that overlap is
      // the mouth, and it has to be a real overlap or the mouth case tests
      // nothing. Leg 2 spans 9..15 and carries on to roomB.
      { id: 'c1', rect: { x: 6, z: 0, w: 6, d: 2 }, height: 3,
        corridorType: 'passage', linkId: 'roomA>roomB' },
      { id: 'c2', rect: { x: 12, z: 0, w: 6, d: 2 }, height: 3,
        corridorType: 'squeeze', linkId: 'roomA>roomB' },
    ],
    props: [], torches: [], spawns: [], doors: [], stairs: [],
  } as unknown as LevelSpec;
}

// THE FIXTURE IS PART OF THE TEST. The first version of this file had roomA
// (-4..4) merely TOUCHING c1 (4..10) and called it a mouth, so the overlap case
// failed against correct code. Pin the geometry the cases depend on.
test('FIXTURE: the room and the first corridor leg genuinely OVERLAP', () => {
  const f = floor();
  const a = f.rooms[0].rect, c = f.corridors[0].rect;
  const roomMaxX = a.x + a.w / 2, legMinX = c.x - c.w / 2;
  assert.ok(legMinX < roomMaxX, `leg starts at ${legMinX}, room ends at ${roomMaxX} — no overlap`);
});

test('A POINT IN A ROOM NAMES THE ROOM', () => {
  const p = locateInLevel(floor(), 0, 0);
  assert.deepEqual(p.inside.map((r) => r.id), ['roomA']);
  assert.equal(p.inside[0].kind, 'room');
  assert.equal(p.nearest, null, 'nearest is for points inside nothing');
});

test('A CORRIDOR REPORTS ITS TYPE AND ITS CONNECTION', () => {
  const p = locateInLevel(floor(), 13, 0);
  const c = p.inside.find((r) => r.kind === 'corridor');
  assert.ok(c, 'point is in a corridor');
  assert.equal(c.id, 'c2');
  assert.equal(c.corridorType, 'squeeze');
  // The linkId is the reportable half — a dogleg's legs are a build detail.
  assert.equal(c.linkId, 'roomA>roomB');
});

test('THE MOUTH REPORTS BOTH — where the doorway bugs live', () => {
  // x=3.5: inside roomA (-4..4) AND inside c1 (3..9). That overlap is the doorway.
  const p = locateInLevel(floor(), 3.5, 0);
  const ids = p.inside.map((r) => r.id).sort();
  assert.deepEqual(ids, ['c1', 'roomA'],
    'a point in the corridor mouth belongs to both, and saying so is the point');
});

test('A POINT INSIDE NOTHING NAMES THE NEAREST THING — the void-gap case', () => {
  const p = locateInLevel(floor(), 0, 20);
  assert.deepEqual(p.inside, [], 'the void is inside nothing');
  assert.ok(p.nearest, 'but it still has a neighbour');
  assert.equal(p.nearest.id, 'roomA');
  // 20 from centre, room half-depth 4 → 16 to the edge.
  assert.equal(p.nearest.distance, 16);
});

test('NEAREST PREFERS THE CLOSEST EDGE, NOT THE CLOSEST CENTRE', () => {
  // Just north of the corridor c2: c2's centre is 13 away in x from roomA's,
  // but its EDGE is much closer to this point than roomA's is.
  const p = locateInLevel(floor(), 13, 3);
  assert.deepEqual(p.inside, []);
  assert.equal(p.nearest?.id, 'c2');
  assert.equal(p.nearest?.distance, 2);   // |3| - d/2 (=1) = 2
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
