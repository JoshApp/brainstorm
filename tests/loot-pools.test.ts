// The loot POOL manager (loot-pools.ts) — the one place that dictates what each
// drop source yields. Locks: chest tiers pull their category, gold floors to
// rare, the defining find is gear, and UNIQUE pools (boss) are exclusive both
// ways — a boss item only drops from the boss pool, and never leaks into a
// generic roll.
//
//   npm test

import assert from 'node:assert/strict';
import { rollPool, poolEmptyGold, GEAR_KINDS } from '../src/content/loot-pools';
import { rollLoot } from '../src/content/loot';
import { RARITY_ORDER } from '../src/content/items';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  const step = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  step(); step(); step();
  return step;
}
const gearSet = new Set(GEAR_KINDS);

test('chest-bronze pulls CONSUMABLES; the gear tiers pull GEAR', () => {
  for (let seed = 0; seed < 40; seed++) {
    assert.equal(rollPool('chest-bronze', 3, lcg(seed))?.kind, 'consumable');
    for (const id of ['chest-silver', 'chest-gold', 'defining-find', 'merchant'] as const) {
      const it = rollPool(id, 5, lcg(seed));
      assert.ok(it && gearSet.has(it.kind), `${id} → ${it?.kind} should be gear`);
    }
  }
});

test('chest-gold floors at RARE from depth 3', () => {
  for (let seed = 0; seed < 40; seed++) {
    const it = rollPool('chest-gold', 5, lcg(seed))!;
    assert.ok(RARITY_ORDER.indexOf(it.rarity ?? 'mundane') >= RARITY_ORDER.indexOf('rare'),
      `gold @d5 → ${it.rarity}, expected rare+`);
  }
});

test('the BOSS pool yields its signature item, gated by depth', () => {
  // howling-edge is tagged drop.pool:'boss', minDepth 7.
  assert.equal(rollPool('boss', 3, lcg(1)), null, 'no boss item is eligible at depth 3');
  const deep = rollPool('boss', 8, lcg(1));
  assert.ok(deep, 'a boss item drops deep enough');
  assert.equal(deep!.id, 'howling-edge');
});

test('EXCLUSIVITY: a boss item NEVER leaks into a generic roll', () => {
  // Deep, gear-biased general rolls should never surface the pooled boss weapon.
  for (let seed = 0; seed < 500; seed++) {
    const it = rollLoot({ depth: 12, bias: 4, category: ['weapon'] }, lcg(seed));
    assert.notEqual(it?.id, 'howling-edge', `general roll leaked the boss item (seed ${seed})`);
  }
});

test('an empty unique pool returns null, never a general fallback', () => {
  // 'cursed' pool has no drop.pool:'cursed' items yet → must be null, NOT a
  // random general item smuggled in.
  for (let seed = 0; seed < 20; seed++) {
    assert.equal(rollPool('cursed', 8, lcg(seed)), null);
  }
});

test('deterministic + emptyGold config', () => {
  assert.deepEqual(rollPool('chest-gold', 6, lcg(99)), rollPool('chest-gold', 6, lcg(99)));
  assert.equal(poolEmptyGold('chest-gold'), 20);
  assert.equal(poolEmptyGold('defining-find'), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
