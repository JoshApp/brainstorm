// TEACHING THE EXISTING DUNGEON TO STOP BEING BOXES.
//
// This pass runs on EVERY room of EVERY floor, and it changes geometry under
// content that was placed against a rectangle. The risk isn't that it looks
// wrong — it's that it quietly puts a chest, a sconce or a stair inside stone,
// or seals a corridor mouth and strands half a floor.
//
// So the tests are about what must NOT change, measured on real generated
// floors rather than on a fixture.
//
//   npm test

import assert from 'node:assert/strict';
import { polygoniseRooms } from '../src/level/polygonise';
import { generateFloor } from '../src/level/procgen';
import { pointInPoly } from '../src/level/room-shape';
import type { LevelSpec, RoomSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function floors(n = 8): LevelSpec[] {
  const out: LevelSpec[] = [];
  for (let depth = 1; depth <= n; depth++) {
    for (let i = 0; i < 4; i++) out.push(generateFloor(depth, 4200 + i * 7919 + depth));
  }
  return out;
}

const shaped = (spec: LevelSpec) => spec.rooms.filter((r) => r.poly && r.poly.length >= 3);
const inRect = (r: RoomSpec, x: number, z: number) =>
  Math.abs(x - r.rect.x) <= r.rect.w / 2 + 0.01 && Math.abs(z - r.rect.z) <= r.rect.d / 2 + 0.01;

test('the pass actually converts rooms', () => {
  // The gate rejected 100% of rooms through three separate wrong versions, and
  // each time it looked exactly like a dungeon with nothing to convert. A pass
  // that silently does nothing is the failure mode this asserts against.
  let converted = 0, total = 0;
  for (const spec of floors()) {
    const r = polygoniseRooms(spec);
    converted += r.converted; total += r.converted + r.skipped;
  }
  assert.ok(converted > 0, 'polygoniseRooms converted NOTHING across every sampled floor');
  assert.ok(converted / total > 0.05,
    `only ${((converted / total) * 100).toFixed(1)}% of rooms shaped — the gate has closed again`);
});

test('THE BOUNDING BOX NEVER MOVES', () => {
  // Everything outside this module still reasons in rects — elevation, the nav
  // bbox, the walkable union, room-culling. A polygon that escaped its rect
  // would desync all of them at once.
  for (const spec of floors()) {
    polygoniseRooms(spec);
    for (const room of shaped(spec)) {
      for (const [x, z] of room.poly!) {
        assert.ok(inRect(room, x, z),
          `${room.id}: a polygon vertex at (${x.toFixed(2)}, ${z.toFixed(2)}) is outside the room's rect`);
      }
    }
  }
});

test('NOTHING ALREADY PLACED ENDS UP IN STONE', () => {
  for (const spec of floors()) {
    polygoniseRooms(spec);
    for (const room of shaped(spec)) {
      const poly = room.poly!;
      for (const p of spec.props ?? []) {
        const x = (p as { x?: number }).x, z = (p as { z?: number }).z;
        if (typeof x !== 'number' || typeof z !== 'number' || !inRect(room, x, z)) continue;
        assert.ok(pointInPoly(poly, x, z),
          `${room.id}: ${(p as { kind: string }).kind} at (${x.toFixed(2)}, ${z.toFixed(2)}) is inside the wall`);
      }
      for (const t of spec.torches ?? []) {
        if (!inRect(room, t.x, t.z)) continue;
        assert.ok(pointInPoly(poly, t.x, t.z), `${room.id}: a sconce was cut out of the room`);
      }
      for (const s of spec.spawns ?? []) {
        if (!inRect(room, s.x, s.z)) continue;
        assert.ok(pointInPoly(poly, s.x, s.z), `${room.id}: a spawn point is inside the wall`);
      }
    }
  }
});

test('A STAIR\'S WHOLE BODY STAYS IN THE ROOM', () => {
  // A stair descends INTO its wall over ~2.6m. Only its head is visible, so a
  // body buried in masonry is invisible until somebody takes it.
  for (const spec of floors()) {
    polygoniseRooms(spec);
    for (const room of shaped(spec)) {
      for (const st of spec.stairs ?? []) {
        if (!inRect(room, st.x, st.z)) continue;
        const dx = Math.sin(st.rotY ?? 0), dz = Math.cos(st.rotY ?? 0);
        for (let t = 0; t <= 2.6; t += 0.2) {
          assert.ok(pointInPoly(room.poly!, st.x + dx * t, st.z + dz * t),
            `${room.id}: stair '${st.id}' leaves the room ${t.toFixed(1)}m into its descent`);
        }
      }
    }
  }
});

test('every doorway still has a wall to cut', () => {
  // The one failure here that isn't cosmetic: a chamfer that swallowed a
  // corridor mouth seals the room and strands whatever is past it.
  for (const spec of floors()) {
    polygoniseRooms(spec);
    for (const room of shaped(spec)) {
      for (const c of spec.corridors ?? []) {
        const near = Math.abs(room.rect.x - c.rect.x) <= (room.rect.w + c.rect.w) / 2 + 0.5
                  && Math.abs(room.rect.z - c.rect.z) <= (room.rect.d + c.rect.d) / 2 + 0.5;
        if (!near) continue;
        // Some vertex of the outline must be within reach of the mouth, or the
        // corridor meets a corner that no longer exists.
        const reach = Math.max(c.rect.w, c.rect.d) / 2 + 2.0;
        const touches = room.poly!.some(([x, z]) => Math.hypot(x - c.rect.x, z - c.rect.z) < reach + Math.max(room.rect.w, room.rect.d) / 2);
        assert.ok(touches, `${room.id}: a corridor mouth has no outline near it`);
      }
    }
  }
});

test('running it twice changes nothing', () => {
  // buildLevel can rebuild a spec (descend, resume, a scenario reload). A pass
  // that re-chamfered an already-chamfered room would shave the corners again
  // every time, and the room would slowly become an octagon then a circle.
  for (const spec of floors(4)) {
    const first = polygoniseRooms(spec);
    const before = shaped(spec).map((r) => JSON.stringify(r.poly));
    const second = polygoniseRooms(spec);
    assert.equal(second.converted, 0, 'the second pass converted rooms it had already shaped');
    assert.deepEqual(shaped(spec).map((r) => JSON.stringify(r.poly)), before,
      'a second pass changed the polygons');
    assert.ok(first.converted >= 0);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
