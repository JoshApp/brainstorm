// Rites — the active lane. Guards the pure morph resolver (the active lane's
// Resonance): a rite escalates with how many of its domain's cards you hold,
// cumulatively, and is usable at base with none. Rites are COMPOSABLE EFFECTS
// now (a list of primitives); this locks the data math on the resolved list.
// The imperative activation (damage/heal/buff/world) is integration-tested by play.
//
//   npm test

import assert from 'node:assert/strict';
import {
  enterStillness, tickStillness, getStillnessTimeScale, isStillnessActive, resetStillness,
} from '../src/combat/rite-stillness';
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

// ── THE LANE THAT ISN'T AN ERUPT ────────────────────────────────────────────
// The vocabulary was nova/cost/heal/selfBuff, so five rites read as one rite at
// five sizes. These pin the two kinds that change how a fight is PLAYED.

test('the catalog has rites that deal no damage at all', () => {
  const nonDamaging = Object.values(RITES).filter(
    (r) => resolveRite(r, 6).every((e) => e.kind !== 'nova'),
  );
  assert.ok(nonDamaging.length >= 2,
    'every rite still ends a fight faster — the active lane is one idea in five costumes');
});

test('THE LONG SECOND holds the world and never the player', () => {
  const r = resolveRite(RITES['longsecond'], 0);
  const st = r.find((e) => e.kind === 'stillness');
  assert.ok(st && st.kind === 'stillness', 'no stillness effect');
  assert.ok(st.kind === 'stillness' && st.seconds > 0 && st.seconds <= 4,
    'a stillness you can plan inside is a stillness that trivialises the room');
  assert.ok(RITES['longsecond'].hungerCost >= 80,
    'the strongest thing in the catalog must cost nearly the whole meter');
});

test('the held world snaps back to normal on its own', () => {
  resetStillness();
  assert.equal(getStillnessTimeScale(), 1, 'the world was slow before anything cast');
  enterStillness(1.0, 0.1);
  assert.ok(getStillnessTimeScale() < 0.5, 'the world did not actually slow');
  assert.equal(isStillnessActive(), true);
  tickStillness(2.0);
  assert.equal(getStillnessTimeScale(), 1, 'the world never came back — the run is now unplayable');
  assert.equal(isStillnessActive(), false);
});

test('a second cast extends rather than truncating what you had', () => {
  // The failure this prevents: casting again near the end of a Stillness
  // restarting a SHORTER timer and cutting the window off early.
  resetStillness();
  enterStillness(4.0, 0.1);
  enterStillness(1.0, 0.1);
  tickStillness(1.5);
  assert.equal(isStillnessActive(), true, 'the shorter cast cut the longer one short');
  resetStillness();
});

test('a floor load never arrives with the world still held', () => {
  enterStillness(30, 0.1);
  resetStillness();
  assert.equal(getStillnessTimeScale(), 1);
});

test('STEP-THROUGH is movement, and it grows into more movement', () => {
  const base = resolveRite(RITES['stepthrough'], 0);
  const built = resolveRite(RITES['stepthrough'], 2);
  const dist = (es: ReturnType<typeof resolveRite>) =>
    es.reduce((n, e) => n + (e.kind === 'blink' ? e.distance : 0), 0);
  assert.ok(dist(base) > 0, 'the blink has no distance');
  assert.ok(dist(built) > dist(base), 'commitment does not carry you further');
  assert.ok(base.every((e) => e.kind !== 'cost'), 'a traversal verb must not cost blood to use');
  assert.ok(RITES['stepthrough'].hungerCost < RITES['longsecond'].hungerCost / 2,
    'cheap enough to lean on is the whole point');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
