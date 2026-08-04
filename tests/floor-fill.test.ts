// The FILL stage — staging a defining find onto a content marker
// (docs/FLOOR-DIRECTOR.md step 2). Locks: budget gate, role-gating (loot only
// lands in loot-permitting rooms), focal preference, and determinism.
//
//   npm test

import assert from 'node:assert/strict';
import { assignFloorRoles, type RoomNode } from '../src/level/floor-roles';
import { fillDefiningFind, fillQuestion, type ContentSpot } from '../src/level/floor-fill';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  const step = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  step(); step(); step();
  return step;
}

// A floor: entrance, a plain combat mid, a treasure branch (feature), and the exit.
const NODES: RoomNode[] = [
  { roomId: 'vault-0', tags: ['start'],   slot: 'start',  connections: 1 },
  { roomId: 'vault-1', tags: ['combat'],  slot: 'mid',    connections: 2 },
  { roomId: 'vault-2', tags: ['exit'],    slot: 'end',    connections: 1 },
  { roomId: 'branch-3', tags: ['treasure'], slot: 'branch', connections: 1 },
];
const roles = assignFloorRoles(NODES, { isBossFloor: false });
const GRANT = { definingFind: true, minRarity: 'uncommon' as const };

const spot = (roomId: string, focal = false): ContentSpot => ({ x: 0, z: 0, roomId, focal });

test('no budget → no find', () => {
  const r = fillDefiningFind([spot('branch-3', true)], roles, { definingFind: false, minRarity: 'uncommon' }, 3, lcg(1));
  assert.equal(r, null);
});

test('no eligible marker → no find (never a forced drop)', () => {
  // A spot only in the FINISH room (allowLoot=false) is not eligible.
  const r = fillDefiningFind([spot('vault-2', true)], roles, GRANT, 3, lcg(1));
  assert.equal(r, null);
});

test('an empty marker list → no find', () => {
  assert.equal(fillDefiningFind([], roles, GRANT, 3, lcg(1)), null);
});

test('a focal marker in a loot-permitting room yields a find with loot', () => {
  const r = fillDefiningFind([spot('branch-3', true)], roles, GRANT, 5, lcg(7));
  assert.ok(r, 'expected a find');
  // The find carries a CHEST BUNDLE, not a lone item. It used to be a single
  // ItemSpec, which meant every branch of its table that wasn't an item silently
  // became "no find at all" — and the branch that was an item was always a relic.
  // A staged chest is worth walking to when it holds something; what that
  // something is, is a roll.
  assert.ok(r!.loot, 'find carries no bundle');
  assert.ok(r!.loot.items.length > 0 || r!.loot.gold > 0, 'the staged chest is empty');
  assert.equal(r!.roomId, 'branch-3');
});

test('the find lands in the loot room, not the finish room', () => {
  // Two spots: one in the exit (ineligible), one in the treasure branch.
  const r = fillDefiningFind([spot('vault-2', true), spot('branch-3', true)], roles, GRANT, 5, lcg(3));
  assert.ok(r);
  assert.equal(r!.roomId, 'branch-3');
});

test('SECONDARY (off-centre) spots are preferred over focal ones for the reward', () => {
  // The room centre (focal) is the EVENT's; a reward chest is a SECONDARY read
  // (#69/#72), so the find prefers the non-focal spot. Secondary in vault-1,
  // focal in branch-3 → the find takes the secondary every time.
  const spots = [spot('vault-1', false), spot('branch-3', true)];
  for (let seed = 0; seed < 30; seed++) {
    const r = fillDefiningFind(spots, roles, GRANT, 5, lcg(seed));
    assert.equal(r!.roomId, 'vault-1', `seed ${seed} should pick the secondary spot`);
  }
});

test('the find falls back to a focal spot when no secondary exists', () => {
  // Only focal spots available → the reward still places (tiny/event rooms).
  const r = fillDefiningFind([spot('branch-3', true)], roles, GRANT, 5, lcg(4));
  assert.ok(r, 'expected a find');
  assert.equal(r!.roomId, 'branch-3');
});

test('a combat room permits loot (role-gating is by CAPS, not name)', () => {
  const r = fillDefiningFind([spot('vault-1', true)], roles, GRANT, 5, lcg(2));
  assert.ok(r, 'combat rooms allow loot, so a find can land there');
  assert.equal(r!.roomId, 'vault-1');
});

test('deterministic — same inputs → same find', () => {
  const spots = [spot('vault-1', false), spot('branch-3', true)];
  const a = fillDefiningFind(spots, roles, GRANT, 6, lcg(999));
  const b = fillDefiningFind(spots, roles, GRANT, 6, lcg(999));
  assert.deepEqual(a, b);
});

// ── fillQuestion: SMART PLACEMENT — keep the question out of the find's room ──

const at = (roomId: string, x: number, z: number, focal = false): ContentSpot => ({ x, z, roomId, focal });

test('the question avoids the find\'s room when another room is available', () => {
  // find claimed a spot in branch-3; a marker exists in both branch-3 and vault-1.
  const findSpot = at('branch-3', 0, 0, true);
  const spots = [at('branch-3', 1, 0, true), at('vault-1', 5, 5, false)];
  for (let seed = 0; seed < 30; seed++) {
    const r = fillQuestion(spots, roles, ['fountain'], 3, 6, lcg(seed), findSpot);
    assert.ok(r, `seed ${seed}: expected a deal`);
    assert.equal(r!.roomId, 'vault-1', `seed ${seed}: deal should leave the find's room`);
  }
});

test('forced to share the find\'s room, the question keeps its distance', () => {
  // Only branch-3 has eligible markers: one on top of the find, one 5m away.
  const findSpot = at('branch-3', 0, 0, true);
  const spots = [at('branch-3', 0, 0, true), at('branch-3', 5, 0, true)];
  for (let seed = 0; seed < 30; seed++) {
    const r = fillQuestion(spots, roles, ['fountain'], 3, 6, lcg(seed), findSpot);
    assert.ok(r, `seed ${seed}: expected a deal`);
    assert.ok((r!.x - findSpot.x) ** 2 + (r!.z - findSpot.z) ** 2 >= 16, `seed ${seed}: deal too close to find`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
