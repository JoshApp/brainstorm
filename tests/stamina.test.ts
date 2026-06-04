// Stamina resource logic — the rules that make the bar feel like Elden Ring's
// (soft spend = never a dead tap, hard spend for all-or-nothing, exhausted
// state with a longer recovery, delayed regen). Pure module, no DOM.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import {
  getStamina, spendStamina, spendStaminaSoft, tickStamina, gainStamina,
  isStaminaExhausted, canSpendStamina, resetStamina, getMaxStamina,
} from '../src/combat/stamina';

const S = CONFIG.STAMINA;
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  resetStamina();
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('starts full', () => {
  assert.equal(getStamina(), getMaxStamina());
  assert.equal(isStaminaExhausted(), false);
});

test('hard spend is all-or-nothing', () => {
  assert.equal(spendStamina(S.MAX + 1), false, 'cannot overspend');
  assert.equal(getStamina(), S.MAX, 'no change on failed spend');
  assert.equal(spendStamina(S.CHARGED_COST), true);
  assert.equal(getStamina(), S.MAX - S.CHARGED_COST);
});

test('soft spend fires on a sliver, only fails at empty', () => {
  // Drain to a sliver smaller than one cost.
  spendStaminaSoft(S.MAX - 5);            // leaves 5
  assert.ok(getStamina() > 0 && getStamina() < S.RANGED_COST);
  assert.equal(spendStaminaSoft(S.RANGED_COST), true, 'fires with a sliver');
  assert.equal(getStamina(), 0, 'clamped at 0, not negative');
  assert.equal(spendStaminaSoft(S.RANGED_COST), false, 'blocked only when empty');
});

test('bottoming out sets exhausted + longer recovery; light regen does not clear early', () => {
  spendStaminaSoft(S.MAX);                // → 0
  assert.equal(isStaminaExhausted(), true);
  // Regen is held during the (longer) exhaust delay.
  tickStamina(S.REGEN_DELAY_S + 0.01);    // past the NORMAL delay…
  assert.equal(getStamina(), 0, 'still held — exhaust delay is longer');
  // Wait out the rest of the exhaust delay, then regen a touch — still gassed
  // until it climbs past EXHAUST_CLEAR.
  tickStamina(S.EXHAUST_RECOVERY_S);      // delay elapsed
  tickStamina(0.05);                      // a little regen
  assert.ok(getStamina() > 0 && getStamina() < S.EXHAUST_CLEAR);
  assert.equal(isStaminaExhausted(), true, 'still gassed below EXHAUST_CLEAR');
});

test('exhausted clears once regen passes EXHAUST_CLEAR', () => {
  spendStaminaSoft(S.MAX);                // → 0, gassed
  tickStamina(S.EXHAUST_RECOVERY_S);      // wait out the delay
  // Regen enough to cross the clear threshold.
  tickStamina((S.EXHAUST_CLEAR / S.REGEN_PER_SEC) + 0.1);
  assert.ok(getStamina() >= S.EXHAUST_CLEAR);
  assert.equal(isStaminaExhausted(), false, 'no longer gassed');
});

test('regen holds during the post-spend delay then refills', () => {
  spendStamina(S.CHARGED_COST);
  const afterSpend = getStamina();
  tickStamina(S.REGEN_DELAY_S - 0.05);    // still within the delay
  assert.equal(getStamina(), afterSpend, 'no regen during delay');
  tickStamina(0.1);                       // crosses the boundary (clears delay)
  tickStamina(0.5);                       // now regen runs
  assert.ok(getStamina() > afterSpend, 'regen resumed');
});

test('gainStamina refunds, clamps at max, and can clear gassed', () => {
  spendStaminaSoft(S.MAX);                 // → 0, gassed
  assert.equal(isStaminaExhausted(), true);
  gainStamina(S.REFUND_ON_HIT);            // a small refund…
  assert.equal(getStamina(), S.REFUND_ON_HIT);
  // …below EXHAUST_CLEAR doesn't un-gas you on its own.
  assert.equal(isStaminaExhausted(), S.REFUND_ON_HIT < S.EXHAUST_CLEAR);
  gainStamina(S.MAX);                      // overfill
  assert.equal(getStamina(), S.MAX, 'clamped at max');
  assert.equal(isStaminaExhausted(), false, 'a refund past EXHAUST_CLEAR clears gassed');
});

test('canSpend reflects current', () => {
  assert.equal(canSpendStamina(S.MAX), true);
  spendStamina(S.MAX);
  assert.equal(canSpendStamina(1), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
