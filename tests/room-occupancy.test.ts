// WHAT IS ALREADY THERE.
//
// The builder currently carries FIVE repair passes — nudgePropsOutOfPassages,
// clearChestsBlockingCorridors, rescueOneBlocker, ensureStairsReachable, and an
// elbow-room strip. That is not five bugs, it is one bug five times: placement
// is blind and the damage is repaired afterwards. A producer that can ask
// "does this fit" before committing does not generate damage to repair.
//
// Two things have to be true for that to work, and they are what's tested here:
// the overlap test must be honest in THREE dimensions (a 2D footprint says a
// chandelier and an altar collide when they don't, and says a floor-to-ceiling
// pier and a bench don't when they do), and the answers must be available at
// COMPOSE time, before any geometry exists.
//
//   npm test

import assert from 'node:assert/strict';
import { intersects, RoomOccupancy, type Volume } from '../src/level/room-occupancy';
import { pilasterPlan, pilasterVolumes, PILASTER } from '../src/level/poly-dressing';
import { describeWalls } from '../src/level/wall-surfaces';
import { ARCHETYPES, generateRoomShape, pointInPoly, type Poly } from '../src/level/room-shape';
import { buildStarterChamber, STARTER_POLY } from '../src/level/starter-chamber';

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

const cyl = (x: number, z: number, r: number, y0 = 0, y1 = 1): Volume =>
  ({ kind: 'cylinder', x, z, r, y0, y1 });
const box = (x: number, z: number, hw: number, hd: number, rotY = 0, y0 = 0, y1 = 1): Volume =>
  ({ kind: 'box', x, z, halfW: hw, halfD: hd, rotY, y0, y1 });

test('HEIGHT IS PART OF THE ANSWER', () => {
  // The reason this is 3D at all. Same footprint, different storeys.
  const onFloor = cyl(0, 0, 0.5, 0, 1.0);
  const hanging = cyl(0, 0, 0.5, 2.5, 3.0);
  assert.ok(!intersects(onFloor, hanging), 'a chandelier collided with the altar beneath it');
  const pier = box(0, 0, 0.2, 0.1, 0, 0, 4);
  assert.ok(intersects(onFloor, pier), 'a floor-to-ceiling pier did NOT collide with a thing on the floor');
  assert.ok(intersects(hanging, pier), 'a floor-to-ceiling pier did NOT collide with a hanging thing');
});

test('circles, boxes and rotated boxes all agree with themselves', () => {
  assert.ok(intersects(cyl(0, 0, 1), cyl(1.5, 0, 1)), 'overlapping circles read as clear');
  assert.ok(!intersects(cyl(0, 0, 1), cyl(2.5, 0, 1)), 'separated circles read as overlapping');
  assert.ok(intersects(box(0, 0, 1, 1), box(1.5, 0, 1, 1)), 'overlapping boxes read as clear');
  assert.ok(!intersects(box(0, 0, 1, 1), box(2.5, 0, 1, 1)), 'separated boxes read as overlapping');
  assert.ok(intersects(box(0, 0, 1, 1), cyl(1.6, 0, 0.8)), 'box vs circle missed an overlap');
  assert.ok(!intersects(box(0, 0, 1, 1), cyl(2.2, 0, 0.8)), 'box vs circle invented an overlap');
  // A long thin box turned 45° reaches further along X than its half-width.
  const flat = box(0, 0, 2, 0.1, 0);
  const turned = box(0, 0, 2, 0.1, Math.PI / 4);
  assert.ok(!intersects(flat, cyl(2.3, 0, 0.2)), 'axis-aligned box over-reached');
  assert.ok(intersects(turned, cyl(1.3, 1.3, 0.2)), 'rotated box did not reach along its own axis');
  assert.ok(!intersects(turned, cyl(2.3, 0, 0.2)), 'rotated box reached where it no longer points');
});

test('clearance means air, not merely not-touching', () => {
  const a = cyl(0, 0, 1), b = cyl(2.1, 0, 1);
  assert.ok(!intersects(a, b), 'these barely clear');
  assert.ok(intersects(a, b, 0.5), 'a 0.5m clearance requirement was ignored');
});

test('a reservation reports WHO is in the way', () => {
  // A refusal with no reason is a refusal a producer can't act on.
  const occ = new RoomOccupancy();
  occ.reserve(box(0, 0, 0.5, 0.5, 0, 0, 4), 'pilaster');
  occ.reserve(cyl(4, 0, 0.6, 0, 1.2), 'altar');
  assert.equal(occ.blocker(cyl(0.4, 0, 0.4)), 'pilaster');
  assert.equal(occ.blocker(cyl(4.2, 0, 0.4)), 'altar');
  assert.equal(occ.blocker(cyl(-4, -4, 0.4)), null);
  assert.ok(occ.fits(cyl(-4, -4, 0.4)));
});

test('PIERS ARE KNOWN BEFORE ANY GEOMETRY EXISTS', () => {
  // The whole point of splitting the plan out of the mesh builder: a prop placed
  // at compose time can avoid a pier that won't be built until later.
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: 4 });
    const piers = pilasterPlan(walls, 4, 0);
    const vols = pilasterVolumes(walls, 4, 0);
    assert.equal(piers.length, vols.length, `${kind}: plan and volumes disagree on the pier count`);
    for (const p of piers) {
      assert.ok(pointInPoly(poly, p.x, p.z), `${kind}: a pier stands outside the room`);
      assert.ok(p.height > 0 && p.width > 0 && p.depth > 0, `${kind}: degenerate pier`);
    }
  }
});

test('no two piers in a room occupy the same space', () => {
  for (const { kind, poly } of shapes()) {
    const vols = pilasterVolumes(describeWalls({ poly, height: 4 }), 4, 0);
    for (let i = 0; i < vols.length; i++) {
      for (let j = i + 1; j < vols.length; j++) {
        assert.ok(!intersects(vols[i], vols[j]),
          `${kind}: piers ${i} and ${j} are inside each other`);
      }
    }
  }
});

test('THE STARTER CHAMBER\'S CONTENTS CLEAR ITS OWN PIERS', () => {
  // The check that would have caught it if the dressing pass had put a column
  // through an altar. Hand-placed content, generated architecture — exactly the
  // combination nobody re-checks.
  const spec = buildStarterChamber('depth-1', 4242);
  const room = spec.rooms[0];
  const occ = new RoomOccupancy();
  occ.reserveAll(
    pilasterVolumes(describeWalls({ poly: STARTER_POLY, height: room.height }), room.height, 0),
    'pilaster',
  );
  for (const p of spec.props ?? []) {
    const x = (p as { x: number }).x, z = (p as { z: number }).z;
    const who = occ.blocker(cyl(x, z, 0.45, 0, 1.4));
    assert.equal(who, null,
      `${(p as { kind: string }).kind} at (${x}, ${z}) is standing inside a ${who}`);
  }
  for (const t of spec.torches ?? []) {
    // A sconce is ON the wall, and a pier stands proud OF the wall — so they
    // genuinely can collide, and a torch inside a column is a torch you can't see.
    const who = occ.blocker(cyl(t.x, t.z, 0.18, t.height - 0.3, t.height + 0.3));
    assert.equal(who, null, `a sconce at (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) is inside a ${who}`);
  }
  assert.ok(occ.list().length >= 2, 'the chamber has no piers to check against');
});

test('turning the dressing off leaves nothing reserved', () => {
  assert.deepEqual(pilasterVolumes(describeWalls({ poly: STARTER_POLY, height: 5.5 }), 5.5, 0, null), []);
  assert.ok(PILASTER.minWall > 0, 'the shipped spec should still be a real spec');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
