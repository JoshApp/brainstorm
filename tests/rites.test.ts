// Rites — the active lane. Guards the pure morph resolver (the active lane's
// Resonance): a rite escalates with how many of its domain's cards you hold,
// cumulatively, and is usable at base with none. The imperative activation
// (damage/heal/world) is integration-tested by play; this locks the data math.
//
//   npm test

import assert from 'node:assert/strict';
import { RITES, resolveRite } from '../src/content/rites';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const HEM = RITES['hemorrhage'];

test('hemorrhage exists and is a blood rite with a base form', () => {
  assert.ok(HEM, 'hemorrhage is registered');
  assert.equal(HEM.domain, 'blood');
  assert.ok(HEM.hungerCost > 0);
  assert.ok(HEM.base.radius > 0 && HEM.base.damage > 0);
});

test('base form (0 blood cards): costs HP, no bleed — usable un-built', () => {
  const r = resolveRite(HEM, 0);
  assert.equal(r.selfHpCost, HEM.base.selfHpCost, 'still costs your blood');
  assert.equal(r.applyBleed, false, 'no bleed yet');
  assert.equal(r.radius, HEM.base.radius);
});

test('2 blood cards: gains bleed, still costs HP', () => {
  const r = resolveRite(HEM, 2);
  assert.equal(r.applyBleed, true, 'now it festers');
  assert.ok(r.selfHpCost > 0, 'still bleeds you to erupt');
});

test('4 blood cards: free to erupt + bigger (the grotesque escalation)', () => {
  const r = resolveRite(HEM, 4);
  assert.equal(r.selfHpCost, 0, 'no longer costs your blood — you bleed power freely');
  assert.ok(r.radius > HEM.base.radius, 'wider');
  assert.ok(r.damage > HEM.base.damage, 'harder');
  assert.equal(r.applyBleed, true, 'still festers (tiers are cumulative)');
});

test('morph is monotonic — more blood never weakens the rite', () => {
  const a = resolveRite(HEM, 1), b = resolveRite(HEM, 3), c = resolveRite(HEM, 6);
  assert.ok(b.radius >= a.radius && c.radius >= b.radius);
  assert.ok(b.damage >= a.damage && c.damage >= b.damage);
});

test('resolveRite is pure (does not mutate the spec base)', () => {
  const before = { ...HEM.base };
  resolveRite(HEM, 4);
  assert.deepEqual(HEM.base, before, 'spec.base untouched');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
