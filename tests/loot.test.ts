// Central loot distribution — guards the rules that make loot feel right:
// scarcity scales with depth, powerful items stay gated out of early
// floors, no-drop items never appear, and a roll always yields something.
//
//   npm test
//
// Imports content/loot (pulls items → model specs, plain data) — runs fine
// under tsx in Node.

import assert from 'node:assert/strict';
import { rollLoot, rollRarity } from '../src/content/loot';
import { ITEMS, RARITY_ORDER, type Rarity } from '../src/content/items';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

// Deterministic mulberry32 so the statistical tests are reproducible.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rarityHistogram(depth: number, bias: number, n = 20000): Record<Rarity, number> {
  const rng = mulberry32(depth * 1000 + bias + 1);
  const h: Record<Rarity, number> = { mundane: 0, uncommon: 0, rare: 0, cursed: 0, fabled: 0 };
  for (let i = 0; i < n; i++) h[rollRarity(depth, bias, rng)]++;
  return h;
}

// ── Scarcity: floor 1 is overwhelmingly mundane ──────────────────────────
test('floor 1 basic drops are mostly mundane, fabled effectively never', () => {
  const h = rarityHistogram(1, 0);
  assert.ok(h.mundane / 20000 > 0.6, `floor-1 mundane share ${(h.mundane / 20000).toFixed(2)} should exceed 0.6`);
  assert.equal(h.fabled, 0, 'no fabled on a floor-1 basic roll');
  assert.ok(h.rare < 200, `rare on floor 1 should be a rarity (${h.rare}/20000)`);
});

// ── Depth lifts the curve ────────────────────────────────────────────────
test('rarer tiers grow with depth', () => {
  const shallow = rarityHistogram(1, 0);
  const deep = rarityHistogram(12, 0);
  assert.ok(deep.rare > shallow.rare, 'rare share rises with depth');
  assert.ok(deep.mundane < shallow.mundane, 'mundane share falls with depth');
  assert.ok(deep.fabled > 0, 'fabled becomes possible on the deepest floors');
});

// ── Source bias lifts the curve too ──────────────────────────────────────
test('a boss-chest bias is richer than a basic drop at the same depth', () => {
  const basic = rarityHistogram(3, 0);
  const boss = rarityHistogram(3, 4);
  const richBasic = basic.rare + basic.cursed + basic.fabled;
  const richBoss = boss.rare + boss.cursed + boss.fabled;
  assert.ok(richBoss > richBasic, 'higher bias yields more rare+');
});

// ── OP gating: heartburn (minDepth 8) cannot drop early ──────────────────
test('depth-gated items never drop below their minDepth', () => {
  const rng = mulberry32(42);
  // Hammer floor-2 boss chests hard; heartburn (minDepth 8) must never appear.
  for (let i = 0; i < 30000; i++) {
    const item = rollLoot({ depth: 2, bias: 4 }, rng);
    assert.ok(item, 'a roll always yields an item');
    assert.notEqual(item!.id, 'heartburn', 'heartburn must not drop on floor 2');
    assert.notEqual(item!.id, 'howling-edge', 'howling-edge (minDepth 7) must not drop on floor 2');
  }
});

// ── no-drop items are excluded entirely ──────────────────────────────────
test('noDrop items never appear in generic rolls', () => {
  const rng = mulberry32(7);
  const noDropIds = new Set(
    Object.keys(ITEMS).filter((id) => ITEMS[id].drop?.noDrop),
  );
  assert.ok(noDropIds.has('oil-lamp'), 'oil-lamp is flagged noDrop (sanity)');
  for (let i = 0; i < 30000; i++) {
    const item = rollLoot({ depth: 12, bias: 4 }, rng);
    assert.ok(!noDropIds.has(item!.id), `${item!.id} is noDrop and must not roll`);
  }
});

// ── A roll always resolves to a real item ────────────────────────────────
test('rollLoot never returns null across the whole descent', () => {
  const rng = mulberry32(99);
  for (let depth = 1; depth <= 12; depth++) {
    for (let bias = 0; bias <= 4; bias++) {
      for (let i = 0; i < 200; i++) {
        const item = rollLoot({ depth, bias }, rng);
        assert.ok(item && ITEMS[item.id], `null/invalid loot at depth ${depth} bias ${bias}`);
      }
    }
  }
});

// ── Rarity FLOOR: a paid-for reward never drops below minRarity ──────────
test('minRarity clamps every roll up to at least the floor', () => {
  const rng = mulberry32(123);
  const floorIdx = RARITY_ORDER.indexOf('rare');
  // Depth 3 boss-bias with a rare floor — the curve would land mundane ~half
  // the time without it; the floor must forbid anything below rare.
  for (let i = 0; i < 30000; i++) {
    const item = rollLoot({ depth: 3, bias: 4, minRarity: 'rare' }, rng);
    assert.ok(item, 'a floored roll still always yields an item');
    const rIdx = RARITY_ORDER.indexOf(item!.rarity ?? 'mundane');
    assert.ok(rIdx >= floorIdx, `${item!.id} (${item!.rarity}) is below the rare floor`);
  }
});

test('minRarity still respects minDepth gating (no early OP items)', () => {
  const rng = mulberry32(321);
  for (let i = 0; i < 30000; i++) {
    const item = rollLoot({ depth: 2, bias: 4, minRarity: 'rare' }, rng);
    assert.ok(item, 'a roll always yields an item');
    assert.notEqual(item!.id, 'heartburn', 'depth gate holds under a floor');
  }
});

// ── RARITY_ORDER sanity ──────────────────────────────────────────────────
test('RARITY_ORDER covers every rarity once, ascending', () => {
  assert.equal(RARITY_ORDER.length, 5);
  assert.deepEqual([...RARITY_ORDER], ['mundane', 'uncommon', 'rare', 'cursed', 'fabled']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
