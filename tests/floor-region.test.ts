// THE FLOOR, AS SOMETHING YOU CAN ASK QUESTIONS OF.
//
// The bug being killed: every placer in the game treats `rect.x, rect.z` as the
// middle of the room. True for a rectangle. For an L the bbox centre is IN THE
// WALL, and for a cross or an apse it can sit in a limb nobody stands in. It
// fails silently and reads as a content mistake — "that altar is badly placed" —
// so it gets nudged by hand and comes back on the next seed.
//
// The headline test is therefore not about precision. It is: on every archetype,
// does the room's centre land INSIDE the room, and is it further from the walls
// than the bounding-box centre it replaces?
//
//   npm test

import assert from 'node:assert/strict';
import {
  candidateSpots, clearance, hasSightline, roomCenter,
} from '../src/level/floor-region';
import { ARCHETYPES, generateRoomShape, pointInPoly, polyBounds, type Poly } from '../src/level/room-shape';

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
    for (let s = 0; s < 12; s++) {
      const rand = mulberry(s * 7919 + 13);
      yield { kind, poly: generateRoomShape(kind, { w: 8 + rand() * 8, d: 6 + rand() * 7, rand }) };
    }
  }
}

/** The thing being replaced. */
function bboxCentre(poly: Poly) {
  const b = polyBounds(poly);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

test('clearance is signed, and the sign is containment', () => {
  const poly: Poly = [[-5, -3], [5, -3], [5, 3], [-5, 3]];
  assert.ok(Math.abs(clearance(poly, 0, 0) - 3) < 1e-9, 'centre of a 10x6 room should be 3m from a wall');
  assert.ok(Math.abs(clearance(poly, 0, 2.5) - 0.5) < 1e-9, 'near the south wall');
  assert.ok(clearance(poly, 0, 6) < 0, 'a point outside should be negative');
  for (const { kind, poly: p } of shapes()) {
    for (let i = 0; i < 40; i++) {
      const rand = mulberry(i * 13 + 1);
      const b = polyBounds(p);
      const x = b.minX - 2 + rand() * (b.maxX - b.minX + 4);
      const z = b.minZ - 2 + rand() * (b.maxZ - b.minZ + 4);
      assert.equal(clearance(p, x, z) > 0, pointInPoly(p, x, z),
        `${kind}: clearance sign disagrees with containment at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
});

test('THE MIDDLE OF THE ROOM IS INSIDE THE ROOM', () => {
  for (const { kind, poly } of shapes()) {
    const c = roomCenter(poly);
    assert.ok(pointInPoly(poly, c.x, c.z), `${kind}: room centre is OUTSIDE the room`);
    assert.ok(clearance(poly, c.x, c.z) > 0.5,
      `${kind}: room centre has only ${clearance(poly, c.x, c.z).toFixed(2)}m of clearance`);
  }
});

test('and it beats the bounding-box centre it replaces', () => {
  // Not just "different" — measurably roomier, on every shape, since that is the
  // whole claim. A tie is fine (a rectangle's bbox centre IS the pole); worse is
  // not.
  let improved = 0, total = 0;
  for (const { kind, poly } of shapes()) {
    const mine = roomCenter(poly);
    const theirs = bboxCentre(poly);
    const cm = clearance(poly, mine.x, mine.z);
    const ct = clearance(poly, theirs.x, theirs.z);
    assert.ok(cm >= ct - 1e-6, `${kind}: room centre (${cm.toFixed(2)}m) is worse than the bbox centre (${ct.toFixed(2)}m)`);
    total++;
    if (cm > ct + 0.1) improved++;
  }
  assert.ok(improved / total > 0.5,
    `only ${improved}/${total} shapes improved — if the bbox centre were fine this module would not need to exist`);
});

test('a bbox centre really can land outside the room', () => {
  // The concrete case behind all of this: an L. Its bounding box centre is in
  // the notch, i.e. in the wall.
  const ell: Poly = [[-5, -5], [-1, -5], [-1, 1], [5, 1], [5, 5], [-5, 5]];
  const b = bboxCentre(ell);
  assert.ok(!pointInPoly(ell, b.x, b.z), 'this L was supposed to have its bbox centre outside it');
  const c = roomCenter(ell);
  assert.ok(pointInPoly(ell, c.x, c.z), 'roomCenter put the middle outside an L');
});

test('candidate spots respect their band and their radius', () => {
  for (const { kind, poly } of shapes()) {
    const wallBand = candidateSpots(poly, { radius: 0.3, band: [0.4, 1.2] });
    for (const s of wallBand) {
      const c = clearance(poly, s.x, s.z);
      assert.ok(c >= 0.4 && c <= 1.2, `${kind}: clutter candidate is ${c.toFixed(2)}m from a wall`);
    }
    const middle = candidateSpots(poly, { radius: 1.2 });
    for (const s of middle) {
      assert.ok(clearance(poly, s.x, s.z) >= 1.2, `${kind}: candidate cannot hold its own radius`);
      assert.ok(pointInPoly(poly, s.x, s.z), `${kind}: candidate is outside the room`);
    }
    assert.ok(middle.length > 0, `${kind}: no room anywhere for a 1.2m-radius thing`);
    // Roomiest first, so a caller that takes the head gets a sane answer.
    for (let i = 1; i < middle.length; i++) {
      assert.ok(middle[i - 1].clearance >= middle[i].clearance, `${kind}: candidates are not sorted`);
    }
  }
});

test('candidates avoid what is already there', () => {
  const poly: Poly = [[-6, -6], [6, -6], [6, 6], [-6, 6]];
  const taken = [{ x: 0, z: 0, r: 3 }];
  for (const s of candidateSpots(poly, { radius: 0.5, taken })) {
    assert.ok(Math.hypot(s.x, s.z) >= 3.5 - 1e-9,
      `a candidate landed ${Math.hypot(s.x, s.z).toFixed(2)}m from something with a 3m radius`);
  }
});

test('SIGHTLINE KNOWS WHERE THE WALLS ARE', () => {
  // "Visible from the entrance" is the question event placement actually wants,
  // and a rectangle could never answer it — it had no idea where its own walls
  // were. An L is the test: across the corner is blocked, along a limb is not.
  const ell: Poly = [[-5, -5], [-1, -5], [-1, 1], [5, 1], [5, 5], [-5, 5]];
  assert.ok(hasSightline(ell, { x: -3, z: -4 }, { x: -3, z: 4 }), 'straight down the west limb should be clear');
  assert.ok(hasSightline(ell, { x: -4, z: 3 }, { x: 4, z: 3 }), 'straight along the south limb should be clear');
  assert.ok(!hasSightline(ell, { x: -3, z: -4 }, { x: 4, z: 3 }),
    'a line from the north tip to the east tip cuts the corner — it must be blocked');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
