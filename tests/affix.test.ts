// Affix rolling (src/content/affixes.ts) — seeded determinism + roll bounds.

import assert from 'node:assert/strict';
import { rollAffixes } from '../src/content/affixes';
import { seedRng } from '../src/engine/rng';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const POOL = ['keening', 'gallows', 'spine', 'cinder'];

test('empty pool / non-positive count yields no affixes', () => {
  assert.deepEqual(rollAffixes(undefined, 2), []);
  assert.deepEqual(rollAffixes([], 2), []);
  assert.deepEqual(rollAffixes(POOL, 0), []);
});

test('same seed produces identical rolls', () => {
  seedRng(4242);
  const a = JSON.stringify(rollAffixes(POOL, 2));
  seedRng(4242);
  const b = JSON.stringify(rollAffixes(POOL, 2));
  assert.equal(a, b);
});

test('respects maxCount and never repeats an affix', () => {
  seedRng(1);
  const rolled = rollAffixes(POOL, 2);
  assert.ok(rolled.length <= 2);
  const ids = rolled.map((r) => r.affixId);
  assert.equal(new Set(ids).size, ids.length);
});

test('rolled amounts stay within each affix declared range', () => {
  // gallows: damage-multiplier 1.05..1.15. Roll it many times across seeds.
  for (let s = 0; s < 50; s++) {
    seedRng(s);
    for (const inst of rollAffixes(['gallows'], 1)) {
      for (const m of inst.modifiers) {
        assert.ok(m.amount >= 1.05 && m.amount <= 1.15, `out of range: ${m.amount}`);
      }
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
