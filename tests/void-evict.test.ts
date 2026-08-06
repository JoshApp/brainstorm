// NOTHING STANDS OVER A HOLE.
//
// Josh's report was "void carves under wells/basins — props left hanging over
// the pit", and the reason it survived three separate placement-time guards is
// that the props which produced it made no placement decision at runtime: a
// vault's ASCII authored a trap on a cell its own authored void rect swallowed.
//
// So the rule is enforced against the FINAL STATE (docs/DESIGN-METHOD.md), and
// these are the properties that pass has to have. The one that matters most is
// the last: it must not quietly delete the floor's content while it tidies.
//
//   npm test

import assert from 'node:assert/strict';
import { evictFromVoids, overVoid } from '../src/level/void-evict';
import type { PropSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const rect = (x: number, z: number, w: number, d: number) => ({ x, z, w, d });
const prop = (kind: string, x: number, z: number) => ({ kind, x, z } as unknown as PropSpec);
/** A big clear room with one hole punched in the middle of it. */
const ROOM = { floors: [rect(0, 0, 20, 20)], voids: [rect(0, 0, 3, 3)] };

test('A PROP OVER A HOLE IS MOVED ONTO SOLID GROUND', () => {
  const props = [prop('spike-trap', 0.5, 0.5)];
  const r = evictFromVoids(props, ROOM);
  assert.equal(r.nudged, 1);
  assert.equal(r.dropped, 0);
  assert.equal(props.length, 1, 'the prop was deleted when it could have been moved');
  assert.ok(!overVoid(props[0].x, props[0].z, ROOM.voids), 'it was moved and is STILL over the hole');
});

test('...and a prop on the LIP counts too', () => {
  // A thing balanced on the edge reads as badly as one over the middle, which
  // is literally the wording of the report — "almost in the void or slightly
  // over it".
  const onLip = 1.5 + 0.2;   // just outside the rect, inside the lip margin
  const props = [prop('vase', onLip, 0)];
  assert.equal(evictFromVoids(props, ROOM).nudged, 1);
});

test('A PROP ON SOLID GROUND IS NOT TOUCHED', () => {
  // The control. A pass that moved everything would satisfy every test above
  // and wreck every room in the game.
  const props = [prop('chest', 8, 8), prop('vase', -7, 3)];
  const before = props.map((p) => `${p.x},${p.z}`);
  const r = evictFromVoids(props, ROOM);
  assert.deepEqual({ n: r.nudged, d: r.dropped }, { n: 0, d: 0 });
  assert.deepEqual(props.map((p) => `${p.x},${p.z}`), before);
});

test('IT DROPS ONLY WHEN THERE IS NOWHERE TO GO', () => {
  // A room that is ALL hole. Nothing within reach is solid, so the prop has to
  // go — hanging in mid-air is the one outcome that is never acceptable.
  const allVoid = { floors: [rect(0, 0, 20, 20)], voids: [rect(0, 0, 20, 20)] };
  const props = [prop('spike-trap', 0, 0)];
  const r = evictFromVoids(props, allVoid);
  assert.equal(r.dropped, 1);
  assert.equal(props.length, 0);
});

test('a nudged prop stays INSIDE the room, not out through a wall', () => {
  // A hole hard against the room's edge: the escape ring must not push the prop
  // into the masonry, which would trade a visible bug for an invisible one.
  const edge = { floors: [rect(0, 0, 10, 10)], voids: [rect(4, 0, 2, 2)] };
  const props = [prop('vase', 4, 0)];
  evictFromVoids(props, edge);
  assert.ok(Math.abs(props[0].x) <= 5 && Math.abs(props[0].z) <= 5,
    `nudged to (${props[0].x}, ${props[0].z}) — outside the room`);
});

test('IT IS IDEMPOTENT — a second pass finds nothing', () => {
  // The property that makes it safe to run at the end of every compose, and the
  // check that would catch a nudge that lands on another void.
  const props = [prop('spike-trap', 0.5, 0.5), prop('altar', -1, 1)];
  evictFromVoids(props, ROOM);
  const second = evictFromVoids(props, ROOM);
  assert.deepEqual({ n: second.nudged, d: second.dropped }, { n: 0, d: 0 });
});

test('a floor with no voids is left entirely alone, cheaply', () => {
  const props = [prop('chest', 0, 0)];
  const r = evictFromVoids(props, { floors: [rect(0, 0, 20, 20)], voids: [] });
  assert.deepEqual({ n: r.nudged, d: r.dropped }, { n: 0, d: 0 });
  assert.equal(props.length, 1);
});

test('IT REPORTS WHAT IT MOVED, by kind', () => {
  // A correction that silently deletes content looks exactly like a floor that
  // never had any. The report is how the audit stays honest about which
  // producer keeps doing this.
  const props = [prop('spike-trap', 0.5, 0.5), prop('spike-trap', -0.5, 0.5), prop('altar', 0, -0.5)];
  const r = evictFromVoids(props, ROOM);
  assert.deepEqual(r.byKind, { 'spike-trap': 2, altar: 1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
