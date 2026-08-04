// Room modifiers (src/level/room-modifiers.ts) — what HAPPENS around a room's
// centrepiece, layered on top of identity.
//
// The invariants worth pinning are the RESTRAINTS, because they're what stops a
// floor turning into soup and they're the first thing a tuning pass erodes:
// a refusal in the type table is absolute, one modifier per room, a couple of
// rooms per floor, and nothing assigned that nothing expresses.

import assert from 'node:assert/strict';
import { assignFloorRoles, assignRoleRooms, type RoomNode } from '../src/level/floor-roles';
import { assignModifiers, WIRED_MODIFIERS } from '../src/level/room-modifiers';
import { acceptsModifier, roomType, hasCentrepiece } from '../src/level/room-types';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function mkNodes(n: number): RoomNode[] {
  return Array.from({ length: n }, (_, i) => ({
    roomId: `r${i}`,
    tags: [] as string[],
    slot: (i === 0 ? 'start' : i === n - 1 ? 'end' : 'mid') as RoomNode['slot'],
    connections: i === 0 || i === n - 1 ? 1 : 2,
  }));
}

/** A composed floor: roles assigned, role rooms promoted, modifiers laid on. */
function floor(seed: number, depth: number, rooms = 8) {
  const nodes = mkNodes(rooms);
  const roles = assignFloorRoles(nodes, { isBossFloor: false });
  assignRoleRooms(roles, nodes, { depth, rand: seeded(seed), isBossFloor: false });
  const plan = assignModifiers(roles, nodes, { depth, rand: seeded(seed * 31), isBossFloor: false });
  return { nodes, roles, plan };
}

test('a modifier is only ever laid on a room whose TYPE tolerates it', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const depth of [2, 4, 6, 9]) {
      const { roles, plan } = floor(seed, depth);
      for (const [roomId, mod] of plan.byRoom) {
        assert.ok(
          acceptsModifier(roles.role(roomId), mod.kind),
          `seed ${seed} d${depth}: ${roles.role(roomId)} was given ${mod.kind}, which it refuses`,
        );
      }
    }
  }
});

test('a shop is NEVER modified — you never fight beside a vendor', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const { roles, plan } = floor(seed, 7);
    for (const roomId of plan.byRoom.keys()) {
      assert.notEqual(roles.role(roomId), 'shop', `seed ${seed}: a shop got modified`);
    }
  }
});

test('restraint holds — at most two rooms on a floor carry a modifier', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const { plan } = floor(seed, 9);
    assert.ok(plan.byRoom.size <= 2, `seed ${seed}: ${plan.byRoom.size} rooms modified`);
  }
});

test('one modifier per room — a room is the dark one OR the trapped one', () => {
  // byRoom is a Map keyed by room, so this is structural; the test pins the
  // CONTRACT so a future "modifiers: AppliedModifier[]" change is a deliberate
  // design decision rather than a quiet type widening.
  const { plan } = floor(5, 9);
  for (const mod of plan.byRoom.values()) {
    assert.equal(typeof mod.kind, 'string');
  }
});

test('nothing is assigned that nothing EXPRESSES', () => {
  for (let seed = 1; seed <= 80; seed++) {
    for (const depth of [2, 5, 9]) {
      const { plan } = floor(seed, depth);
      for (const mod of plan.byRoom.values()) {
        assert.ok(
          WIRED_MODIFIERS.includes(mod.kind),
          `${mod.kind} was assigned but nothing renders it — a silent no-op`,
        );
      }
    }
  }
});

test('floor 1 is never modified — the first descent teaches the plain shape', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { plan } = floor(seed, 1);
    assert.equal(plan.byRoom.size, 0, `seed ${seed}: depth 1 got ${[...plan.byRoom.values()].map((m) => m.kind)}`);
  }
});

test('a boss floor gets none — nothing interrupts the walk in', () => {
  const nodes = mkNodes(6);
  const roles = assignFloorRoles(nodes, { isBossFloor: true });
  const plan = assignModifiers(roles, nodes, { depth: 8, rand: seeded(3), isBossFloor: true });
  assert.equal(plan.byRoom.size, 0);
});

test('CONTESTED only lands where there is something to reach FOR', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const { roles, plan } = floor(seed, 9);
    for (const [roomId, mod] of plan.byRoom) {
      if (mod.kind !== 'contested') continue;
      const role = roles.role(roomId);
      assert.ok(hasCentrepiece(role), `seed ${seed}: contested on ${role}, which stages nothing`);
      // …and specifically something with a TAKE the build can intercept.
      assert.ok(
        ['offerings', 'hazard'].includes(roomType(role).centrepiece),
        `seed ${seed}: contested on a ${roomType(role).centrepiece} centrepiece, which has no take to guard`,
      );
    }
  }
});

test('the sealing modifiers carry a wave count; the dressing ones do not', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 120; seed++) {
    for (const mod of floor(seed, 9).plan.byRoom.values()) {
      seen.add(mod.kind);
      if (mod.kind === 'ambush' || mod.kind === 'contested') {
        assert.ok(mod.waves !== undefined && mod.waves >= 1 && mod.waves <= 3,
          `${mod.kind} needs a 1-3 wave count, got ${mod.waves}`);
      } else {
        assert.equal(mod.waves, undefined, `${mod.kind} should not declare waves`);
      }
    }
  }
  assert.ok(seen.has('ambush'), 'deep floors should roll an ambush at least once in 120 seeds');
});

test('DETERMINISTIC per seed — a floor replays with the same danger', () => {
  const a = [...floor(17, 8).plan.byRoom.entries()];
  const b = [...floor(17, 8).plan.byRoom.entries()];
  assert.deepEqual(a, b);
});

test('depth gates the pool — no contested rooms in the shallows', () => {
  for (let seed = 1; seed <= 80; seed++) {
    for (const mod of floor(seed, 3).plan.byRoom.values()) {
      assert.notEqual(mod.kind, 'contested', `seed ${seed}: contested at depth 3`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
