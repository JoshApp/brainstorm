// STONE IN THE MIDDLE OF A ROOM — the thing that seals a dungeon.
//
// Interior obstacles are the single easiest way to ship a dead run: a colonnade
// that leaves a doorway behind it, a ring that walls the trove into its own
// middle, a pinch whose gap is 40cm. None of those look wrong in a plan view.
//
// So the module's contract is that it CANNOT return a plan it hasn't verified —
// the flood is inside planInterior, not a caller's responsibility. These tests
// exist to prove the verify is real, which means the important ones are the
// ones that hand it a room it MUST refuse. A checker that never says no is
// indistinguishable from no checker.
//
//   npm test

import assert from 'node:assert/strict';
import { planInterior, interiorAreaLoss, type InteriorForm } from '../src/level/room-interior';
import { ARCHETYPES, generateRoomShape, polyArea, pointInPoly, type Poly } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function fixedRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL: InteriorForm[] = ['colonnade', 'pinch', 'ring'];
const CELL = 0.25, R = 0.3, SHAFT = 0.42;
const box = (w: number, d: number): Poly =>
  [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

test('THE DOORWAYS STAY CONNECTED, ON EVERY SHAPE IT ACCEPTS', () => {
  // The end-to-end claim. Run every archetype at a size worth subdividing, with
  // doors on opposite sides, and flood the result independently of the module's
  // own check — a verify that only agrees with itself proves nothing.
  let accepted = 0;
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < 6; s++) {
      const rand = fixedRand(1000 + s);
      const poly = generateRoomShape(kind, { w: 15, d: 13, rand });
      const doors = [{ x: 0, z: -5.6 }, { x: 0, z: 5.6 }, { x: -6.5, z: 0 }]
        .filter((p) => pointInPoly(poly, p.x, p.z));
      if (doors.length < 2) continue;
      const plan = planInterior(poly, { doorways: doors, rand }, ALL);
      if (!plan) continue;
      accepted++;
      assert.ok(connected(poly, plan.pillars, doors),
        `${kind}/${s}: a ${plan.form} left a doorway on the wrong side of the stone`);
    }
  }
  assert.ok(accepted > 10, `only ${accepted} rooms accepted any form — the proposer is the thing broken`);
});

test('IT REFUSES TO WALL SOMETHING IN', () => {
  // The one that matters. A ring around the room's middle circulates perfectly
  // — you can walk all the way round it — while sealing whatever stands inside.
  // Rule 1 (doors reach doors) passes here and the room is still broken, which
  // is why `mustReach` exists.
  const poly = box(16, 16);
  const rand = fixedRand(7);
  const doors = [{ x: 0, z: -7.5 }, { x: 0, z: 7.5 }];
  const withCentre = planInterior(poly, {
    doorways: doors,
    // A tight ring is exactly what a `ring` form builds — so if it can wall the
    // centre off, asking it to keep the centre reachable must change the answer.
    mustReach: [{ x: 0, z: 0 }],
    avoid: [{ x: 0, z: 0, r: 5.0 }],   // force the stone outward, into a tight ring
    rand,
  }, ['ring']);
  if (withCentre) {
    assert.ok(reaches(poly, withCentre.pillars, doors[0], { x: 0, z: 0 }),
      'shipped a ring with the centre sealed inside it');
  }
});

test('a room too small to subdivide is left alone', () => {
  const rand = fixedRand(3);
  assert.equal(
    planInterior(box(5, 5), { doorways: [{ x: 0, z: -2.4 }, { x: 0, z: 2.4 }], rand }, ALL),
    null, 'crammed stone into a broom cupboard');
});

test('NULL IS REACHABLE — it does not accept everything', () => {
  // The control. If planInterior said yes to every room it was handed, every
  // test above would pass while the verify did nothing at all.
  let refused = 0, asked = 0;
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < 8; s++) {
      const rand = fixedRand(400 + s);
      // Deliberately awkward: narrow, and with a door on the short end.
      const poly = generateRoomShape(kind, { w: 13, d: 7.5, rand });
      const doors = [{ x: -6, z: 0 }, { x: 6, z: 0 }].filter((p) => pointInPoly(poly, p.x, p.z));
      if (doors.length < 2) continue;
      asked++;
      if (!planInterior(poly, { doorways: doors, rand }, ALL)) refused++;
    }
  }
  assert.ok(asked > 0, 'the fixture produced no rooms to ask about');
  assert.ok(refused > 0, `accepted a form in all ${asked} awkward rooms — the verify is not running`);
});

test('it never eats more than a third of the floor', () => {
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < 5; s++) {
      const rand = fixedRand(90 + s);
      const poly = generateRoomShape(kind, { w: 16, d: 14, rand });
      const doors = [{ x: 0, z: -6 }, { x: 0, z: 6 }].filter((p) => pointInPoly(poly, p.x, p.z));
      if (doors.length < 2) continue;
      const plan = planInterior(poly, { doorways: doors, rand }, ALL);
      if (!plan) continue;
      const loss = interiorAreaLoss(poly, plan.pillars);
      assert.ok(loss <= 0.34 + 1e-6,
        `${kind}/${s}: a ${plan.form} cost ${(loss * 100).toFixed(0)}% of the floor`);
    }
  }
});

test('stone stays off the walls and out of what is already there', () => {
  const rand = fixedRand(55);
  const poly = generateRoomShape('chamber', { w: 16, d: 14, rand });
  const claimed = { x: 2, z: 1, r: 1.2 };
  const plan = planInterior(poly, {
    doorways: [{ x: 0, z: -6 }, { x: 0, z: 6 }], avoid: [claimed], rand,
  }, ALL);
  if (!plan) return;
  for (const p of plan.pillars) {
    assert.ok(pointInPoly(poly, p.x, p.z), 'a pillar stands outside the room');
    assert.ok(Math.hypot(p.x - claimed.x, p.z - claimed.z) > claimed.r,
      'a pillar stands inside something the room already committed to');
  }
});

// ── an independent flood, so the tests do not grade the module's own homework ──

function open(poly: Poly, piers: ReadonlyArray<{ x: number; z: number; size: number }>, x: number, z: number) {
  if (!pointInPoly(poly, x, z)) return false;
  for (const p of piers) if (Math.hypot(p.x - x, p.z - z) < p.size * SHAFT + R) return false;
  return true;
}

function reaches(
  poly: Poly, piers: ReadonlyArray<{ x: number; z: number; size: number }>,
  from: { x: number; z: number }, to: { x: number; z: number },
): boolean {
  const k = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  const seen = new Set([k(from.x, from.z)]);
  const q = [[from.x, from.z] as [number, number]];
  let best = Infinity;
  while (q.length) {
    const [x, z] = q.pop()!;
    best = Math.min(best, Math.hypot(x - to.x, z - to.z));
    for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]] as const) {
      const nx = x + dx, nz = z + dz;
      const key = k(nx, nz);
      if (seen.has(key) || !open(poly, piers, nx, nz)) continue;
      seen.add(key); q.push([nx, nz]);
    }
  }
  return best < 1.3;
}

function connected(
  poly: Poly, piers: ReadonlyArray<{ x: number; z: number; size: number }>,
  doors: ReadonlyArray<{ x: number; z: number }>,
): boolean {
  return doors.every((d) => reaches(poly, piers, doors[0], d));
}

void polyArea;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
