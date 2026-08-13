// A RITE IS SOMETHING YOU FOUND.
//
// Josh: "let's make rites not equippable from inventory ... rites need to be
// items that you can kinda find / pick up. similar to relics with 2.5d etc.,
// very similar but distinct to it." And on the slot: "maybe yes we make it so
// you can carry multiple rites but only have one active."
//
// Two claims, and the first is the one that can silently rot: every rite in the
// registry must have an ITEM that grants it, because the item is GENERATED from
// the rite — if that generator ever stops covering the registry, the new rite is
// unfindable and nothing says so.
//
//   npm test -- rite-carry

import assert from 'node:assert/strict';
import { RITES } from '../src/content/rites';
import { ITEMS } from '../src/content/items';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const riteItems = Object.values(ITEMS).filter((i) => i.kind === 'rite');

test('EVERY RITE IS FINDABLE — one item per rite, generated, never hand-listed', () => {
  for (const id of Object.keys(RITES)) {
    const item = riteItems.find((i) => i.riteId === id);
    assert.ok(item, `rite '${id}' has no item — it exists in the game and cannot be found`);
  }
  assert.equal(riteItems.length, Object.keys(RITES).length,
    'rite items and rites are no longer 1:1');
});

test('a rite item POINTS AT a rite and carries no mechanics of its own', () => {
  for (const i of riteItems) {
    assert.ok(i.riteId, `${i.id}: no riteId — it grants nothing`);
    assert.ok(RITES[i.riteId!], `${i.id}: riteId '${i.riteId}' is not a rite`);
    // The numbers live in RITES. An item that also carried modifiers would be a
    // second place to tune the same thing.
    assert.ok(!i.modifiers?.length, `${i.id}: a rite wrapper must not carry modifiers`);
    assert.ok(!i.weapon, `${i.id}: a rite wrapper must not carry weapon stats`);
  }
});

test('IT HAS A BODY — a rite you cannot see on the floor cannot be found', () => {
  for (const i of riteItems) {
    assert.ok(i.dropModel, `${i.id}: no dropModel`);
    // Distinct from a relic by construction: the sigil is its own model family.
    assert.ok(String(i.dropModel?.id ?? '').startsWith('rite-sigil'),
      `${i.id}: drops as '${i.dropModel?.id}' — rites should read as sigils, not as relics`);
  }
});

test('RARITY TRACKS COST — the expensive rites are the ones worth descending for', () => {
  for (const i of riteItems) {
    const r = RITES[i.riteId!];
    if (r.hungerCost >= 80) assert.equal(i.rarity, 'fabled', `${i.id} costs ${r.hungerCost}`);
    else if (r.hungerCost < 44) assert.equal(i.rarity, 'uncommon', `${i.id} costs ${r.hungerCost}`);
  }
});

test('A RITE IS NOT EQUIPMENT — it fills no slot', async () => {
  const { slotKindFor } = await import('../src/player/equipment');
  assert.deepEqual(slotKindFor('rite'), [],
    'a rite claimed an equipment slot — it belongs to the run, not the paperdoll');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
