// A CORRIDOR IS A ROUTE, NOT A DIRECTION.
//
// Josh: *"can't we just make the corridor shape be more than a linear line?
// That should get around rooms not facing each other."*
//
// It does. Over the 183 links the generator really makes, a straight corridor
// between two agreeing walls serves 83%; routing serves **99%**, rescuing 32 of
// the 32 it could not.
//
// ── WHY THIS FILE IS MOSTLY SYNTHETIC, WHICH IS UNUSUAL HERE ─────────────────
//
// Because the real floors cannot exercise it. `connect()` only ever links rooms
// that already share an axis — 0 of 183 link pairs are perpendicular to each
// other — so the L branch, the whole reason the router exists, never fires on
// live data. A branch that never runs looks exactly like a branch that works,
// and it would go into the layout rewrite unverified.
//
// So: the aggregate results are measured against the real generator (below),
// and every ROUTE SHAPE is pinned with geometry chosen to force it.
//
//   npm test -- corridor-route

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { deriveAnchors } from '../src/level/anchors';
import { chooseLinkOpening, mouthWidth } from '../src/level/link-anchors';
import {
  routeBetween, chooseLinkRoute, routeLength, MIN_LEG_FACTOR,
} from '../src/level/corridor-route';
import { pointInPoly, type Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SECTION = 2.2;
const want = { section: SECTION };

/** A rectangular room, its anchors derived the shipping way. */
function box(id: string, x: number, z: number, w: number, d: number) {
  const poly: Poly = [
    [x, z], [x + w, z], [x + w, z + d], [x, z + d],
  ];
  return { id, poly, anchors: deriveAnchors(id, poly, 4) };
}

/** The anchor of `room` whose normal points closest to (dx, dz). */
function facing(room: ReturnType<typeof box>, dx: number, dz: number) {
  const len = Math.hypot(dx, dz);
  let best = room.anchors[0], score = -Infinity;
  for (const a of room.anchors) {
    const s = (a.normal[0] * dx + a.normal[1] * dz) / len;
    if (s > score) { score = s; best = a; }
  }
  return best;
}

test('AN L JOINS TWO ROOMS THAT DO NOT FACE EACH OTHER', () => {
  // The case the whole router exists for, and the one live floors cannot reach.
  // A is at the origin; B sits off to the north-east, so A's EAST wall and B's
  // SOUTH wall are perpendicular — no straight corridor can ever join them.
  const A = box('a', 0, 0, 10, 10);
  const B = box('b', 20, 20, 10, 10);
  const aE = facing(A, 1, 0);    // A's east wall, normal +X
  const bS = facing(B, 0, -1);   // B's south wall, normal -Z
  assert.ok(Math.abs(aE.normal[0]) > 0.9, 'test setup: expected an east-facing anchor');
  assert.ok(Math.abs(bS.normal[1]) > 0.9, 'test setup: expected a south-facing anchor');

  const r = routeBetween(aE, A.poly, 2.5, bS, B.poly, 2.5, SECTION, []);
  assert.ok(r, 'two perpendicular walls could not be joined — the L branch is dead');
  assert.equal(r!.bends, 1, `expected one bend, got ${r!.bends}`);
  assert.equal(r!.legs.length, 2);

  // The legs meet, each is axis-aligned, and each LEAVES its own wall.
  const [l1, l2] = r!.legs;
  assert.deepEqual(l1.to, l2.from, 'the two legs do not meet at the corner');
  for (const l of r!.legs) {
    const axis = Math.abs(l.to[0] - l.from[0]) < 1e-9 || Math.abs(l.to[1] - l.from[1]) < 1e-9;
    assert.ok(axis, 'a leg is diagonal — everything downstream assumes axis-aligned');
  }
  assert.ok((l1.to[0] - l1.from[0]) * aE.normal[0] > 0, "the first leg runs back into A's wall");
  assert.ok((l2.from[1] - l2.to[1]) * bS.normal[1] > 0, "the last leg arrives at B from the wrong side");

  // And it starts and ends ON the walls — the whole point. Nothing is pushed
  // 0.9m past anything.
  assert.ok(pointInPoly(A.poly, r!.aAt[0] - aE.normal[0] * 0.05, r!.aAt[1] - aE.normal[1] * 0.05),
    "the route's A end is not on A's wall");
  assert.ok(!pointInPoly(A.poly, r!.aAt[0] + aE.normal[0] * 0.05, r!.aAt[1] + aE.normal[1] * 0.05),
    "the route's A end reaches inside A");
});

test('A Z JOINS TWO FACING ROOMS THAT DO NOT LINE UP', () => {
  // Opposed walls, laterals with no overlap at all. This is the shape that
  // rescued 32 real links.
  const A = box('a', 0, 0, 8, 8);
  const B = box('b', 30, 40, 8, 8);
  const r = routeBetween(facing(A, 1, 0), A.poly, 2.5, facing(B, -1, 0), B.poly, 2.5, SECTION, []);
  assert.ok(r, 'two offset facing walls could not be joined');
  assert.equal(r!.bends, 2);
  assert.equal(r!.legs.length, 3);
  const [, cross] = r!.legs;
  assert.ok(Math.abs(cross.to[0] - cross.from[0]) < 1e-9,
    'the crossing leg of a Z should run laterally');
});

test('A STRAIGHT RUN IS PREFERRED, AND HAS NO LENGTH FLOOR', () => {
  // Bends are for making impossible links possible, not to be spent for their
  // own sake — a floor of L's when a straight run was available reads as a maze
  // rather than a plan.
  const A = box('a', 0, 0, 10, 10);
  const B = box('b', 20, 0, 10, 10);
  const r = chooseLinkRoute(A, B, want, mouthWidth, []);
  assert.ok(r);
  assert.equal(r!.bends, 0, 'a straight route existed and a bent one was chosen');

  // Two rooms almost touching: a thick doorway, which is a real thing. The bend
  // rule must not be charged to a run that has no bend — that regression cost a
  // link the straight-only chooser could serve.
  const near = box('n', 12.6, 0, 10, 10);   // a 2.6m gap, under SECTION * MIN_LEG_FACTOR
  assert.ok(SECTION * MIN_LEG_FACTOR > 2.6, 'test setup: the gap must be under the bend floor');
  assert.ok(chooseLinkRoute(A, near, want, mouthWidth, []),
    'a short straight run was refused by a rule about bends');
});

test('A ROUTE DOES NOT DRIVE THROUGH A THIRD ROOM', () => {
  // A corridor through a room is not a corridor, it is a hole in that room.
  const A = box('a', 0, 0, 8, 8);
  const B = box('b', 40, 0, 8, 8);
  const clear = chooseLinkRoute(A, B, want, mouthWidth, []);
  assert.ok(clear, 'test setup: these two should route with nothing in the way');

  const between: Poly = [[18, -6], [26, -6], [26, 14], [18, 14]];
  const blocked = chooseLinkRoute(A, B, want, mouthWidth, [{ id: 'c', poly: between }]);
  if (blocked) {
    for (const leg of blocked.legs) {
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const x = leg.from[0] + (leg.to[0] - leg.from[0]) * (i / steps);
        const z = leg.from[1] + (leg.to[1] - leg.from[1]) * (i / steps);
        assert.ok(!pointInPoly(between, x, z),
          `the route runs through the blocking room at (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
  }
  // Fully walled off: it must say no rather than tunnel.
  const wall: Poly = [[18, -60], [26, -60], [26, 60], [18, 60]];
  assert.equal(chooseLinkRoute(A, B, want, mouthWidth, [{ id: 'w', poly: wall }]), null,
    'a route was found straight through a wall spanning the whole gap');
});

test('EACH MOUTH IS NEGOTIATED WITH ITS OWN WALL, AND MAY DIFFER', () => {
  // Once a corridor can bend, the two ends stop being one opening both sides
  // must accept and become two thresholds, each cut into a single wall. A wide
  // room and a narrow one should not have to meet in the middle.
  const wide = box('w', 0, 0, 24, 24);
  const narrow = box('n', 40, 8, 6, 8);
  const r = chooseLinkRoute(wide, narrow, want, mouthWidth, []);
  assert.ok(r, 'a wide room and a narrow one could not be joined');
  assert.ok(r!.aWidth > SECTION, `the wide room's mouth (${r!.aWidth.toFixed(2)}m) did not open out`);
  assert.ok(r!.bWidth <= r!.b.width[1] + 1e-9,
    "the narrow room's mouth exceeds what its wall published");
});

test('AND THE AGGREGATE HOLDS ON REAL FLOORS', () => {
  // The claim that motivates the whole change, measured against the shipping
  // generator rather than against the shapes above.
  const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
  const DEPTHS = [1, 2, 5, 6, 8, 11];
  let links = 0, straight = 0, routed = 0;
  for (const seed of SEEDS) for (const depth of DEPTHS) {
    const spec = generatePolyFloor(depth, seed);
    const rooms = spec.rooms.filter((r) => r.poly && r.poly.length >= 3);
    const cache = new Map<string, ReturnType<typeof deriveAnchors>>();
    const anch = (r: typeof rooms[number]) => {
      let v = cache.get(r.id);
      if (!v) cache.set(r.id, v = deriveAnchors(r.id, r.poly as Poly, r.height));
      return v;
    };
    for (const c of spec.corridors) {
      const ends: Array<[number, number]> = [
        [c.rect.x - c.rect.w / 2, c.rect.z], [c.rect.x + c.rect.w / 2, c.rect.z],
        [c.rect.x, c.rect.z - c.rect.d / 2], [c.rect.x, c.rect.z + c.rect.d / 2],
      ];
      const touch = rooms.filter((r) => ends.some((e) => pointInPoly(r.poly as Poly, e[0], e[1])));
      if (touch.length < 2) continue;
      links++;
      const A = { poly: touch[0].poly as Poly, anchors: anch(touch[0]) };
      const B = { poly: touch[1].poly as Poly, anchors: anch(touch[1]) };
      const obst = rooms.filter((r) => r.id !== touch[0].id && r.id !== touch[1].id)
        .map((r) => ({ id: r.id, poly: r.poly as Poly }));
      if (chooseLinkOpening(A, B, [touch[1].rect.x - touch[0].rect.x,
        touch[1].rect.z - touch[0].rect.z], want)) straight++;
      if (chooseLinkRoute(A, B, want, mouthWidth, obst)) routed++;
    }
  }
  assert.ok(links > 150, `only ${links} links sampled — this measured nothing`);
  assert.ok(routed / links > 0.97,
    `routing serves only ${((routed / links) * 100).toFixed(0)}% of links`);
  assert.ok(routed > straight,
    `routing (${routed}) served no more links than a straight corridor (${straight}) — `
    + 'the flexibility bought nothing');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
