// The choices ledger — what the deep remembers you took and refused. Asserts
// that the transaction stream feeds it (resolved → taken, declined → refused),
// that domain tagging + counts work, and that serialize/hydrate round-trips.
//
//   npm test

import assert from 'node:assert/strict';
import { emit } from '../src/broadcast/event-bus';
import {
  getChoices, getDeclined, countByDomain, clearChoices,
  serializeChoices, hydrateChoices,
} from '../src/state/choices';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  clearChoices();
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// A blood relic (taken) and a cursed blood-altar offering (declined) — both real
// item ids so domainOf resolves them.
const TAKEN = 'ring-of-bloodthirst';   // blood
const REFUSED = 'ring-of-marrow';      // cursed bone-altar offering

test('transaction:resolved records taken items', () => {
  emit({ type: 'transaction:resolved', family: 'bargain', id: 'altar:1', outcome: { itemIds: [TAKEN] } });
  const c = getChoices();
  assert.equal(c.length, 1);
  assert.equal(c[0].itemId, TAKEN);
  assert.equal(c[0].decision, 'taken');
  assert.equal(c[0].domain, 'blood');
});

test('transaction:declined records a refusal with its item', () => {
  emit({ type: 'transaction:declined', family: 'bargain', id: 'altar:2', itemId: REFUSED });
  const d = getDeclined();
  assert.equal(d.length, 1);
  assert.equal(d[0].itemId, REFUSED);
  assert.equal(d[0].decision, 'declined');
  // ring-of-marrow is cursed → tagged 'cursed' when it has no plain domain, or
  // its own domain if set; either way it's a non-null tag the deep can taunt on.
  assert.ok(d[0].domain !== null);
});

test('countByDomain tallies refusals per domain', () => {
  emit({ type: 'transaction:declined', family: 'bargain', id: 'a', itemId: TAKEN });   // blood, declined
  emit({ type: 'transaction:declined', family: 'bargain', id: 'b', itemId: TAKEN });   // blood, declined
  emit({ type: 'transaction:resolved', family: 'bargain', id: 'c', outcome: { itemIds: [TAKEN] } }); // blood, taken
  assert.equal(countByDomain('blood', 'declined'), 2);
  assert.equal(countByDomain('blood', 'taken'), 1);
});

test('declined event without an item records nothing', () => {
  emit({ type: 'transaction:declined', family: 'trial', id: 'trial:1' });   // no itemId
  assert.equal(getChoices().length, 0);
});

test('unknown item ids are ignored', () => {
  emit({ type: 'transaction:resolved', family: 'bargain', id: 'x', outcome: { itemIds: ['not-a-real-item'] } });
  assert.equal(getChoices().length, 0);
});

test('serialize / hydrate round-trips the ledger', () => {
  emit({ type: 'transaction:resolved', family: 'bargain', id: 'r', outcome: { itemIds: [TAKEN] } });
  emit({ type: 'transaction:declined', family: 'bargain', id: 'd', itemId: REFUSED });
  const saved = serializeChoices();
  clearChoices();
  assert.equal(getChoices().length, 0);
  hydrateChoices(saved);
  assert.equal(getChoices().length, 2);
  assert.equal(getDeclined().length, 1);
  // hydrate is a deep copy — mutating the saved array must not leak back in.
  saved.push({ itemId: TAKEN, domain: 'blood', decision: 'taken' });
  assert.equal(getChoices().length, 2);
});

console.log(`\nchoices: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
