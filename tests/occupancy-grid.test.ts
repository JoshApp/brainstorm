// Occupancy grid + the v3 open-cell enumerator. enumerateOpenCells is the
// foundation of the v3 floor-content system: it answers "which cells in this
// room can an enemy stand on" by intersecting the tilemap's floor predicate
// with the occupancy grid's reservations. These lock in that contract —
// floor-only, reservation-aware, safe-zone-aware, deterministic order.
//
//   npm test

import assert from 'node:assert/strict';
import { OccupancyGrid, enumerateOpenCells } from '../src/level/occupancy-grid';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// A 4×3 region (cols 0..3, rows 0..2) that's all floor unless a test says
// otherwise. Region helper so the bounds read clearly.
const REGION = { col0: 0, row0: 0, cols: 4, rows: 3 };
const allFloor = () => true;
const keyset = (cells: { col: number; row: number }[]) =>
  new Set(cells.map((c) => `${c.col},${c.row}`));

test('all-floor region with empty grid → every cell is open', () => {
  const occ = new OccupancyGrid();
  const open = enumerateOpenCells(REGION, allFloor, occ);
  assert.equal(open.length, 12, '4×3 = 12 cells');
});

test('walls (isFloor false) are never open', () => {
  const occ = new OccupancyGrid();
  // Only the middle row is floor.
  const isFloor = (_c: number, r: number) => r === 1;
  const open = enumerateOpenCells(REGION, isFloor, occ);
  assert.equal(open.length, 4, 'one floor row of 4 cells');
  assert.ok(open.every((c) => c.row === 1));
});

test('floor-layer reservations (props/spawns) are excluded', () => {
  const occ = new OccupancyGrid();
  occ.reserve(1, 1, 'floor', 'feature');
  occ.reserve(2, 1, 'floor', 'spawn');
  const open = enumerateOpenCells(REGION, allFloor, occ);
  const ks = keyset(open);
  assert.ok(!ks.has('1,1') && !ks.has('2,1'), 'reserved floor cells are gone');
  assert.equal(open.length, 10);
});

test('void (chasm) cells are excluded by default', () => {
  const occ = new OccupancyGrid();
  occ.reserve(0, 0, 'void', 'void');
  const open = enumerateOpenCells(REGION, allFloor, occ);
  assert.ok(!keyset(open).has('0,0'), 'cannot stand over a carved chasm');
});

test('wall-layer reservations (torches) do NOT block standing', () => {
  const occ = new OccupancyGrid();
  occ.reserve(0, 0, 'wall', 'torch');
  const open = enumerateOpenCells(REGION, allFloor, occ);
  assert.ok(keyset(open).has('0,0'), 'a wall torch leaves the floor cell walkable');
});

test('exclude set (safe-zones) removes cells', () => {
  const occ = new OccupancyGrid();
  const exclude = new Set(['0,0', '3,2']);
  const open = enumerateOpenCells(REGION, allFloor, occ, { exclude });
  const ks = keyset(open);
  assert.ok(!ks.has('0,0') && !ks.has('3,2'));
  assert.equal(open.length, 10);
});

test('reserveWithApproach blocks a feature + its 4 neighbours', () => {
  const occ = new OccupancyGrid();
  occ.reserveWithApproach(2, 1, 'floor', 'feature');  // center + N/S/E/W
  const open = enumerateOpenCells(REGION, allFloor, occ);
  const ks = keyset(open);
  for (const k of ['2,1', '1,1', '3,1', '2,0', '2,2']) {
    assert.ok(!ks.has(k), `${k} blocked by approach reservation`);
  }
  assert.equal(open.length, 12 - 5);
});

test('custom blockLayers can ignore void', () => {
  const occ = new OccupancyGrid();
  occ.reserve(0, 0, 'void', 'void');
  const open = enumerateOpenCells(REGION, allFloor, occ, { blockLayers: ['floor'] });
  assert.ok(keyset(open).has('0,0'), 'void ignored when not in blockLayers');
});

test('enumeration order is deterministic (row-major)', () => {
  const occ = new OccupancyGrid();
  const open = enumerateOpenCells(REGION, allFloor, occ);
  assert.deepEqual(open[0], { col: 0, row: 0 });
  assert.deepEqual(open[1], { col: 1, row: 0 });
  assert.deepEqual(open[4], { col: 0, row: 1 }, 'wraps to next row');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
