// Weapon temper (src/state/weapon-temper.ts) — the blacksmith's persisted
// per-weapon upgrade (#94). Guards: levels key to the weapon id, cap at MAX,
// damage bonus scales with level, and serialize/hydrate round-trips (so a forged
// blade survives a save/floor reload).

import assert from 'node:assert/strict';
import {
  getTemperLevel, canTemper, temperWeapon, temperDamageBonus, clearTemper,
  serializeTemper, hydrateTemper, MAX_TEMPER_LEVEL, TEMPER_DAMAGE_PER_LEVEL,
} from '../src/state/weapon-temper';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('a fresh weapon is un-forged', () => {
  clearTemper();
  assert.equal(getTemperLevel('rusted-sword'), 0);
  assert.equal(temperDamageBonus('rusted-sword'), 0);
  assert.equal(getTemperLevel(undefined), 0);
});

test('tempering raises the level + damage, keyed per weapon', () => {
  clearTemper();
  assert.equal(temperWeapon('scimitar'), 1);
  assert.equal(temperWeapon('scimitar'), 2);
  assert.equal(getTemperLevel('scimitar'), 2);
  assert.equal(temperDamageBonus('scimitar'), 2 * TEMPER_DAMAGE_PER_LEVEL);
  // A different weapon is untouched.
  assert.equal(getTemperLevel('spear'), 0);
});

test('temper caps at MAX_TEMPER_LEVEL', () => {
  clearTemper();
  for (let i = 0; i < MAX_TEMPER_LEVEL + 3; i++) temperWeapon('harrow');
  assert.equal(getTemperLevel('harrow'), MAX_TEMPER_LEVEL);
  assert.equal(canTemper('harrow'), false);
});

test('serialize/hydrate round-trips (survives a save)', () => {
  clearTemper();
  temperWeapon('scimitar'); temperWeapon('scimitar'); temperWeapon('spear');
  const snap = serializeTemper();
  clearTemper();
  assert.equal(getTemperLevel('scimitar'), 0, 'cleared');
  hydrateTemper(snap);
  assert.equal(getTemperLevel('scimitar'), 2, 'restored');
  assert.equal(getTemperLevel('spear'), 1, 'restored');
});

test('hydrate of undefined clears (older saves)', () => {
  temperWeapon('scimitar');
  hydrateTemper(undefined);
  assert.equal(getTemperLevel('scimitar'), 0);
});

clearTemper();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
