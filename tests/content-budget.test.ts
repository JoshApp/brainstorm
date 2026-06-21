// The per-floor content budget (procgen v3). These lock in the load-bearing
// guarantees: a floor is NEVER empty (the bug this system exists to kill),
// combat scales with depth, intensity bands by depth, and the whole thing is
// deterministic given a seeded rand.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import { combatCount, combatIntensity, floorContentBudget } from '../src/level/content-budget';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// A tiny seeded LCG so tests don't depend on Math.random (and to mirror how the
// real pass feeds a seeded stream).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  const step = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  // Warm up — a plain LCG's FIRST output is near-linear in the seed, so small
  // consecutive seeds cluster (a real weakness, not a budget bug). A few steps
  // decorrelate the stream the way the floor-seed hash does in production.
  step(); step(); step();
  return step;
}

const B = CONFIG.CONTENT_BUDGET;

test('a floor is NEVER empty — count >= COMBAT_MIN across depths and seeds', () => {
  for (let depth = 1; depth <= 20; depth++) {
    for (let seed = 0; seed < 50; seed++) {
      const n = combatCount(depth, lcg(seed * 7 + depth));
      assert.ok(n >= B.COMBAT_MIN, `depth ${depth} seed ${seed} → ${n} < MIN ${B.COMBAT_MIN}`);
      assert.ok(n >= 1, 'and certainly never zero');
    }
  }
});

test('count is capped at COMBAT_MAX even very deep', () => {
  for (let seed = 0; seed < 50; seed++) {
    const n = combatCount(99, lcg(seed));
    assert.ok(n <= B.COMBAT_MAX, `depth 99 seed ${seed} → ${n} > MAX ${B.COMBAT_MAX}`);
  }
});

test('combat scales up with depth (deep floors are tougher on average)', () => {
  const avg = (depth: number) => {
    let sum = 0;
    const N = 400;
    for (let i = 0; i < N; i++) sum += combatCount(depth, lcg(i * 13 + 1));
    return sum / N;
  };
  assert.ok(avg(10) > avg(2), `avg@10 (${avg(10)}) should exceed avg@2 (${avg(2)})`);
});

test('intensity bands by depth', () => {
  // Shallow is always light regardless of roll.
  for (let seed = 0; seed < 20; seed++) {
    assert.equal(combatIntensity(1, lcg(seed)), 'light');
    assert.equal(combatIntensity(B.INTENSITY_MEDIUM_DEPTH - 1, lcg(seed)), 'light');
  }
  // Mid band is never light, never heavy.
  for (let seed = 0; seed < 20; seed++) {
    const i = combatIntensity(B.INTENSITY_MEDIUM_DEPTH, lcg(seed));
    assert.equal(i, 'medium');
  }
  // Deep band yields some heavy and some medium across seeds.
  const deep = new Set<string>();
  for (let seed = 0; seed < 200; seed++) deep.add(combatIntensity(B.INTENSITY_HEAVY_DEPTH, lcg(seed)));
  assert.ok(deep.has('heavy'), 'deep floors can roll heavy');
  assert.ok(deep.has('medium'), 'deep floors can still roll medium');
  assert.ok(!deep.has('light'), 'deep floors are never light');
});

test('deterministic — same depth + seed → identical budget', () => {
  const a = floorContentBudget(6, lcg(12345));
  const b = floorContentBudget(6, lcg(12345));
  assert.deepEqual(a, b);
});

test('floorContentBudget shape', () => {
  const budget = floorContentBudget(5, lcg(1));
  assert.equal(typeof budget.combat.count, 'number');
  assert.ok(['light', 'medium', 'heavy'].includes(budget.combat.intensity));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
