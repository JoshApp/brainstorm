// THE STARTER CHAMBER IS A POLYGON NOW — pin the fit.
//
// This is the first room in the game whose walls come from the shape grammar
// (level/room-shape.ts) rather than from a rect, and it is the one room EVERY
// fresh run opens in. The failure mode is specific and silent: change a chamfer
// fraction or an alcove depth in the grammar, and the apse quietly moves a wall
// through an altar — the room still builds, still renders, and the player
// spawns into a chamber where one of the three weapons is inside the masonry.
//
// So this test does not check the polygon's taste. It checks that the REAL
// polygon the chamber ships contains the REAL positions the chamber places, by
// importing both — per docs/DESIGN-METHOD.md, an audit that re-states the
// numbers is a guess wearing a measurement's clothes.
//
//   npm test

import assert from 'node:assert/strict';
import { buildStarterChamber, STARTER_POLY } from '../src/level/starter-chamber';
import { pointInPoly, polyArea, polyBounds } from '../src/level/room-shape';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** How far the stair body extends from its top along the descent direction.
 *  Mirrors STAIRWELL_TOTAL_DEPTH; the chamber's comment budgets ~2.56m. */
const STAIR_BODY_DEPTH = 2.6;
/** Clearance every walkable/standable point needs from the outline, so nothing
 *  is merely technically-inside with its geometry clipping the wall. */
const MARGIN = 0.35;

/** Is (x,z) inside the polygon with `pad` metres to spare in every direction? */
function insideWithMargin(x: number, z: number, pad: number): boolean {
  if (!pointInPoly(STARTER_POLY, x, z)) return false;
  for (let a = 0; a < Math.PI * 2 - 1e-6; a += Math.PI / 8) {
    if (!pointInPoly(STARTER_POLY, x + Math.cos(a) * pad, z + Math.sin(a) * pad)) return false;
  }
  return true;
}

const spec = buildStarterChamber('depth-1', 12345);
const room = spec.rooms[0];

test('the chamber ships a polygon, and its rect is that polygon\'s bounding box', () => {
  assert.ok(room.poly && room.poly.length >= 3, 'the starter chamber lost its polygon');
  const b = polyBounds(STARTER_POLY);
  assert.equal(room.rect.w, b.maxX - b.minX, 'rect width is not the polygon bbox width');
  assert.equal(room.rect.d, b.maxZ - b.minZ, 'rect depth is not the polygon bbox depth');
  assert.equal(room.rect.x, (b.minX + b.maxX) / 2, 'rect is not centred on the polygon');
  assert.equal(room.rect.z, (b.minZ + b.maxZ) / 2, 'rect is not centred on the polygon');
});

test('the room is still a room — not a slice the grammar shaved to nothing', () => {
  assert.ok(polyArea(STARTER_POLY) > 70,
    `starter chamber is only ${polyArea(STARTER_POLY).toFixed(0)}m² — the apse ate the nave`);
  assert.ok(room.height >= 3.5 && room.height <= 7.5,
    `ceiling ${room.height}m is outside anything a 2m sconce can light`);
});

test('THE PLAYER SPAWNS INSIDE THE ROOM', () => {
  const s = spec.startPos!;
  assert.ok(insideWithMargin(s.x, s.z, 0.5),
    `spawn (${s.x}, ${s.z}) is not clear of the walls — the run begins inside masonry`);
});

test('every prop the chamber places stands inside the outline', () => {
  for (const p of spec.props ?? []) {
    const x = (p as { x: number }).x, z = (p as { z: number }).z;
    assert.ok(insideWithMargin(x, z, MARGIN),
      `${(p as { kind: string }).kind} at (${x}, ${z}) is outside the polygon`);
  }
});

test('every sconce sits ON a wall, not floating in the room or buried behind one', () => {
  // A torch is mounted flush to its wall plane, so it must be just INSIDE the
  // outline and NOT inside once pushed a little further out — that's what
  // distinguishes "on the wall" from "standing in the middle of the floor".
  for (const t of spec.torches ?? []) {
    assert.ok(pointInPoly(STARTER_POLY, t.x, t.z),
      `sconce at (${t.x}, ${t.z}) is outside the room — it would hang in the void`);
    const out: Record<string, [number, number]> = {
      N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0],
    };
    const [ox, oz] = out[t.wall];
    assert.ok(!pointInPoly(STARTER_POLY, t.x + ox * 0.35, t.z + oz * 0.35),
      `sconce at (${t.x}, ${t.z}) facing ${t.wall} has open floor behind it — it is not on a wall`);
  }
});

test('THE STAIR BODY CLEARS THE APSE', () => {
  // The stair descends INTO the wall over ~2.56m. The apse narrows behind the
  // altars, which is exactly where the stair lives — so this is the constraint
  // most likely to break when the shape changes.
  for (const st of spec.stairs ?? []) {
    const dirX = Math.sin(st.rotY ?? 0), dirZ = Math.cos(st.rotY ?? 0);
    for (let t = 0; t <= STAIR_BODY_DEPTH; t += 0.2) {
      const x = st.x + dirX * t, z = st.z + dirZ * t;
      assert.ok(pointInPoly(STARTER_POLY, x, z),
        `stair '${st.id}' body leaves the room ${t.toFixed(1)}m in, at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
});

test('the shape is stable across builds', () => {
  // Every other room in the game is seeded per run. This one must NOT be — the
  // first thing a player ever sees should be the same place every time.
  const again = buildStarterChamber('depth-1', 999);
  assert.deepEqual(again.rooms[0].poly, room.poly,
    'the starter chamber changed shape with the weapon roll');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
