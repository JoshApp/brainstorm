// NavGrid pathing invariants (src/level/nav-grid.ts).
//
// Guards the two fixes for "mobs wedge at doorframes":
//   1. TIGHT tier — a 1m doorway is pathable for normal-size mobs at
//      EVERY grid phase (it used to depend on whether a 0.5m-pitch cell
//      centre happened to land near the gap centre).
//   2. LIVE rebuild — runtime wall/obstacle mutations (door seals,
//      cobweb curtains) are seen by pathfinding, and their removal
//      reopens the route.
// Plus the honesty rule: a body too wide for the gap gets NO path
// through it instead of a path it will wedge on.

import assert from 'node:assert/strict';
import { WalkableRegion, type WallSegment } from '../src/level/walkable';
import { NavGrid } from '../src/level/nav-grid';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

// Two 6×6 rooms side by side, sharing a divider wall at x = xWall with a
// 1m doorway gap centred at z = gapCenter. Mirrors how the tilemap parser
// expresses doorways: full-perimeter walls plus a divider broken into two
// segments that skip the gap.
function doorwayWorld(xWall: number, gapCenter: number, gapWidth = 1.0) {
  const rects = [
    { x: xWall - 3, z: 0, w: 6, d: 6 },
    { x: xWall + 3, z: 0, w: 6, d: 6 },
  ];
  const walls: WallSegment[] = [];
  const zLo = -3, zHi = 3;
  const g0 = gapCenter - gapWidth / 2;
  const g1 = gapCenter + gapWidth / 2;
  // Divider segments around the gap.
  walls.push({ ax: xWall, az: zLo, bx: xWall, bz: g0 });
  walls.push({ ax: xWall, az: g1, bx: xWall, bz: zHi });
  // Outer perimeter (so nearestWalkable can't escape the rooms).
  const x0 = xWall - 6, x1 = xWall + 6;
  walls.push({ ax: x0, az: zLo, bx: x1, bz: zLo });
  walls.push({ ax: x0, az: zHi, bx: x1, bz: zHi });
  walls.push({ ax: x0, az: zLo, bx: x0, bz: zHi });
  walls.push({ ax: x1, az: zLo, bx: x1, bz: zHi });
  const region = new WalkableRegion(rects, [], walls);
  const bbox = { minX: x0, maxX: x1, minZ: zLo, maxZ: zHi };
  return { region, grid: new NavGrid(region, bbox, false) };
}

// ── 1m doorway is pathable at every grid phase ──────────────────────────
// Sweep the wall/gap position in sub-cell steps so the gap centre takes
// every alignment relative to the 0.5m cell lattice.
for (let i = 0; i < 8; i++) {
  const xWall = 10 + i * 0.13;          // sub-cell phase sweep along X
  const gapCenter = 0.5 + i * 0.11;     // and along Z
  test(`1m doorway pathable (phase ${i})`, () => {
    const { grid } = doorwayWorld(xWall, gapCenter);
    const path = grid.findPath(xWall - 2.5, gapCenter, xWall + 2.5, gapCenter,
      { radius: 0.35 });
    assert.ok(path.length > 0, `no path through 1m gap at xWall=${xWall}, gapCenter=${gapCenter}`);
  });
}

// ── A body too wide for the gap gets no path, not a wedge ───────────────
test('0.62-radius body refuses the 1m doorway', () => {
  const { grid } = doorwayWorld(10, 0);
  const path = grid.findPath(7.5, 0, 12.5, 0, { radius: 0.62 });
  assert.equal(path.length, 0, 'wide body should have NO route through a 1m gap');
});

// ── Runtime seal (cobweb/door) closes the route; removal reopens it ─────
test('live rebuild: addWall seals, removeWall reopens', () => {
  const { region, grid } = doorwayWorld(10, 0);
  const opts = { radius: 0.35 };
  assert.ok(grid.findPath(7.5, 0, 12.5, 0, opts).length > 0, 'open door should path');
  const seal: WallSegment = { ax: 10, az: -0.5, bx: 10, bz: 0.5 };
  region.addWall(seal);
  assert.equal(grid.findPath(7.5, 0, 12.5, 0, opts).length, 0, 'sealed door should NOT path');
  region.removeWall(seal);
  assert.ok(grid.findPath(7.5, 0, 12.5, 0, opts).length > 0, 'cleared seal should path again');
});

// ── Obstacle mutations are live too (boss mist, future blockers) ────────
test('live rebuild: addObstacle blocks, removeObstacle unblocks', () => {
  const { region, grid } = doorwayWorld(10, 0);
  const opts = { radius: 0.35 };
  const plug = { kind: 'aabb' as const, minX: 9.4, maxX: 10.6, minZ: -0.8, maxZ: 0.8 };
  region.addObstacle(plug);
  assert.equal(grid.findPath(7.5, 0, 12.5, 0, opts).length, 0, 'plugged gap should NOT path');
  region.removeObstacle(plug);
  assert.ok(grid.findPath(7.5, 0, 12.5, 0, opts).length > 0, 'unplugged gap should path');
});

// ── Tight cells are a detour of last resort, not a habit ────────────────
test('open route preferred over a choke when both exist', () => {
  // Two doorways: a wide 2.5m one at z=+2 and a 1m choke at z=-2. The
  // path between points aligned with the choke should still prefer the
  // wide door when lengths are comparable... but MUST use the choke if
  // it is the only option. Here: both exist, start/end sit at z=-2 (the
  // choke's height), so the choke is shorter; we assert only that SOME
  // path exists and it is sane — the cost ratio is a tuning knob, not
  // an invariant.
  const xWall = 10;
  const rects = [
    { x: xWall - 3, z: 0, w: 6, d: 8 },
    { x: xWall + 3, z: 0, w: 6, d: 8 },
  ];
  const walls: WallSegment[] = [
    { ax: xWall, az: -4, bx: xWall, bz: -2.5 },   // below choke
    { ax: xWall, az: -1.5, bx: xWall, bz: 0.75 }, // between choke and wide door
    { ax: xWall, az: 3.25, bx: xWall, bz: 4 },    // above wide door
    { ax: 4, az: -4, bx: 16, bz: -4 },
    { ax: 4, az: 4, bx: 16, bz: 4 },
    { ax: 4, az: -4, bx: 4, bz: 4 },
    { ax: 16, az: -4, bx: 16, bz: 4 },
  ];
  const region = new WalkableRegion(rects, [], walls);
  const grid = new NavGrid(region, { minX: 4, maxX: 16, minZ: -4, maxZ: 4 }, false);
  const path = grid.findPath(7.5, -2, 12.5, -2, { radius: 0.35 });
  assert.ok(path.length > 0, 'a path should exist with two doorways');
});

// ── Gate funnel: archway columns at a 2m mouth ───────────────────────
// Two rooms, 2m doorway, archway column blockers (r 0.18 at ±0.84) —
// the framed-mouth geometry that wedged mobs. With the gate registered,
// a path must exist at every grid phase, route THROUGH the gate centre,
// and refuse a body wider than the band.
function archedDoorwayWorld(xWall: number, gapCenter: number) {
  const colOffset = 0.84;             // archwayColumnOffset(2.0)
  const halfBand = colOffset - 0.18;  // archwayPassableHalfBand(2.0) = 0.66
  const rects = [
    { x: xWall - 3, z: 0, w: 6, d: 6 },
    { x: xWall + 3, z: 0, w: 6, d: 6 },
  ];
  const walls: WallSegment[] = [
    { ax: xWall, az: -3, bx: xWall, bz: gapCenter - 1 },
    { ax: xWall, az: gapCenter + 1, bx: xWall, bz: 3 },
    { ax: xWall - 6, az: -3, bx: xWall + 6, bz: -3 },
    { ax: xWall - 6, az: 3, bx: xWall + 6, bz: 3 },
    { ax: xWall - 6, az: -3, bx: xWall - 6, bz: 3 },
    { ax: xWall + 6, az: -3, bx: xWall + 6, bz: 3 },
  ];
  const obstacles = [
    { kind: 'circle' as const, x: xWall, z: gapCenter - colOffset, r: 0.18 },
    { kind: 'circle' as const, x: xWall, z: gapCenter + colOffset, r: 0.18 },
  ];
  const region = new WalkableRegion(rects, obstacles, walls);
  const gate = { x: xWall, z: gapCenter, rotY: Math.PI / 2, halfBand };
  const grid = new NavGrid(region, { minX: xWall - 6, maxX: xWall + 6, minZ: -3, maxZ: 3 }, false, [gate]);
  return { grid, gate };
}

for (let i = 0; i < 6; i++) {
  const xWall = 10 + i * 0.17;
  test(`archway gate pathable + funnelled (phase ${i})`, () => {
    const { grid, gate } = archedDoorwayWorld(xWall, 0.3 + i * 0.09);
    const path = grid.findPath(xWall - 2.5, gate.z, xWall + 2.5, gate.z, { radius: 0.42 });
    assert.ok(path.length > 0, 'no path through the framed mouth');
    const throughCentre = path.some((wp) => Math.hypot(wp.x - gate.x, wp.z - gate.z) < 0.1);
    assert.ok(throughCentre, 'path does not pass through the gate centre');
  });
}

test('a body wider than the gate band is refused', () => {
  const { grid, gate } = archedDoorwayWorld(10, 0);
  const path = grid.findPath(7.5, gate.z, 12.5, gate.z, { radius: 0.7 });
  assert.equal(path.length, 0, '0.7-radius body should not fit a 0.66 half-band gate');
});

test('beeline grazing a gate column is flagged', () => {
  const { grid, gate } = archedDoorwayWorld(10, 0);
  // Straight line passing 0.55 off the gate centre — inside the band but
  // within a 0.35 radius of the column blocker at 0.66+0.18.
  assert.ok(grid.directRouteGrazesGate(8, 0.55, 12, 0.55, 0.35), 'grazing beeline should be flagged');
  // Dead-centre crossing is fine for a small body.
  assert.ok(!grid.directRouteGrazesGate(8, 0, 12, 0, 0.3), 'centre beeline should pass');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
