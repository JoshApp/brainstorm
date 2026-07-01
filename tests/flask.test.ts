// Healing FLASK (Estus) — charge/capacity arithmetic + persistence roundtrip.
// (drinkFlask needs a live player entity, so it's exercised in-game, not here.)
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import {
  getFlask, refillFlask, addCharges, addCapacity, addHealPerCharge,
  resetFlask, serializeFlask, restoreFlask,
} from '../src/player/flask';

const F = CONFIG.FLASK;
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('reset → full flask at base capacity', () => {
  resetFlask();
  const f = getFlask();
  assert.equal(f.capacity, F.START_CAPACITY);
  assert.equal(f.charges, F.START_CAPACITY);
  assert.equal(f.healPerCharge, F.HEAL_PER_CHARGE);
});

test('addCharges clamps to capacity and never below 0', () => {
  resetFlask();
  assert.equal(addCharges(5), 0, 'already full → adds nothing');
  addCharges(-100);
  assert.equal(getFlask().charges, 0, 'drained to 0, not negative');
  assert.equal(addCharges(2), 2, 'refuels 2');
  assert.equal(getFlask().charges, 2);
});

test('addCapacity grows the pool and tops up the new charge', () => {
  resetFlask();
  addCharges(-F.START_CAPACITY);           // empty it
  addCapacity(2);                          // +2 capacity, fill=true
  const f = getFlask();
  assert.equal(f.capacity, F.START_CAPACITY + 2);
  assert.equal(f.charges, 2, 'the two new charges were topped up');
});

test('addCapacity fill=false grows capacity without adding charges', () => {
  resetFlask();
  addCharges(-1);                          // charges = cap-1
  const before = getFlask().charges;
  addCapacity(3, false);
  assert.equal(getFlask().charges, before, 'no charges added');
  assert.equal(getFlask().capacity, F.START_CAPACITY + 3);
});

test('refill tops charges back to capacity', () => {
  resetFlask();
  addCharges(-2);
  refillFlask();
  assert.equal(getFlask().charges, getFlask().capacity);
});

test('addHealPerCharge raises heal amount', () => {
  resetFlask();
  addHealPerCharge(2);
  assert.equal(getFlask().healPerCharge, F.HEAL_PER_CHARGE + 2);
});

test('serialize/restore roundtrip, and restore clamps charges to capacity', () => {
  resetFlask();
  addCapacity(2); addHealPerCharge(1); addCharges(-1);
  const snap = serializeFlask();
  resetFlask();                            // wipe
  restoreFlask(snap);
  assert.deepEqual(getFlask(), snap);
  // A corrupt/overfull save clamps down.
  restoreFlask({ charges: 999, capacity: 4, healPerCharge: 3 });
  assert.equal(getFlask().charges, 4);
  // Missing save → base flask.
  restoreFlask(undefined);
  assert.equal(getFlask().capacity, F.START_CAPACITY);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
