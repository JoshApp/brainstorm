// IS A LIVING BODY IN THE WAY?
//
// The level answers about stone and has never known an enemy, so both traversal
// moves that ask "can I get over this" were answering with half the world. This
// module is the other half, and the two callers pull it in opposite directions:
// the WALK-vault must refuse a body, the DODGE must clear one. Both are wrong if
// this is wrong, so the cases here are the ones that decide a real move.
//
//   npm test -- body-path

import assert from 'node:assert/strict';
import { firstBodyOnPath, anyBodyOverlaps, landingBeyond } from '../src/player/body-path';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** A mob of ordinary size, two metres straight ahead down +Z. */
const AHEAD = { x: 0, z: 2, radius: 0.5 };
const PLAYER_R = 0.3;

test('a body straight ahead is on the path', () => {
  const hit = firstBodyOnPath(0, 0, 0, 3, PLAYER_R, [AHEAD]);
  assert.ok(hit, 'walked through a mob standing directly in front');
  assert.equal(hit.body, AHEAD);
  assert.ok(Math.abs(hit.along - 2) < 1e-6, `closest approach reported at ${hit.along}`);
});

test('A BODY PAST THE LANDING IS NOT IN THE WAY — the kerb-hop case', () => {
  // This is the difference between "no vault while an enemy is anywhere ahead"
  // (which would break stepping over a kerb with a mob across the room) and the
  // rule we actually want: no vault that goes OVER one.
  assert.equal(firstBodyOnPath(0, 0, 0, 1.0, PLAYER_R, [AHEAD]), null,
    'a mob beyond the landing blocked a step that never reaches it');
});

test('a body BEHIND is not in the way', () => {
  assert.equal(firstBodyOnPath(0, 0, 0, -3, PLAYER_R, [AHEAD]), null);
});

test('THE SWEEP CATCHES WHAT ENDPOINTS MISS', () => {
  // A dodge crosses ~1.3m in a few frames. Both ends of this move are clear of
  // the mob and it is squarely in the middle — a point test at either end says
  // "nothing there" and the player rolls through a body.
  const hit = firstBodyOnPath(0, 0, 0, 4, PLAYER_R, [AHEAD]);
  assert.ok(hit, 'the swept test degraded into an endpoint test');
});

test('a graze counts — the radii are the contract', () => {
  // Path down x=0.7. Centres are 0.7 apart, reach is 0.5+0.3=0.8 → overlap.
  assert.ok(firstBodyOnPath(0.7, 0, 0.7, 4, PLAYER_R, [AHEAD]));
  // At 0.9 apart there is clear air between them.
  assert.equal(firstBodyOnPath(0.9, 0, 0.9, 4, PLAYER_R, [AHEAD]), null);
});

test('ALREADY INSIDE ONE IS A HIT, NOT A MISS', () => {
  // The dodge fires from wherever the player is, and that is often already
  // touching the mob. If contact at t=0 read as "clear", the one dodge that most
  // needs the leap — the one from inside the thing — would never arm it.
  const hit = firstBodyOnPath(0, 2, 0, 5, PLAYER_R, [AHEAD]);
  assert.ok(hit, 'standing in a body reported a clear path');
  assert.equal(hit.along, 0);
});

test('the NEAREST body wins when two are on the line', () => {
  const near = { x: 0, z: 1, radius: 0.4 };
  const hit = firstBodyOnPath(0, 0, 0, 4, PLAYER_R, [AHEAD, near]);
  assert.equal(hit?.body, near, 'the leap would clear the far mob and land on the near one');
});

test('a zero-length probe still tests where you stand', () => {
  assert.ok(firstBodyOnPath(0, 2, 0, 2, PLAYER_R, [AHEAD]));
  assert.equal(firstBodyOnPath(0, 0, 0, 0, PLAYER_R, [AHEAD]), null);
});

test('an empty world is always clear', () => {
  assert.equal(firstBodyOnPath(0, 0, 0, 5, PLAYER_R, []), null);
  assert.equal(anyBodyOverlaps(0, 0, PLAYER_R, []), false);
});

test('anyBodyOverlaps is the landing check', () => {
  assert.equal(anyBodyOverlaps(0, 2, PLAYER_R, [AHEAD]), true);
  assert.equal(anyBodyOverlaps(0, 2.9, PLAYER_R, [AHEAD]), false);   // 0.9 > 0.8 reach
});

test('THE LANDING IS PAST THE BODY, DERIVED FROM ITS SIZE', () => {
  const land = landingBeyond(0, 0, 0, 1, AHEAD, PLAYER_R, 0.35);
  // 2 (to centre) + 0.5 (body) + 0.3 (player) + 0.35 (clearance) = 3.15
  assert.ok(Math.abs(land.z - 3.15) < 1e-6, `landed at ${land.z}`);
  assert.ok(Math.abs(land.x) < 1e-6, 'the leap drifted sideways');
  assert.ok(!anyBodyOverlaps(land.x, land.z, PLAYER_R, [AHEAD]),
    'the leap came down inside the thing it was leaping');
});

test('A BIGGER BODY IS A BIGGER JUMP — no constant would do', () => {
  const rat = { x: 0, z: 1.5, radius: 0.2 };
  const knight = { x: 0, z: 1.5, radius: 0.9 };
  const overRat = landingBeyond(0, 0, 0, 1, rat, PLAYER_R, 0.35).z;
  const overKnight = landingBeyond(0, 0, 0, 1, knight, PLAYER_R, 0.35).z;
  assert.ok(overKnight - overRat > 0.6,
    'both bodies got the same jump — one of them is landed on');
  assert.ok(!anyBodyOverlaps(0, overRat, PLAYER_R, [rat]));
  assert.ok(!anyBodyOverlaps(0, overKnight, PLAYER_R, [knight]));
});

test('the landing follows the travel direction, not an axis', () => {
  const d = Math.SQRT1_2;
  const diag = { x: 1.5 * d, z: 1.5 * d, radius: 0.5 };
  const land = landingBeyond(0, 0, d, d, diag, PLAYER_R, 0.35);
  assert.ok(Math.abs(land.x - land.z) < 1e-6, 'the leap left the line it was thrown along');
  assert.ok(!anyBodyOverlaps(land.x, land.z, PLAYER_R, [diag]));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
