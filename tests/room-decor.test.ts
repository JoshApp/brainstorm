// Room-decor grammars — the rules that make dynamic placement read as authored
// (docs/FLOOR-DIRECTOR.md). Locks: pillars are SYMMETRIC (mirror pairs), a
// blocked pair drops as a pair (never a lone pillar), small rooms get none, and
// the wall-adjacency affordance is correct.
//
//   npm test

import assert from 'node:assert/strict';
import { symmetricPillars, wallAdjacency } from '../src/level/room-decor';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
const never = () => false;   // nothing blocked
const rand = () => 0.5;

test('a room too small for a colonnade gets NO pillars', () => {
  assert.deepEqual(symmetricPillars(5, 5, 'standard', never, rand), []);
  assert.deepEqual(symmetricPillars(4, 10, 'dense', never, rand), []);
});

test('pillars come in even counts and are MIRROR-symmetric', () => {
  const W = 12, D = 10;
  const cells = symmetricPillars(W, D, 'dense', never, rand);
  assert.ok(cells.length >= 2 && cells.length % 2 === 0, `even count, got ${cells.length}`);
  // For every pillar there is a mirror partner across at least one room axis.
  const has = (col: number, row: number) => cells.some((c) => c.col === col && c.row === row);
  for (const c of cells) {
    const mirrorX = has(W - 1 - c.col, c.row);
    const mirrorZ = has(c.col, D - 1 - c.row);
    assert.ok(mirrorX || mirrorZ, `pillar ${c.col},${c.row} has no mirror`);
  }
});

test('pillars are INSET from the walls (they never hug the border)', () => {
  const cells = symmetricPillars(12, 10, 'dense', never, rand);
  for (const c of cells) {
    assert.ok(c.col > 0 && c.row > 0 && c.col < 11 && c.row < 9, `pillar ${c.col},${c.row} is on the border`);
  }
});

test('a blocked cell drops its WHOLE mirror pair (no lone pillar)', () => {
  const W = 12, D = 10, inset = 2;
  // Block one corner of the 4-corner hall; its L↔R partner must drop too.
  const blockedCol = inset, blockedRow = inset;
  const isBlocked = (c: number, r: number) => c === blockedCol && r === blockedRow;
  const cells = symmetricPillars(W, D, 'standard', isBlocked, rand);
  const topRow = cells.filter((c) => c.row === inset);
  assert.equal(topRow.length, 0, 'the top L↔R pair drops entirely when one side is blocked');
});

test('deterministic — same inputs → same pillars', () => {
  const a = symmetricPillars(14, 12, 'standard', never, rand);
  const b = symmetricPillars(14, 12, 'standard', never, rand);
  assert.deepEqual(a, b);
});

// ── wall-adjacency (the furniture affordance) ──
test('wallAdjacency: open interior 0, against a wall 1, corner 2', () => {
  // A 5x5 room, floor is the interior 3x3 (cols/rows 1..3), walls elsewhere.
  const isFloor = (c: number, r: number) => c >= 1 && c <= 3 && r >= 1 && r <= 3;
  assert.equal(wallAdjacency(2, 2, isFloor), 0, 'center is open');
  assert.equal(wallAdjacency(2, 1, isFloor), 1, 'top-middle touches one wall');
  assert.equal(wallAdjacency(1, 1, isFloor), 2, 'corner touches two walls');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
