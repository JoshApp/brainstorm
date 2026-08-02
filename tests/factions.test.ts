// Factions (src/content/factions.ts) — the "count what is what" mechanism.
// Guards the two invariants the room-clear + AI aggro gates depend on: the
// default horde threatens the player, neutral vermin do not, and the maggot is
// actually tagged vermin (so it can never gate a door or hunt you).

import assert from 'node:assert/strict';
import { isHostile, threatensPlayer, DEFAULT_FACTION } from '../src/content/factions';
import { ENEMIES } from '../src/content/enemies';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('the hollow horde hunts the delver; vermin do not', () => {
  assert.equal(isHostile('hollow', 'delver'), true);
  assert.equal(isHostile('vermin', 'delver'), false);
  assert.equal(isHostile('vermin', 'hollow'), false);   // neutral to everything, for now
});

test('threatensPlayer: default + hollow are threats, vermin is not', () => {
  assert.equal(threatensPlayer(undefined), true, 'untagged enemy must read as a threat');
  assert.equal(threatensPlayer(DEFAULT_FACTION), true);
  assert.equal(threatensPlayer('hollow'), true);
  assert.equal(threatensPlayer('vermin'), false);
});

test('every enemy is either an untagged threat or an explicit known faction', () => {
  for (const [id, spec] of Object.entries(ENEMIES)) {
    const f = spec.faction;
    assert.ok(f === undefined || f === 'hollow' || f === 'vermin', `${id} has an unknown faction: ${f}`);
  }
});

test('the maggot is neutral vermin (never gates a room, never aggros)', () => {
  assert.equal(ENEMIES['maggot']?.faction, 'vermin');
  assert.equal(threatensPlayer(ENEMIES['maggot']?.faction), false);
});

test('bosses and standard mobs remain player-threats', () => {
  for (const id of ['rat', 'ghoul', 'skirmisher']) {
    if (ENEMIES[id]) assert.equal(threatensPlayer(ENEMIES[id].faction), true, `${id} must threaten the player`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
