// Room types (src/level/room-types.ts) — the table that says what a room IS,
// what it may host, and what may HAPPEN in it.
//
// Two things are guarded here:
//   1. The legacy ROLE_CAPS projection is UNCHANGED. floor-roles now derives its
//      caps from the type table instead of hardcoding them; if that derivation
//      ever drifts, every build pass silently changes behaviour. These are the
//      exact values the table replaced.
//   2. The design invariants: one centrepiece max, a shop refuses everything,
//      reward rooms are a breath (no enemies).

import assert from 'node:assert/strict';
import { ROLE_CAPS, assignFloorRoles, assignRoleRooms, type RoomNode } from '../src/level/floor-roles';
import {
  ROOM_TYPES, roomType, acceptsModifier, assignableTypes, hasCentrepiece,
  type RoomTypeId,
} from '../src/level/room-types';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// The values ROLE_CAPS held before the table became the source of truth.
const LEGACY = {
  entrance: { allowCombat: false, allowBonfire: false, allowEvent: false, allowLoot: true,  bonfirePref: 0 },
  combat:   { allowCombat: true,  allowBonfire: true,  allowEvent: true,  allowLoot: true,  bonfirePref: 1 },
  feature:  { allowCombat: true,  allowBonfire: true,  allowEvent: true,  allowLoot: true,  bonfirePref: 3 },
  sanctum:  { allowCombat: false, allowBonfire: true,  allowEvent: false, allowLoot: false, bonfirePref: 5 },
  finish:   { allowCombat: true,  allowBonfire: false, allowEvent: false, allowLoot: false, bonfirePref: 0 },
  quiet:    { allowCombat: false, allowBonfire: true,  allowEvent: true,  allowLoot: true,  bonfirePref: 4 },
  miniboss: { allowCombat: false, allowBonfire: false, allowEvent: false, allowLoot: false, bonfirePref: 0 },
  boss:     { allowCombat: false, allowBonfire: false, allowEvent: false, allowLoot: false, bonfirePref: 0 },
} as const;

test('derived ROLE_CAPS match the values they replaced (no behaviour drift)', () => {
  for (const [role, expected] of Object.entries(LEGACY)) {
    assert.deepEqual(
      ROLE_CAPS[role as keyof typeof LEGACY], expected,
      `${role} caps drifted — every build pass reading them just changed behaviour`,
    );
  }
});

test('every type declares exactly one centrepiece slot (zero or one, never many)', () => {
  for (const id of Object.keys(ROOM_TYPES) as RoomTypeId[]) {
    const c = roomType(id).centrepiece;
    assert.equal(typeof c, 'string', `${id} has no centrepiece field`);
  }
});

test('a shop refuses EVERY modifier — you never fight beside a vendor', () => {
  assert.equal(ROOM_TYPES.shop.modifiers.length, 0);
  for (const mod of ['ambush', 'contested', 'toll', 'hazard', 'gated', 'dark'] as const) {
    assert.equal(acceptsModifier('shop', mod), false, `shop accepted ${mod}`);
  }
  assert.equal(ROOM_TYPES.shop.enemies, false, 'a shop must never seed enemies');
});

test('a reward room can be fought for or paid for, but never sprung on you', () => {
  // contested (reach for it and answer) and toll (pay the way in) are costs you
  // SEE COMING. ambush is sprung — a trove must never do that.
  assert.equal(acceptsModifier('trove', 'contested'), true);
  assert.equal(acceptsModifier('trove', 'toll'), true);
  assert.equal(acceptsModifier('trove', 'ambush'), false, 'a trove must never ambush');
});

test('the priced descent exists — finish accepts a toll (the blood door)', () => {
  assert.equal(acceptsModifier('finish', 'toll'), true);
});

test('the arena is a TYPE, not a modifier — its identity is the gauntlet', () => {
  assert.equal(ROOM_TYPES.arena.centrepiece, 'gauntlet');
  assert.equal(ROOM_TYPES.arena.kind, 'role');
  assert.equal(ROOM_TYPES.arena.enemies, true);
});

test('reward rooms are a breath — no enemies in the trove or the sanctum', () => {
  assert.equal(ROOM_TYPES.trove.enemies, false);
  assert.equal(ROOM_TYPES.sanctum.enemies, false);
});

test('a fountain-ish feature room ACCEPTS an ambush (the trap that was a gift)', () => {
  assert.equal(acceptsModifier('feature', 'ambush'), true);
  assert.equal(acceptsModifier('combat', 'ambush'), true);
});

test('structural arenas take no modifiers — the fight is the room', () => {
  for (const id of ['boss', 'miniboss'] as const) {
    assert.equal(ROOM_TYPES[id].modifiers.length, 0, `${id} should refuse modifiers`);
    assert.equal(ROOM_TYPES[id].kind, 'structural');
  }
});

test('only role kinds are assignable; structural and plain are not', () => {
  const assignable = assignableTypes();
  assert.ok(assignable.includes('trove'), 'trove should be assignable');
  assert.ok(assignable.includes('arena'), 'arena should be assignable');
  assert.ok(assignable.includes('shop'), 'shop should be assignable');
  assert.ok(!assignable.includes('boss'), 'boss is placed, never assigned');
  assert.ok(!assignable.includes('combat'), 'combat is the fallback, never assigned');
  for (const id of assignable) assert.equal(ROOM_TYPES[id].kind, 'role');
});

test('plain rooms are the connective majority — no centrepiece', () => {
  assert.equal(hasCentrepiece('combat'), false);
  assert.equal(hasCentrepiece('quiet'), false);
  assert.equal(hasCentrepiece('entrance'), false);
  // …and the notable ones do have one.
  assert.equal(hasCentrepiece('trove'), true);
  assert.equal(hasCentrepiece('boss'), true);
});

test('an unknown type falls back to plain combat rather than throwing', () => {
  assert.equal(roomType('no-such-room').centrepiece, 'none');
  assert.equal(roomType('no-such-room').enemies, true);
});

// ── Role-room ASSIGNMENT (the second pass) ─────────────────────────
// The budget is the design: a landmark only reads as one when most rooms
// aren't, so this must promote a FEW rooms and leave the rest connective.

function mkNodes(n: number): RoomNode[] {
  return Array.from({ length: n }, (_, i) => ({
    roomId: `r${i}`,
    tags: [] as string[],
    slot: (i === 0 ? 'start' : i === n - 1 ? 'end' : 'mid') as RoomNode['slot'],
    connections: i === 0 || i === n - 1 ? 1 : 2,
  }));
}
/** Deterministic rand for reproducible assignment. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('every non-boss floor gets exactly ONE guaranteed trove', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const nodes = mkNodes(7);
    const roles = assignFloorRoles(nodes, { isBossFloor: false });
    assignRoleRooms(roles, nodes, { depth: 5, rand: seeded(seed), isBossFloor: false });
    const troves = nodes.filter((n) => roles.role(n.roomId) === 'trove').length;
    assert.equal(troves, 1, `seed ${seed}: expected 1 trove, got ${troves}`);
  }
});

test('a boss floor gets NO role rooms — the boss is the floor', () => {
  const nodes = mkNodes(6);
  const roles = assignFloorRoles(nodes, { isBossFloor: true });
  const plan = assignRoleRooms(roles, nodes, { depth: 8, rand: seeded(3), isBossFloor: true });
  assert.equal(plan.assigned.size, 0);
});

test('most rooms stay connective — at least one plain room always survives', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const nodes = mkNodes(6);
    const roles = assignFloorRoles(nodes, { isBossFloor: false });
    assignRoleRooms(roles, nodes, { depth: 9, rand: seeded(seed), isBossFloor: false });
    const plain = nodes.filter((n) => !hasCentrepiece(roles.role(n.roomId))).length;
    assert.ok(plain >= 1, `seed ${seed}: every room became a landmark`);
  }
});

test('structural rooms are never overwritten by a promotion', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const nodes = mkNodes(6);
    const roles = assignFloorRoles(nodes, { isBossFloor: false });
    const before = roles.role(nodes[0].roomId);         // the entrance
    assignRoleRooms(roles, nodes, { depth: 7, rand: seeded(seed), isBossFloor: false });
    assert.equal(roles.role(nodes[0].roomId), before, 'the entrance was promoted');
    assert.equal(before, 'entrance');
  }
});

test('a role is never assigned twice on one floor', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const nodes = mkNodes(8);
    const roles = assignFloorRoles(nodes, { isBossFloor: false });
    const plan = assignRoleRooms(roles, nodes, { depth: 9, rand: seeded(seed), isBossFloor: false });
    const seen = [...plan.assigned.values()];
    assert.equal(new Set(seen).size, seen.length, `seed ${seed}: duplicate role ${seen}`);
  }
});

test('depth gates the pool — no shop or arena on floor 1', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const nodes = mkNodes(7);
    const roles = assignFloorRoles(nodes, { isBossFloor: false });
    const plan = assignRoleRooms(roles, nodes, { depth: 1, rand: seeded(seed), isBossFloor: false });
    for (const role of plan.assigned.values()) {
      assert.ok(role === 'trove', `depth 1 assigned ${role} — only the trove is depth-1 eligible`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
