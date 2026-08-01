// The Floor Director — the manager that owns the floor content plan
// (docs/FLOOR-DIRECTOR.md). Locks: the variety ledger (no spamming one deal
// kind), depth-appropriate deal tension, find/deal never share a marker, and
// determinism.
//
//   npm test

import assert from 'node:assert/strict';
import { assignFloorRoles, type RoomNode } from '../src/level/floor-roles';
import { fillQuestion, type ContentSpot, type DealKind } from '../src/level/floor-fill';
import { directFloor, countDeals } from '../src/level/floor-director';
import type { PropSpec } from '../src/level/types';

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

const NODES: RoomNode[] = [
  { roomId: 'vault-0', tags: ['start'],    slot: 'start',  connections: 1 },
  { roomId: 'vault-1', tags: ['combat'],   slot: 'mid',    connections: 2 },
  { roomId: 'vault-2', tags: ['exit'],     slot: 'end',    connections: 1 },
  { roomId: 'branch-3', tags: ['treasure'], slot: 'branch', connections: 1 },
];
const roles = assignFloorRoles(NODES, { isBossFloor: false });
const spot = (roomId: string, focal = false): ContentSpot => ({ x: 0, z: 0, roomId, focal });
const deal = (kind: DealKind): PropSpec => ({ kind, x: 0, z: 0 } as PropSpec);

// ── countDeals ──
test('countDeals tallies deal kinds and ignores others', () => {
  const c = countDeals([deal('fountain'), deal('fountain'), deal('altar'), { kind: 'chest', x: 0, z: 0 } as PropSpec]);
  assert.equal(c.fountain, 2);
  assert.equal(c.altar, 1);
  assert.equal(c['blood-altar'], undefined);
});

// ── fillQuestion ──
test('fillQuestion returns null with no allowed kinds', () => {
  assert.equal(fillQuestion([spot('branch-3', true)], roles, [], 3, 6, lcg(1)), null);
});
test('fillQuestion only ever returns an allowed kind', () => {
  for (let seed = 0; seed < 40; seed++) {
    const r = fillQuestion([spot('branch-3', true)], roles, ['tithe-basin'], 3, 6, lcg(seed));
    assert.ok(r && r.kind === 'tithe-basin');
  }
});
test('fillQuestion needs an EVENT-permitting room (finish is not one)', () => {
  assert.equal(fillQuestion([spot('vault-2', true)], roles, ['fountain'], 3, 6, lcg(1)), null);
});
test('fillQuestion prefers the depth band: shallow→survivable, deep→threatening', () => {
  const allowed: DealKind[] = ['fountain', 'blood-altar'];
  for (let seed = 0; seed < 40; seed++) {
    assert.equal(fillQuestion([spot('branch-3', true)], roles, allowed, 2, 6, lcg(seed))!.kind, 'fountain');
    assert.equal(fillQuestion([spot('branch-3', true)], roles, allowed, 9, 6, lcg(seed))!.kind, 'blood-altar');
  }
});
test('fillQuestion never lands on the excluded (find) spot', () => {
  const a = spot('branch-3', true), b = spot('vault-1', true);
  for (let seed = 0; seed < 30; seed++) {
    const r = fillQuestion([a, b], roles, ['fountain'], 3, 6, lcg(seed), a);
    assert.equal(r!.roomId, 'vault-1', 'excluded spot A must be skipped');
  }
});

// ── directFloor: variety ledger ──
test('VARIETY: the director never stages a 2nd fountain when one already exists', () => {
  let deals = 0, fountains = 0;
  for (let seed = 0; seed < 300; seed++) {
    const plan = directFloor({
      depth: 3, rand: lcg(seed), roles,
      fireAnchors: [], fireFallbackCells: [],
      contentSpots: [spot('branch-3', true)],
      bakedProps: [deal('fountain')],   // the floor already has a heal fountain
    });
    if (plan.deal) { deals++; if (plan.deal.kind === 'fountain') fountains++; }
  }
  assert.ok(deals > 0, 'some floors should stage a deal');
  assert.equal(fountains, 0, 'NEVER a second heal fountain — variety holds');
});

test('with a clean floor the director CAN stage a fountain', () => {
  let fountains = 0;
  for (let seed = 0; seed < 300; seed++) {
    const plan = directFloor({
      depth: 2, rand: lcg(seed), roles,
      fireAnchors: [], fireFallbackCells: [],
      contentSpots: [spot('branch-3', true)], bakedProps: [],
    });
    if (plan.deal?.kind === 'fountain') fountains++;
  }
  assert.ok(fountains > 0, 'a fountain is allowed when the floor has none');
});

// ── directFloor: SPREAD the major beats across rooms ──
test('SPREAD: fire, find, and deal land in DIFFERENT rooms when rooms are free', () => {
  // Three event-capable rooms so each beat can get its own home.
  const nodes3: RoomNode[] = [
    { roomId: 'start-0', tags: ['start'], slot: 'start', connections: 1 },
    { roomId: 'mid-1', tags: ['combat'], slot: 'mid', connections: 3 },
    { roomId: 'branch-2', tags: ['treasure'], slot: 'branch', connections: 1 },
    { roomId: 'branch-3', tags: ['treasure'], slot: 'branch', connections: 1 },
    { roomId: 'exit-4', tags: ['exit'], slot: 'end', connections: 1 },
  ];
  const roles3 = assignFloorRoles(nodes3, { isBossFloor: false });
  let checkedFind = 0, checkedDeal = 0;
  for (let seed = 0; seed < 400; seed++) {
    const plan = directFloor({
      depth: 4, rand: lcg(seed), roles: roles3,
      fireAnchors: [{ x: 0, z: 0, roomId: 'mid-1' }],
      fireFallbackCells: [],
      contentSpots: [spot('mid-1', true), spot('branch-2', true), spot('branch-3', true)],
      bakedProps: [],
    });
    if (plan.fire && plan.find) {
      checkedFind++;
      assert.notEqual(plan.find.spot.roomId, plan.fire.roomId, 'find must not share the fire\'s room');
    }
    if (plan.fire && plan.find && plan.deal) {
      checkedDeal++;
      assert.notEqual(plan.deal.roomId, plan.fire.roomId, 'deal must avoid the fire\'s room');
      assert.notEqual(plan.deal.roomId, plan.find.spot.roomId, 'deal must avoid the find\'s room');
    }
  }
  assert.ok(checkedFind > 0, 'some floors place both a fire and a find');
  assert.ok(checkedDeal > 0, 'some floors place a fire, a find, AND a deal');
});

test('directFloor is deterministic — same inputs + seed → same plan', () => {
  const mk = () => directFloor({
    depth: 5, rand: lcg(4242), roles,
    fireAnchors: [], fireFallbackCells: [],
    contentSpots: [spot('branch-3', true), spot('vault-1', false)], bakedProps: [],
  });
  assert.deepEqual(mk(), mk());
});

test('directFloor always returns a combat budget', () => {
  const plan = directFloor({
    depth: 5, rand: lcg(1), roles,
    fireAnchors: [], fireFallbackCells: [], contentSpots: [], bakedProps: [],
  });
  assert.equal(typeof plan.budget.combat.count, 'number');
  assert.ok(plan.budget.combat.count >= 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
