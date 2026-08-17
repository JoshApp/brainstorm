// The per-floor content budget (procgen v3). These lock in the load-bearing
// guarantees: a floor is NEVER empty (the bug this system exists to kill), combat
// scales with depth, the ceiling holds, and the whole thing is deterministic given
// a seeded rand.
//
// ── THE COMBAT CLAIMS ARE MEASURED ON THE GENERATOR NOW ──────────────────────
//
// They used to be measured on `combatCount`, a depth-only formula in
// content-budget.ts. It passed every one of them and was READ BY NOBODY — the
// density the player met came from a per-room area rule, and a repair pass patched
// the minimum on the finished floor. So these tests were green while the thing they
// claimed to protect was decided somewhere else entirely, which is worse than
// having no test: it certified a number that never reached the game.
//
// `allocateCombat` in poly-floor.ts now owns the number, and the claims are checked
// where they are true or not — on the live enemies of generated floors.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import { floorContentBudget, floorEvents } from '../src/level/content-budget';
import { generatePolyFloor } from '../src/level/poly-floor';

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

/** Live (non-dormant) enemies on real generated floors. A dormant spawn is a boss
 *  behind a fog gate or a sleeping ambusher — the floor's fight is what stands up. */
function liveCounts(depth: number, n = 40): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    try {
      const spec = generatePolyFloor(depth, 5000 + i * 7919) as unknown as
        { spawns?: Array<{ dormant?: boolean }> };
      out.push((spec.spawns ?? []).filter((x) => !x.dormant).length);
    } catch { /* a floor that fails its own soundness checks rerolls in play */ }
  }
  return out;
}

test('a floor is NEVER empty — live enemies >= COMBAT_MIN at every depth', () => {
  // THE BUG THIS SYSTEM EXISTS TO KILL. Shallow floors could roll a walk with no
  // fight in it. Asserted on the floor the player actually gets.
  for (const depth of [1, 2, 3, 6, 9]) {
    const counts = liveCounts(depth);
    assert.ok(counts.length > 30, `only ${counts.length} floors generated at d${depth}`);
    const min = Math.min(...counts);
    assert.ok(min >= B.COMBAT_MIN,
      `depth ${depth}: a floor shipped with ${min} live enemies, under COMBAT_MIN ${B.COMBAT_MIN}`);
  }
});

test('the ceiling holds — no floor becomes soup', () => {
  // COMBAT_MAX was exceeded by 44% at depth 9 (23 enemies against a cap of 16) for
  // as long as nothing summed the rooms, and no test noticed because the test was
  // reading a formula instead of a floor.
  for (const depth of [6, 9, 14]) {
    const counts = liveCounts(depth);
    const max = Math.max(...counts);
    assert.ok(max <= B.COMBAT_MAX,
      `depth ${depth}: a floor shipped with ${max} live enemies, over COMBAT_MAX ${B.COMBAT_MAX}`);
  }
});

test('combat scales up with depth (deep floors are tougher on average)', () => {
  const mean = (xs: number[]) => xs.reduce((m, n) => m + n, 0) / xs.length;
  const shallow = mean(liveCounts(1));
  const mid = mean(liveCounts(6));
  assert.ok(mid > shallow + 2,
    `depth 6 averages ${mid.toFixed(1)} live enemies against depth 1's ${shallow.toFixed(1)} `
    + '— a descent that does not get heavier');
});

test('deterministic — same depth + seed → identical budget', () => {
  const a = floorContentBudget(6, lcg(12345));
  const b = floorContentBudget(6, lcg(12345));
  assert.deepEqual(a, b);
});

test('floorContentBudget shape', () => {
  const budget = floorContentBudget(5, lcg(1));
  assert.equal(typeof budget.events.minorFire, 'boolean');
  assert.equal(typeof budget.events.question, 'boolean');
  assert.equal(typeof budget.loot.definingFind, 'boolean');
  // And no `combat` — the floor's fight is allocated in poly-floor.ts, and a field
  // here would be a second opinion about it. See this file's header.
  assert.ok(!('combat' in budget), 'the combat budget grew back');
});

test('minor fire is a chance, not a guarantee (both outcomes occur)', () => {
  const seen = new Set<boolean>();
  for (let seed = 0; seed < 200; seed++) seen.add(floorEvents(4, lcg(seed)).minorFire);
  assert.ok(seen.has(true), 'fires do appear');
  assert.ok(seen.has(false), 'fires are NOT every floor (the whole point)');
});

test('minor fire roll is deterministic', () => {
  assert.equal(floorEvents(3, lcg(777)).minorFire, floorEvents(3, lcg(777)).minorFire);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
