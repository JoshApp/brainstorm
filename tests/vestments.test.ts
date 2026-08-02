// Vestments v2 (src/player/equipment.ts) — TWO build-piece slots (#99).
// Guards: a vestment auto-fills the first free of the two slots, both are
// independent, and a third vestment can't auto-equip (caller bags it). Vestments
// are worn build pieces (unique effects), not a single armour slot.

import assert from 'node:assert/strict';
import {
  setSlot, getEquipped, tryAutoEquip, slotKindFor,
} from '../src/player/equipment';
import { ITEMS } from '../src/content/items';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const vestIds = Object.values(ITEMS).filter((i) => i.kind === 'vestment').map((i) => i.id);
const [V1, V2, V3] = vestIds;

function reset() { setSlot('vestment', null); setSlot('vestment2', null); }

test('registry has three+ vestments to fill both slots and overflow', () => {
  assert.ok(vestIds.length >= 3, `only ${vestIds.length} vestments`);
});

test("a vestment's kind maps to BOTH vestment slots", () => {
  assert.deepEqual(slotKindFor('vestment'), ['vestment', 'vestment2']);
});

test('two vestments fill both slots; a third does not auto-equip', () => {
  reset();
  assert.equal(tryAutoEquip(ITEMS[V1]), true);
  assert.equal(getEquipped('vestment')?.id, V1);
  assert.equal(getEquipped('vestment2'), null);
  assert.equal(tryAutoEquip(ITEMS[V2]), true);
  assert.equal(getEquipped('vestment2')?.id, V2);
  assert.equal(tryAutoEquip(ITEMS[V3]), false, 'both slots full → caller bags it');
});

test('the two vestment slots are independent', () => {
  reset();
  setSlot('vestment', ITEMS[V1]);
  setSlot('vestment2', ITEMS[V2]);
  assert.equal(getEquipped('vestment')?.id, V1);
  assert.equal(getEquipped('vestment2')?.id, V2);
  setSlot('vestment', null);
  assert.equal(getEquipped('vestment'), null);
  assert.equal(getEquipped('vestment2')?.id, V2, 'clearing slot 1 leaves slot 2');
});

test('the new unique-effect vestments exist and carry non-armour effects', () => {
  const quicksilver = ITEMS['quicksilver-anklets'];
  assert.ok(quicksilver, 'quicksilver-anklets missing');
  assert.ok(quicksilver.modifiers?.some((m) => m.kind === 'move-speed-mult'), 'should give move-speed');
});

reset();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
