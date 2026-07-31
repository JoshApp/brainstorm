// The content include-flag (src/content/content-status.ts). Locks in the release
// guarantee: dev/draft-flagged content is filtered OUT of the loot roll for a
// build it isn't cleared for, while release (and omitted-status) content always
// rolls. This is what lets a public build be cut purely from the loop.
//
//   npm test

import assert from 'node:assert/strict';
import { isIncluded, setActiveContentStatuses, statusOf } from '../src/content/content-status';
import { ITEMS, type ItemSpec } from '../src/content/items';
import { rollLoot, resetLootIndex } from '../src/content/loot';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// ── The gate logic, pinned to explicit status sets ──────────────────────────
test('omitted status resolves to release', () => {
  assert.equal(statusOf({}), 'release');
  assert.equal(statusOf({ status: 'dev' }), 'dev');
});

test('release-only build includes release + omitted, excludes dev/draft', () => {
  setActiveContentStatuses(['release']);
  assert.equal(isIncluded({}), true);
  assert.equal(isIncluded({ status: 'release' }), true);
  assert.equal(isIncluded({ status: 'dev' }), false);
  assert.equal(isIncluded({ status: 'draft' }), false);
  setActiveContentStatuses(null);
});

test('dev build includes dev, still excludes draft', () => {
  setActiveContentStatuses(['release', 'dev']);
  assert.equal(isIncluded({ status: 'dev' }), true);
  assert.equal(isIncluded({ status: 'draft' }), false);
  setActiveContentStatuses(null);
});

// ── Integration: a draft item never rolls in a release build ────────────────
test('a draft-flagged item is never produced by rollLoot in a release build', () => {
  const id = '__test_draft_item__';
  const draft: ItemSpec = {
    id, kind: 'trinket', name: 'Test Draft Trinket', status: 'draft', rarity: 'mundane',
    // High weight, minDepth 1 — it WOULD dominate mundane rolls if it were included.
    drop: { minDepth: 1, weight: 1000 },
  } as ItemSpec;
  (ITEMS as Record<string, ItemSpec>)[id] = draft;
  try {
    setActiveContentStatuses(['release']);
    resetLootIndex();               // rebuild the index with the gate active
    let seen = false;
    for (let i = 0; i < 500; i++) {
      const it = rollLoot({ depth: 1 }, () => Math.random());
      if (it?.id === id) { seen = true; break; }
    }
    assert.equal(seen, false, 'draft item leaked into a release-build loot roll');

    // Sanity: with draft included it CAN appear (proves the item is otherwise rollable,
    // so the negative above is the gate working, not the item being unrollable).
    setActiveContentStatuses(['release', 'dev', 'draft']);
    resetLootIndex();
    let seenNow = false;
    for (let i = 0; i < 500; i++) {
      const it = rollLoot({ depth: 1 }, () => Math.random());
      if (it?.id === id) { seenNow = true; break; }
    }
    assert.equal(seenNow, true, 'draft item did not roll even when its status was included');
  } finally {
    delete (ITEMS as Record<string, ItemSpec>)[id];
    setActiveContentStatuses(null);
    resetLootIndex();
  }
});

console.log(`content-status: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
