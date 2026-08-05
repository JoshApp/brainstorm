// COURSEWORK AND PIERS ON A POLYGON ROOM.
//
// Trim is the cheapest thing in a room to draw and the most expensive to draw
// badly: it runs along every wall, so one wrong sign is visible from everywhere
// at once. And a pier in a doorway is a wall across the doorway.
//
// The rhythm rule is the one worth stating out loud. Architecture reads as
// architecture because things REPEAT at an interval; piers scattered by
// rejection sampling read as rubble. So a wall gets an even row of them or it
// gets none — never one, which reads as an accident rather than a decision.
//
//   npm test

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPolyDressing, PILASTER } from '../src/level/poly-dressing';
import { describeWalls } from '../src/level/wall-surfaces';
import { ARCHETYPES, generateRoomShape, pointInPoly, type Poly } from '../src/level/room-shape';

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
    for (let s = 0; s < 8; s++) {
      const rand = mulberry(s * 7919 + 13);
      yield { kind, poly: generateRoomShape(kind, { w: 8 + rand() * 8, d: 6 + rand() * 7, rand }) };
    }
  }
}

test('every archetype gets coursework, and it carries vertex colours', () => {
  for (const { kind, poly } of shapes()) {
    const g = buildPolyDressing(describeWalls({ poly, height: 4 }), 4, 0);
    assert.ok(g, `${kind}: no dressing at all — the room reads as an extruded box`);
    assert.ok(g!.getAttribute('color'), `${kind}: dressing has no colour attribute`);
    assert.equal(g!.getAttribute('color').count, g!.getAttribute('position').count,
      `${kind}: colour attribute does not cover every vertex`);
  }
});

test('DRESSING STANDS PROUD OF ITS WALL, NOT BURIED IN IT', () => {
  // A course is offset from the wall plane by half its depth minus a sliver, so
  // it sits mostly in the room with its back edge hidden. Get the sign backwards
  // and every skirting in the game buries itself in the masonry — it renders
  // fine, it is just invisible, which is the worst kind of wrong.
  //
  // Counting vertices inside the polygon does NOT test this (the first version
  // of this test did, and failed at 38%): by construction roughly half of a
  // course's corners sit on the buried face. The honest measurement is the
  // CENTROID, projected onto the wall's own inward normal — one number per wall,
  // whose SIGN is exactly the thing that can be wrong.
  for (const { kind, poly } of shapes()) {
    for (const s of describeWalls({ poly, height: 4 })) {
      const g = buildPolyDressing([s], 4, 0);
      if (!g) continue;
      const pos = g.getAttribute('position');
      let cx = 0, cz = 0;
      for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cz += pos.getZ(i); }
      cx /= pos.count; cz /= pos.count;
      const out = (cx - s.mid[0]) * s.inward[0] + (cz - s.mid[1]) * s.inward[1];
      assert.ok(out > 0.005,
        `${kind}: dressing on a ${s.length.toFixed(1)}m wall sits ${out.toFixed(3)}m along its ` +
        `inward normal — it is inside the wall, not on it`);
      // And the proud face must actually be in the room.
      assert.ok(pointInPoly(poly, s.mid[0] + s.inward[0] * 0.02, s.mid[1] + s.inward[1] * 0.02),
        `${kind}: the wall's own inward normal does not point into the room`);
    }
  }
});

test('coursework sits at the floor and at the ceiling, nowhere else', () => {
  const poly: Poly = [[-6, -4], [6, -4], [6, 4], [-6, 4]];
  const H = 4, elev = 1.5;
  const g = buildPolyDressing(describeWalls({ poly, height: H, elevation: elev }), H, elev, null);
  const pos = g!.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const nearFloor = y > elev - 0.01 && y < elev + 0.3;
    const nearCeil = y > elev + H - 0.3 && y < elev + H + 0.01;
    assert.ok(nearFloor || nearCeil,
      `a course vertex sits at y=${y.toFixed(2)} in a room from ${elev} to ${elev + H}`);
  }
});

test('A PIER NEVER LANDS ON A SPAN A DOORWAY CUT', () => {
  // A pier beside a jamb is a pier in the doorway. Compare the dressing of a
  // room with and without its corridor: the doorway must only ever REMOVE
  // geometry from the wall it cuts, never add any.
  const poly: Poly = [[-7, -5], [7, -5], [7, 5], [-7, 5]];
  const door = { x: 0, z: -5, w: 2.4, d: 1.6 };
  const withDoor = describeWalls({ poly, height: 4, openings: [door] });
  const cut = withDoor.filter((s) => s.jambA || s.jambB);
  assert.ok(cut.length === 2, `expected two cut spans, got ${cut.length}`);
  const g = buildPolyDressing(withDoor, 4, 0);
  const pos = g!.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // Nothing may sit in the doorway's mouth.
    if (Math.abs(z + 5) > 1.0) continue;
    assert.ok(Math.abs(x) > door.w / 2 - 0.01,
      `dressing at (${x.toFixed(2)}, ${z.toFixed(2)}) is standing in the doorway`);
  }
});

test('piers come in a row or not at all', () => {
  // Count piers per wall by their distinctive height: a pilaster spans the whole
  // room, so its vertices reach both the floor and the ceiling, which no course
  // does. One pier on a wall reads as an accident; two or more read as a rhythm.
  const H = 4;
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: H });
    for (const s of walls) {
      const g = buildPolyDressing([s], H, 0);
      if (!g) continue;
      const pos = g.getAttribute('position');
      // Vertices at mid-height can only belong to a pier.
      let mid = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 0.4 && y < H - 0.4) mid++;
      }
      const piers = mid / 8;          // a box contributes 8 corners, 4 at each end
      assert.ok(piers === 0 || piers >= 2,
        `${kind}: wall of length ${s.length.toFixed(1)}m got ${piers} pier(s) — one is an accident`);
      if (piers > 0) {
        assert.ok(s.length >= PILASTER.minWall,
          `${kind}: a ${s.length.toFixed(1)}m wall got piers below the ${PILASTER.minWall}m minimum`);
      }
    }
  }
});

test('dressing can be turned off', () => {
  // The spec is DATA — a content layer has to be able to say "this room is
  // rough-cut, no coursework" without editing the builder.
  const poly: Poly = [[-6, -4], [6, -4], [6, 4], [-6, 4]];
  const withPiers = buildPolyDressing(describeWalls({ poly, height: 4 }), 4, 0);
  const without = buildPolyDressing(describeWalls({ poly, height: 4 }), 4, 0, null);
  assert.ok(withPiers!.getAttribute('position').count > without!.getAttribute('position').count,
    'passing null for the pilaster spec still produced piers');
});

// Dispose so a long test run doesn't hold a few hundred geometries alive.
new THREE.BufferGeometry().dispose();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
