// Half-heart HP math: each heart = 2 HP, 1 HP = a half (0.5) heart, damage
// wipes from the right. Locks the conversion so a future tweak can't silently
// turn hearts back into 1-HP-each or break the half state.
//
//   npm test

import assert from 'node:assert/strict';
import { heartFillFractions, heartCount, HEART_HP } from '../src/ui/heart-fill';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('each heart is worth 2 HP', () => {
  assert.equal(HEART_HP, 2);
  assert.equal(heartCount(8), 4);
  assert.equal(heartCount(6), 3);
  assert.equal(heartCount(1), 1);   // never zero hearts
});

test('1 HP into a heart shows a half heart; full at 2', () => {
  assert.deepEqual(heartFillFractions(8, 4), [1, 1, 1, 1]);     // full
  assert.deepEqual(heartFillFractions(7, 4), [1, 1, 1, 0.5]);   // last heart half
  assert.deepEqual(heartFillFractions(3, 4), [1, 0.5, 0, 0]);   // 1.5 hearts
  assert.deepEqual(heartFillFractions(1, 4), [0.5, 0, 0, 0]);   // a single half heart
  assert.deepEqual(heartFillFractions(0, 4), [0, 0, 0, 0]);     // empty
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
