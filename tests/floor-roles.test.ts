// Floor roles — the resolveFloor seam (docs/FLOOR-DIRECTOR.md, step 1).
// Locks the role→caps mapping and the two behaviour-preserving invariants:
// combat-eligibility still equals "every room except the entrance and the boss
// arena", and the bonfire never rests in the exit room.
//
//   npm test

import assert from 'node:assert/strict';
import { assignFloorRoles, ROLE_CAPS, type RoomNode } from '../src/level/floor-roles';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// A representative deep floor: start, three mids (one an authored treasure
// shape), an exit, and a dead-end branch off a mid.
function sampleFloor(): RoomNode[] {
  return [
    { roomId: 'vault-0', tags: ['start'],    slot: 'start',  connections: 1 },
    { roomId: 'vault-1', tags: ['combat'],   slot: 'mid',    connections: 2 },
    { roomId: 'vault-2', tags: ['treasure'], slot: 'mid',    connections: 2 },
    { roomId: 'vault-3', tags: ['combat'],   slot: 'mid',    connections: 3 },
    { roomId: 'vault-4', tags: ['exit'],     slot: 'end',    connections: 1 },
    { roomId: 'branch-5', tags: ['treasure'], slot: 'branch', connections: 1 },
  ];
}

test('start → entrance: no combat, no bonfire, no deal', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  assert.equal(r.role('vault-0'), 'entrance');
  assert.equal(r.caps('vault-0').allowCombat, false);
  assert.equal(r.caps('vault-0').allowBonfire, false);
  assert.equal(r.caps('vault-0').allowEvent, false);
});

test('exit → finish: combat allowed (a guarded exit is fine), but NEVER a bonfire or a deal', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  assert.equal(r.role('vault-4'), 'finish');
  assert.equal(r.caps('vault-4').allowCombat, true);
  assert.equal(r.caps('vault-4').allowBonfire, false);
  assert.equal(r.caps('vault-4').allowEvent, false);
});

test('end slot on a boss floor → boss: neither combat nor fire', () => {
  const floor = sampleFloor();
  floor[4] = { roomId: 'vault-4', tags: ['boss'], slot: 'end', connections: 1 };
  const r = assignFloorRoles(floor, { isBossFloor: true });
  assert.equal(r.role('vault-4'), 'boss');
  assert.equal(r.caps('vault-4').allowCombat, false);
  assert.equal(r.caps('vault-4').allowBonfire, false);
});

test('dead-end branch → feature: a calm pocket that can host the fire', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  assert.equal(r.role('branch-5'), 'feature');
  assert.equal(r.caps('branch-5').allowBonfire, true);
});

test('a treasure/encounter-shaped mid reads as feature; a plain mid is combat', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  assert.equal(r.role('vault-2'), 'feature');  // treasure-tagged mid
  assert.equal(r.role('vault-1'), 'combat');   // plain mid
});

test('INVARIANT: combat-eligible rooms are exactly {everything} minus {entrance, boss}', () => {
  // This preserves the pre-role v3 behaviour (`!isStart && !isBossArena`).
  const floor = sampleFloor();
  floor[4] = { roomId: 'vault-4', tags: ['boss'], slot: 'end', connections: 1 };
  const r = assignFloorRoles(floor, { isBossFloor: true });
  for (const n of floor) {
    const role = r.role(n.roomId);
    const expected = !(role === 'entrance' || role === 'boss');
    assert.equal(r.caps(n.roomId).allowCombat, expected, `${n.roomId} (${role})`);
  }
});

test('bonfireScore: a dead-end feature outscores a through-combat room', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  // branch-5: feature (pref 3) + dead-end bonus (2) = 5
  // vault-1:  combat  (pref 1), through-room (connections 2) = 1
  assert.ok(r.bonfireScore('branch-5') > r.bonfireScore('vault-1'));
  assert.equal(r.bonfireScore('branch-5'), ROLE_CAPS.feature.bonfirePref + 2);
});

test('the exit room is the worst bonfire home (excluded by caps, scores 0)', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  assert.equal(r.caps('vault-4').allowBonfire, false);
  assert.equal(r.bonfireScore('vault-4'), ROLE_CAPS.finish.bonfirePref + 2); // dead-end but pref 0
});

test('designate re-tags a room (the bonfire pass marks its sanctum)', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  r.designate('branch-5', 'sanctum');
  assert.equal(r.role('branch-5'), 'sanctum');
  assert.equal(r.caps('branch-5').allowCombat, false);  // a sanctum holds no fight
});

test('deterministic + total — every room gets a role', () => {
  const r = assignFloorRoles(sampleFloor(), { isBossFloor: false });
  assert.equal(r.entries().size, 6);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
