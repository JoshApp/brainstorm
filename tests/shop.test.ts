// Merchant shop — the pure logic the buy-panel rides on. Verifiable headless
// (no browser): stock rolls to valid, distinct, priced wares; pricing scales
// by rarity + depth; spendGold guards affordability.
//
//   npm test

import assert from 'node:assert/strict';
import { ITEMS } from '../src/content/items';
import { rollShopStock, priceFor } from '../src/content/shop';
import { startNewRun, grantGold, spendGold, getGold } from '../src/state/run-state';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// Deterministic rand so the roll is reproducible in the test.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('rollShopStock yields valid, distinct, priced wares', () => {
  const wares = rollShopStock(5, 3, mulberry32(12345));
  assert.ok(wares.length > 0 && wares.length <= 3, `got ${wares.length} wares`);
  const ids = new Set<string>();
  for (const w of wares) {
    assert.ok(ITEMS[w.itemId], `ware '${w.itemId}' is not a real item`);
    assert.ok(w.price > 0, `ware '${w.itemId}' price ${w.price} must be > 0`);
    assert.equal(w.price % 5, 0, `price ${w.price} should round to a multiple of 5`);
    assert.ok(!ids.has(w.itemId), `duplicate ware '${w.itemId}'`);
    ids.add(w.itemId);
  }
});

test('pricing scales by rarity and depth', () => {
  const fabled = { id: 'x', kind: 'weapon', name: 'X', rarity: 'fabled', dropModel: {} } as never;
  const mundane = { id: 'y', kind: 'weapon', name: 'Y', rarity: 'mundane', dropModel: {} } as never;
  assert.ok(priceFor(fabled, 1) > priceFor(mundane, 1), 'fabled should cost more than mundane');
  assert.ok(priceFor(mundane, 8) > priceFor(mundane, 1), 'deeper should cost more');
});

test('spendGold guards affordability', () => {
  startNewRun('test-shop');
  grantGold(100);
  assert.equal(getGold(), 100);
  assert.equal(spendGold(30), true);
  assert.equal(getGold(), 70);
  assert.equal(spendGold(1000), false, 'cannot overspend');
  assert.equal(getGold(), 70, 'a failed spend changes nothing');
  assert.equal(spendGold(0), false, 'zero/negative is a no-op');
});

test('the trinket merchant stocks RELICS (reliquary table)', () => {
  // Deterministic rand so the roll is stable; assert every ware is a relic.
  let s = 12345;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const stock = rollShopStock(6, 3, rand, 'reliquary');
  assert.ok(stock.length > 0, 'trinket stock should not be empty');
  for (const ware of stock) {
    assert.equal(ITEMS[ware.itemId]?.kind, 'relic', `${ware.itemId} should be a relic`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
