// Weapon loadout (src/player/equipment.ts) — the two-weapon carry + swap (#96).
// Guards: a second weapon auto-fills the sheathed slot, swap exchanges drawn ↔
// sheathed (with affixes), the sheathed weapon is never the drawn one, and a
// third weapon can't be carried (both slots full → false, caller bags it).

import assert from 'node:assert/strict';
import {
  setSlot, getEquipped, setSidearm, getSidearm, swapWeapons, tryAutoEquip,
} from '../src/player/equipment';
import { ITEMS } from '../src/content/items';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// Two real weapon ids from the registry (first two weapon-kind items).
const weaponIds = Object.values(ITEMS).filter((i) => i.kind === 'weapon').map((i) => i.id);
const [A, B, C] = weaponIds;

function reset() { setSlot('weapon', null); setSidearm(null); }

test('registry has at least three weapons to exercise the cap', () => {
  assert.ok(weaponIds.length >= 3, `only ${weaponIds.length} weapons`);
});

test('a second weapon auto-fills the sheathed slot; a third does not', () => {
  reset();
  assert.equal(tryAutoEquip(ITEMS[A]), true);          // → drawn
  assert.equal(getEquipped('weapon')?.id, A);
  assert.equal(getSidearm(), null);
  assert.equal(tryAutoEquip(ITEMS[B]), true);          // → sheathed
  assert.equal(getSidearm()?.id, B);
  assert.equal(tryAutoEquip(ITEMS[C]), false);         // both full → caller bags it
  assert.equal(getEquipped('weapon')?.id, A);
  assert.equal(getSidearm()?.id, B);
});

test('swap exchanges drawn ↔ sheathed', () => {
  reset();
  setSlot('weapon', ITEMS[A]);
  setSidearm(ITEMS[B]);
  assert.equal(swapWeapons(), true);
  assert.equal(getEquipped('weapon')?.id, B, 'B is now drawn');
  assert.equal(getSidearm()?.id, A, 'A is now sheathed');
  swapWeapons();
  assert.equal(getEquipped('weapon')?.id, A, 'swapped back');
});

test('swap with only one weapon still works (draws from empty hand)', () => {
  reset();
  setSidearm(ITEMS[A]);                                // sheathed only, empty hand
  assert.equal(swapWeapons(), true);
  assert.equal(getEquipped('weapon')?.id, A);
  assert.equal(getSidearm(), null);
});

test('swap is a no-op when carrying no weapon at all', () => {
  reset();
  assert.equal(swapWeapons(), false);
});

reset();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
