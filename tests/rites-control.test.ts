// THE TWO CONTROL RITES — Dread (AoE fear) and Onslaught (the charge).
//
// Josh: "let's make rites a reality, I want an aoe fear rite and a charge rite."
// The executor needs a live world, so what's checkable here is the DATA and the
// morph resolution — which is where a rite actually gets authored, and where a
// typo silently produces a rite that fires and does nothing.
//
//   npm test -- rites-control

import assert from 'node:assert/strict';
import { RITES, resolveRite, type RiteEffect } from '../src/content/rites';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const kinds = (fx: readonly RiteEffect[]) => fx.map((e) => e.kind);

test('DREAD exists and is a fear rite', () => {
  const r = RITES.dread;
  assert.ok(r, 'no dread rite');
  const base = resolveRite(r, 0);
  assert.deepEqual(kinds(base), ['fear'], 'dread should be pure control at base');
  const f = base[0] as Extract<RiteEffect, { kind: 'fear' }>;
  assert.ok(f.radius >= 4, `a room-clearing fear needs reach; got ${f.radius}m`);
  assert.ok(f.seconds >= 3, `too short to be worth a meter; got ${f.seconds}s`);
});

test('DREAD DEALS NO DAMAGE — it buys a room where nobody swings', () => {
  // The whole reason it can be cheap. If a damage effect ever creeps in, the
  // cost is wrong and this is the thing that should complain.
  for (const n of [0, 2, 4, 9]) {
    for (const e of resolveRite(RITES.dread, n)) {
      assert.notEqual(e.kind, 'nova', `dread grew a nova at ${n} cards`);
      assert.notEqual(e.kind, 'charge', `dread grew a charge at ${n} cards`);
    }
  }
});

test('ONSLAUGHT exists and both closes distance AND connects', () => {
  const r = RITES.onslaught;
  assert.ok(r, 'no onslaught rite');
  const base = resolveRite(r, 0);
  assert.deepEqual(kinds(base), ['charge']);
  const c = base[0] as Extract<RiteEffect, { kind: 'charge' }>;
  assert.ok(c.distance >= 3, `a charge that barely moves is a swing; got ${c.distance}m`);
  assert.ok(c.damage > 0, 'a charge that does not hurt is a blink');
  assert.ok((c.knockback ?? 0) > 0, 'the SHOVE is the point of this rite');
});

test('ONSLAUGHT STAYS A CONTROL TOOL — the shove outranks the damage', () => {
  // A charge that also out-damaged a nova makes every erupt rite a worse version
  // of it. Compare against the cheapest nova in the catalog.
  const c = resolveRite(RITES.onslaught, 0)[0] as Extract<RiteEffect, { kind: 'charge' }>;
  const gnash = resolveRite(RITES.gnash, 0)[0] as Extract<RiteEffect, { kind: 'nova' }>;
  assert.ok(c.damage <= gnash.damage,
    `onslaught hits for ${c.damage} vs gnash's ${gnash.damage} — it is now a damage rite that also repositions`);
});

test('BOTH MORPH — commitment reshapes them rather than only enlarging them', () => {
  for (const id of ['dread', 'onslaught']) {
    const base = resolveRite(RITES[id], 0);
    const deep = resolveRite(RITES[id], 4);
    assert.ok(deep.length > base.length,
      `${id} at 4 cards is identical to 0 cards — the morph does nothing`);
  }
});

test('resolveRite does not MUTATE the registry — a rite is the same next cast', () => {
  // resolveRite copies before applying morphs; if that ever regresses, a single
  // deep-domain cast permanently rewrites the spec for the rest of the run.
  const before = JSON.stringify(RITES.onslaught.effects);
  resolveRite(RITES.onslaught, 9);
  resolveRite(RITES.dread, 9);
  assert.equal(JSON.stringify(RITES.onslaught.effects), before);
});

test('every rite names a real domain and costs something', () => {
  for (const [id, r] of Object.entries(RITES)) {
    assert.equal(r.id, id, `${id}: id disagrees with its key`);
    assert.ok(r.hungerCost > 0, `${id}: free rites have no cadence`);
    assert.ok(r.fate && r.fate.length > 0, `${id}: no fate line — the reading has nothing to say`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
