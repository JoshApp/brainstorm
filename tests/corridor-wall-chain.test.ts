// A CORRIDOR'S WALLS, ONE COORDINATE ALONG EACH SIDE (level/wall-unwrap.ts linkChainU).
//
// A corridor is legs and landings, each its own rect, and each unwrapped its walls
// on its own ring, so the stone jumped where a leg's wall carried on into its
// landing's (Josh, 2026-11-24). The chain is measured along the whole path: a point
// on a straight join and a point either side of a turn must read as neighbours.

import assert from 'node:assert/strict';
import { linkChainU } from '../src/level/wall-unwrap';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${(e as Error).message}`); }
}

// An L: north along −z for 5m, then east 4m. Passage 2m wide (half 1).
const L = [
  { from: [0, 0] as const, to: [0, -5] as const },
  { from: [0, -5] as const, to: [4, -5] as const },
];
const u = linkChainU(L, 1);

test('a straight wall reads continuous metres along it', () => {
  // Right-hand wall of the first leg (travel −z, right is +x): x = +1.
  const a = u(1, -1), b = u(1, -2);
  assert.ok(Math.abs(Math.abs(b - a) - 1) < 1e-6, `1m apart reads ${Math.abs(b - a)}`);
});

test('the coordinate carries round the outside of the turn', () => {
  // Outer corner of the L is the left side: (−1, −6). A step either side of it,
  // one on each wall, must be 0.2m apart in U.
  const before = u(-1, -5.9), after = u(-0.9, -6);
  assert.ok(Math.abs(Math.abs(after - before) - 0.2) < 1e-6, `across the corner reads ${Math.abs(after - before)}`);
});

test('the inside of the turn carries round too', () => {
  // Inner corner: (1, −4).
  const before = u(1, -3.9), after = u(1.1, -4);
  assert.ok(Math.abs(Math.abs(after - before) - 0.2) < 1e-6, `across the corner reads ${Math.abs(after - before)}`);
});

test('U grows to your right as you face any wall, as the ring does', () => {
  // The +x wall faces −x: facing it you look along +x, and your right is +z.
  assert.ok(u(1, -1) > u(1, -2), '+x wall should grow toward +z');
  // The −x wall faces +x: your right is −z.
  assert.ok(u(-1, -2) > u(-1, -1), '−x wall should grow toward −z');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
