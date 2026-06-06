// The authorable registry is the seam the preview tooling (snap scenarios, the
// in-browser viewer, `delve list`) enumerates against. These tests lock the
// contract that keeps "add content → it's previewable for free" honest:
//   - every mob/weapon/item in the data registries surfaces as an Authorable
//   - every Authorable carries a non-empty id/label/scenario
//   - scenario names follow the convention the snap CLI + viewer rely on
//
//   npm test

import assert from 'node:assert/strict';
import { ENEMIES } from '../src/content/enemies';
import { ITEMS } from '../src/content/items';
import { listMobs, listWeapons, listItems, listAuthorables } from '../src/debug/authorables';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('every enemy surfaces as a mob authorable', () => {
  const mobIds = new Set(listMobs().map((a) => a.id));
  for (const id of Object.keys(ENEMIES)) {
    assert.ok(mobIds.has(id), `enemy '${id}' missing from listMobs()`);
  }
  assert.equal(listMobs().length, Object.keys(ENEMIES).length);
});

test('every item surfaces as an item authorable', () => {
  const itemIds = new Set(listItems().map((a) => a.id));
  for (const id of Object.keys(ITEMS)) {
    assert.ok(itemIds.has(id), `item '${id}' missing from listItems()`);
  }
  assert.equal(listItems().length, Object.keys(ITEMS).length);
});

test('weapons are the items that equip into the hand', () => {
  const weapons = listWeapons();
  assert.ok(weapons.length > 0, 'no weapons enumerated');
  for (const w of weapons) {
    const spec = ITEMS[w.id];
    assert.ok(spec.kind === 'weapon' || !!spec.weapon, `'${w.id}' is not a weapon`);
  }
});

test('every authorable has id/label and a conventional scenario name', () => {
  const prefix: Record<string, string> = { mob: 'mob-', weapon: 'viewmodel-', item: 'item-' };
  for (const a of listAuthorables()) {
    assert.ok(a.id, 'empty id');
    assert.ok(a.label, `'${a.id}' has empty label`);
    assert.equal(a.scenario, `${prefix[a.kind]}${a.id}`, `'${a.id}' scenario name off-convention`);
    assert.ok(a.tags.length > 0, `'${a.id}' has no tags`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
