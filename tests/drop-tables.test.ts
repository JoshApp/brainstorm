// Drop tables — the unified economy registry. Locks the resolver's guarantees:
// every source resolves to a bundle, enemies drop ONLY the small layer (gold /
// key / consumable — never gear or relics), relic-gated sources never leak a
// weapon, and the roll is deterministic given its rand.
//
//   npm test

import assert from 'node:assert/strict';
import { rollDropTable, TABLES, RELIC_KINDS, type DropTableId } from '../src/content/drop-tables';

// Deterministic LCG so tests don't depend on Math.random.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('every table id resolves to a valid bundle', () => {
  for (const id of Object.keys(TABLES) as DropTableId[]) {
    const r = rollDropTable(id, 5, seeded(1));
    assert.ok(r.gold >= 0 && Array.isArray(r.items), `${id} returns { gold, items }`);
  }
});

test('enemies drop ONLY the small layer — gold, key, or consumable (never gear/relic)', () => {
  const rand = seeded(11);
  for (let i = 0; i < 300; i++) {
    const r = rollDropTable('enemy', 5, rand);
    for (const it of r.items) {
      assert.ok(it.kind === 'consumable' || it.kind === 'key',
        `enemy dropped a ${it.kind} (${it.id}) — enemies must never drop gear or relics`);
    }
  }
});

test('enemy is mostly gold, and keys never drop (keys are cut)', () => {
  let goldRolls = 0, keyRolls = 0;
  const rand = seeded(42);
  for (let i = 0; i < 300; i++) {
    const r = rollDropTable('enemy', 3, rand);
    if (r.gold > 0) goldRolls++;
    if (r.items.some((it) => it.kind === 'key')) keyRolls++;
  }
  assert.ok(goldRolls > 240, `gold on most kills (${goldRolls}/300)`);
  assert.equal(keyRolls, 0, `keys are cut — none should ever drop (${keyRolls}/300)`);
});

test('relic-gated sources never leak a weapon (gold chest = relics only)', () => {
  const rand = seeded(7);
  for (let i = 0; i < 120; i++) {
    const r = rollDropTable('chest-gold', 5, rand);
    for (const it of r.items) {
      assert.notEqual(it.kind, 'weapon', 'a gold chest must never drop a weapon');
      assert.ok(RELIC_KINDS.includes(it.kind), `gold chest dropped a ${it.kind} — should be a relic`);
    }
  }
});

test('a chest always pays — emptyGold when the roll whiffs', () => {
  const r = rollDropTable('chest-wood', 1, seeded(3));
  assert.ok(r.items.length > 0 || r.gold >= 6, 'wood chest gives an item or at least its emptyGold');
});

test('deterministic — same seed, same bundle', () => {
  const a = rollDropTable('chest-silver', 5, seeded(99));
  const b = rollDropTable('chest-silver', 5, seeded(99));
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  assert.equal(a.gold, b.gold);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
