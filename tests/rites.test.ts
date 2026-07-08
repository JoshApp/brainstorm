// Rites — the active lane. Guards the pure morph resolver (the active lane's
// Resonance): a rite escalates with how many of its domain's cards you hold,
// cumulatively, and is usable at base with none. Rites are COMPOSABLE EFFECTS
// now (a list of primitives); this locks the data math on the resolved list.
// The imperative activation (damage/heal/buff/world) is integration-tested by play.
//
//   npm test

import assert from 'node:assert/strict';
import { RITES, resolveRite, type RiteEffect } from '../src/content/rites';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const HEM = RITES['hemorrhage'];
const nova = (r: RiteEffect[]) => r.find((e): e is Extract<RiteEffect, { kind: 'nova' }> => e.kind === 'nova');
const cost = (r: RiteEffect[]) => r.find((e): e is Extract<RiteEffect, { kind: 'cost' }> => e.kind === 'cost');

test('hemorrhage exists and is a blood rite with a nova effect', () => {
  assert.ok(HEM, 'hemorrhage is registered');
  assert.equal(HEM.domain, 'blood');
  assert.ok(HEM.hungerCost > 0);
  const n = nova(HEM.effects);
  assert.ok(n && n.radius > 0 && n.damage > 0, 'has a nova with radius + damage');
});

test('base form (0 blood cards): costs HP, no bleed — usable un-built', () => {
  const r = resolveRite(HEM, 0);
  assert.ok((cost(r)?.hp ?? 0) > 0, 'still costs your blood');
  assert.equal(nova(r)?.buff, undefined, 'no bleed yet');
});

test('2 blood cards: gains bleed, still costs HP', () => {
  const r = resolveRite(HEM, 2);
  assert.equal(nova(r)?.buff, 'bleed', 'now it festers');
  assert.ok((cost(r)?.hp ?? 0) > 0, 'still bleeds you to erupt');
});

test('4 blood cards: free to erupt + bigger (the grotesque escalation)', () => {
  const r = resolveRite(HEM, 4);
  assert.equal(cost(r)?.hp, 0, 'no longer costs your blood — you bleed power freely');
  assert.ok(nova(r)!.radius > nova(HEM.effects)!.radius, 'wider');
  assert.ok(nova(r)!.damage > nova(HEM.effects)!.damage, 'harder');
  assert.equal(nova(r)?.buff, 'bleed', 'still festers (tiers are cumulative)');
});

test('morph is monotonic — more blood never weakens the rite', () => {
  const a = resolveRite(HEM, 1), b = resolveRite(HEM, 3), c = resolveRite(HEM, 6);
  assert.ok(nova(b)!.radius >= nova(a)!.radius && nova(c)!.radius >= nova(b)!.radius);
  assert.ok(nova(b)!.damage >= nova(a)!.damage && nova(c)!.damage >= nova(b)!.damage);
});

test('resolveRite is pure (does not mutate the spec effects)', () => {
  const before = JSON.stringify(HEM.effects);
  resolveRite(HEM, 4);
  assert.equal(JSON.stringify(HEM.effects), before, 'spec.effects untouched');
});

test('composable non-nova rite: zealotry morph ADDS effects (heal + lifesteal)', () => {
  const base = resolveRite(RITES['zealotry'], 0);
  const built = resolveRite(RITES['zealotry'], 4);
  assert.ok(base.every((e) => e.kind === 'selfBuff'), 'base is pure self-buffs, no erupt');
  assert.ok(built.length > base.length, 'commitment adds effects');
  assert.ok(built.some((e) => e.kind === 'heal'), 'gains a heal at 2+');
  assert.ok(built.some((e) => e.kind === 'selfBuff' && e.buff === 'bloodthirst'), 'gains lifesteal at 4');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
