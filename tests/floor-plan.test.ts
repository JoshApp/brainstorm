// Floor plan (src/level/floor-plan.ts) — what a floor OWES you, decided before
// any geometry exists, plus the placement preferences that decide where each
// entry lands.
//
// The invariant this whole module exists for: a floor's content must NOT be a
// consequence of its shape. If these pass, a floor that wants a trove gets one
// regardless of which rooms the seed happened to grow.

import assert from 'node:assert/strict';
import { planFloor, dedicatedEntries, requiredLeafCount, isTroveFloor } from '../src/level/floor-plan';
import { assignFloorRoles, assignRoleRooms, type RoomNode } from '../src/level/floor-roles';
import { roomType } from '../src/level/room-types';

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

/** A floor shaped like a spine with `leaves` dead-end spurs hanging off it. */
function mkFloor(mids: number, leaves: number): RoomNode[] {
  const nodes: RoomNode[] = [];
  const n = mids + 2;
  for (let i = 0; i < n; i++) {
    nodes.push({
      roomId: `r${i}`, tags: [],
      slot: i === 0 ? 'start' : i === n - 1 ? 'end' : 'mid',
      connections: i === 0 || i === n - 1 ? 1 : 2,
    });
  }
  for (let i = 0; i < leaves; i++) {
    nodes.push({ roomId: `leaf${i}`, tags: [], slot: 'branch', connections: 1 });
  }
  return nodes;
}

// ── THE CONTRACT ─────────────────────────────────────────────────────

test('every non-boss floor is owed an OFFER — though not always the trove', () => {
  // The SLOT is the guarantee, not the thing that fills it. A trove every floor
  // stops being a beat and becomes a checkpoint; a bargain is the same promise
  // in another shape.
  for (let seed = 1; seed <= 60; seed++) {
    for (const depth of [1, 2, 3, 5, 6, 9]) {
      const plan = planFloor(depth, seeded(seed * 13 + depth));
      assert.ok(
        plan.required.some((e) => e.role === 'offer'),
        `d${depth} seed ${seed}: the offer slot was left empty`,
      );
    }
  }
});

test('the TROVE lands once per act — an event you look forward to', () => {
  // Act 1 is depths 1-3 with the boss at 3, so exactly one of {1,2} is the
  // trove floor. Same shape for the deeper acts.
  for (const act of [[1, 2], [4, 5, 6], [8, 9, 10, 11]]) {
    const troveFloors = act.filter((d) => isTroveFloor(d));
    assert.equal(troveFloors.length, 1, `act ${act}: ${troveFloors.length} trove floors`);
  }
});

test('a trove floor plans a trove; every other floor plans a bargain instead', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const depth of [1, 2, 4, 5, 6, 9]) {
      const plan = planFloor(depth, seeded(seed * 7 + depth));
      const offer = plan.required.find((e) => e.role === 'offer');
      assert.ok(offer, `d${depth}: no offer`);
      assert.equal(offer.id, isTroveFloor(depth) ? 'trove' : 'feature', `d${depth} offer mismatch`);
    }
  }
});

test('a boss floor plans NOTHING — the boss is the whole contract', () => {
  const plan = planFloor(8, seeded(3), { isBossFloor: true });
  assert.equal(plan.all.length, 0);
});

test('MERCY may roll empty — a floor that gives nothing back is the point', () => {
  // If every floor had a mercy, the fire stops meaning anything. This asserts
  // the slot is genuinely optional across a sweep, not that it never lands.
  let withMercy = 0;
  for (let seed = 1; seed <= 120; seed++) {
    if (planFloor(7, seeded(seed)).all.some((e) => e.role === 'mercy')) withMercy++;
  }
  assert.ok(withMercy > 0, 'mercy should sometimes land');
  assert.ok(withMercy < 120, 'mercy must NOT be guaranteed — a lean floor is a design beat');
});

test('restraint holds — the trove plus at most two extras', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const plan = planFloor(9, seeded(seed));
    assert.ok(plan.rolled.length <= 2, `${plan.rolled.length} extras`);
    assert.equal(new Set(plan.all.map((e) => e.id)).size, plan.all.length, 'duplicate entry');
  }
});

test('depth gates the pool — floor 1 plans its offer and nothing else', () => {
  // Nothing in the rolled pool is depth-1 eligible, so the first descent is just
  // its offer: one thing to find, and the shape of a room to learn.
  for (let seed = 1; seed <= 40; seed++) {
    const plan = planFloor(1, seeded(seed));
    assert.equal(plan.rolled.length, 0, `floor 1 rolled ${plan.rolled.map((e) => e.id)}`);
    assert.equal(plan.all.length, 1);
    assert.equal(plan.all[0].role, 'offer');
  }
});

test('the geometry knows how many spurs it must grow', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const plan = planFloor(9, seeded(seed));
    assert.equal(requiredLeafCount(plan), dedicatedEntries(plan).length);
    }
});

test('a floor needs a spur only for the entries that actually want one', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const plan = planFloor(9, seeded(seed));
    assert.equal(requiredLeafCount(plan), dedicatedEntries(plan).length);
  }
});

// ── PLACEMENT ────────────────────────────────────────────────────────

/** Place a plan onto a floor shape and report where each entry landed. */
function placeOn(nodes: RoomNode[], depth: number, seed: number) {
  const roles = assignFloorRoles(nodes, { isBossFloor: false });
  const plan = planFloor(depth, seeded(seed));
  const res = assignRoleRooms(roles, nodes, { depth, rand: seeded(seed * 7), isBossFloor: false, plan });
  return {
    rooms: nodes.map((n) => ({ node: n, role: roles.role(n.roomId) })),
    assigned: res.assigned,
  };
}

test('DEDICATED content takes the spurs — a destination you chose to walk to', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const { node, role } of placeOn(mkFloor(4, 3), 9, seed).rooms) {
      if (role !== 'trove' && role !== 'shop' && role !== 'arena') continue;
      assert.ok(node.connections <= 1, `seed ${seed}: ${role} landed on a through-room`);
    }
  }
});

test('ON-PATH content refuses a spur — a trap nobody springs is scenery', () => {
  for (let seed = 1; seed <= 80; seed++) {
    for (const { node, role } of placeOn(mkFloor(4, 3), 9, seed).rooms) {
      if (role !== 'trap') continue;
      assert.ok(node.connections > 1, `seed ${seed}: a trap room landed on a dead end`);
    }
  }
});

test('the contract survives a floor with NO spurs at all', () => {
  // The whole point: content must not be rationed by shape. A spine-only floor
  // still gets its trove — just in a worse spot, which is the right trade.
  for (let seed = 1; seed <= 40; seed++) {
    const placed = placeOn(mkFloor(4, 0), 9, seed).rooms;
    assert.ok(placed.some((p) => p.role === 'trove'), `seed ${seed}: lost the trove to geometry`);
  }
});

test('a floor never becomes wall-to-wall landmarks', () => {
  // Measured over PROMOTED rooms, not "rooms whose type could hold something".
  // A branch defaults to `feature`, whose centrepiece is 'bargain' — but that's
  // permission to host a deal, not a staged one, so counting it here would flag
  // every spur as a landmark before anything was placed.
  for (let seed = 1; seed <= 60; seed++) {
    const { rooms, assigned } = placeOn(mkFloor(4, 3), 9, seed);
    const content = rooms.filter((p) => !roomType(p.role).bookend);
    assert.ok(
      assigned.size <= Math.ceil(content.length / 2),
      `seed ${seed}: ${assigned.size} promoted of ${content.length} content rooms`,
    );
  }
});

test('placement is DETERMINISTIC per seed', () => {
  const a = placeOn(mkFloor(4, 2), 8, 21).rooms.map((p) => `${p.node.roomId}:${p.role}`);
  const b = placeOn(mkFloor(4, 2), 8, 21).rooms.map((p) => `${p.node.roomId}:${p.role}`);
  assert.deepEqual(a, b);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
