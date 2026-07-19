// Relic stack curves (docs/ITEM-GRAMMAR.md §4) — how N copies of one relic
// combine. Locks: default additive = linear, default multiplier = compounding
// (pushed per copy; computePlayerStats multiplies), hyperbolic = 1−(1−a)^N
// collapsed to a single modifier that approaches but never reaches 1.
//
//   npm test

import assert from 'node:assert/strict';
import { stackedRelicModifiers, type StatModifier } from '../src/combat/modifiers';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('default additive stacking is linear — one push per copy', () => {
  const mods: StatModifier[] = [{ kind: 'weapon-damage', amount: 1 }];
  const out = stackedRelicModifiers(mods, 3);
  assert.equal(out.length, 3, 'three copies → three pushes');
  assert.ok(out.every((m) => m.kind === 'weapon-damage' && m.amount === 1));
});

test('multiplier kinds compound by construction (per-copy push, aggregator multiplies)', () => {
  const mods: StatModifier[] = [{ kind: 'damage-multiplier', amount: 1.15 }];
  const out = stackedRelicModifiers(mods, 4);
  assert.equal(out.length, 4, 'four pushes → computePlayerStats yields 1.15^4');
});

test('hyperbolic collapses to ONE modifier with 1−(1−a)^N', () => {
  const mods: StatModifier[] = [{ kind: 'crit-chance', amount: 0.10, stack: 'hyperbolic' }];
  const one = stackedRelicModifiers(mods, 1);
  assert.equal(one.length, 1);
  assert.ok(Math.abs(one[0].amount - 0.10) < 1e-9, 'one copy = base amount');
  const five = stackedRelicModifiers(mods, 5);
  assert.equal(five.length, 1, 'still a single synthesized modifier');
  assert.ok(Math.abs(five[0].amount - (1 - Math.pow(0.9, 5))) < 1e-9, '5 copies = 1−0.9^5 ≈ 0.41');
  const fifty = stackedRelicModifiers(mods, 50);
  assert.ok(fifty[0].amount < 1, 'approaches 1, never reaches it');
  assert.ok(fifty[0].amount > five[0].amount, 'every copy still helps');
});

test('mixed lists keep each modifier’s own curve', () => {
  const mods: StatModifier[] = [
    { kind: 'weapon-damage', amount: 1 },
    { kind: 'lifesteal-pct', amount: 0.15, stack: 'hyperbolic' },
  ];
  const out = stackedRelicModifiers(mods, 3);
  assert.equal(out.filter((m) => m.kind === 'weapon-damage').length, 3);
  const ls = out.filter((m) => m.kind === 'lifesteal-pct');
  assert.equal(ls.length, 1);
  assert.ok(Math.abs(ls[0].amount - (1 - Math.pow(0.85, 3))) < 1e-9);
});

test('degenerate inputs: empty list / zero copies → empty', () => {
  assert.deepEqual(stackedRelicModifiers(undefined, 3), []);
  assert.deepEqual(stackedRelicModifiers([{ kind: 'max-hp', amount: 1 }], 0), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
