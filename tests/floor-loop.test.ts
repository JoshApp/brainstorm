// A FLOOR THAT IS NOT A TREE.
//
// Every DELVE floor until now was a spine with dead-end pockets hung off it —
// exactly one route between any two rooms, so every room you cleared you also
// walked back out of the way you came, and a fork in a corridor could only be a
// detour you would have to undo.
//
// The reason it had never been otherwise turned out to be geometric, not a
// missing heuristic. `connect()` refuses any pair of rooms that do not share an
// axis exactly, and `stepFrom` puts each new room ON the axis it travelled to
// reach it — so alignment holds between NEIGHBOURS and essentially nowhere
// else. Measured over 72 floors before `connectL` existed: of 383 candidate
// pairs, 82 were a pocket and its own parent, 287 shared no axis, 14 were
// aligned across an intervening room, and ZERO were connectable. Every corridor
// the generator could build joined two rooms that were already joined.
//
// Four things are checked here, and three of them are bugs this pass shipped
// before they were caught:
//
//   1. THE CYCLE IS REAL, on most floors. A loop that fires on 0% of seeds
//      type-checks and passes every other test — the first working version did
//      exactly that.
//   2. THE FLOOR STILL HAS A DEAD END. The loop wants a pocket, and the first
//      version let it take any of them. Cobwebs across 72 floors went to ZERO,
//      because a web only hangs in a room with one exit — the webs were the
//      symptom, the floor quietly spending the detour floor-plan.ts owed it was
//      the disease.
//   3. THE LOOP IS NOT THE ROUTE. `mainlineRooms` is a shortest-path BFS; hand
//      it the loop and the mainline cuts the corner, dropping the room it
//      skipped and un-gating that room's content.
//   4. THE DESCENT SURVIVES. A loop decides no elevation, so when the forced
//      final drop landed on one it was simply discarded — 17 of 20 sampled
//      floors stopped descending at all.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import type { LevelSpec, RoomSpec } from '../src/level/types';
import { setFlatFloors } from '../src/level/poly-elevation';
// ELEVATION IS TEMPORARILY OFF (2026-08-17): floors build dead level while the
// corridor CONNECTION work is done, so a seam defect cannot be a bad cut and a
// misplaced ramp at the same time. See level/poly-elevation.ts, flatFloors.
//
// This file tests the elevation pass, so it turns it back on for its own run —
// same reasoning as tests/corridor-decor and tests/poly-dressing. A stage flag
// meaning "not yet" must not also mean "stop checking", because the entire plan is
// that elevation comes back once the seam is known good, and it should come back
// to a suite that never stopped holding it.
setFlatFloors(false);


let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444, 555, 66, 777, 8888];
const DEPTHS = [1, 2, 5, 6, 8, 11];
const FLOORS = SEEDS.flatMap((seed) => DEPTHS.map((depth) => ({
  seed, depth, spec: generatePolyFloor(depth, seed),
})));

/** The loop edge's legs, if this floor got one. */
const loopLegs = (spec: LevelSpec): RoomSpec[] =>
  spec.corridors.filter((c) => /^cor-l\d/.test(c.id));

/**
 * Which rooms each corridor rect touches — the floor's adjacency, read off the
 * finished geometry rather than off the link list the generator kept. A graph
 * built from the generator's own bookkeeping would agree with itself no matter
 * what it actually built.
 */
function roomGraph(spec: LevelSpec): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  const rooms = spec.rooms.filter((r) => !r.logicalOnly);
  for (const r of rooms) if (!adj.has(r.id)) adj.set(r.id, new Set());
  // PER LINK, not per rect. A dogleg or an L is three rects and each END leg
  // reaches one room — no single rect ever touches both, so a rect-wise graph
  // reports a floor of isolated rooms. (It did: 3 edges for 6 rooms.)
  const byLink = new Map<string, RoomSpec[]>();
  for (const c of spec.corridors) {
    const link = /^(cor-[a-z]?\d+)-\d+$/.exec(c.id)?.[1] ?? c.id;
    (byLink.get(link) ?? byLink.set(link, []).get(link)!).push(c);
  }
  for (const legs of byLink.values()) {
    const hit = new Set<string>();
    for (const c of legs) {
      for (const r of rooms) {
        if (Math.abs(c.rect.x - r.rect.x) < (c.rect.w + r.rect.w) / 2
          && Math.abs(c.rect.z - r.rect.z) < (c.rect.d + r.rect.d) / 2) hit.add(r.id);
      }
    }
    const ids = [...hit];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) touch(ids[i], ids[j]);
    }
  }
  return adj;
}

test('MOST FLOORS ARE NO LONGER A TREE', () => {
  let looped = 0, tooMany = 0;
  for (const { spec } of FLOORS) {
    const legs = loopLegs(spec);
    if (legs.length) looped++;
    // ONE loop. Two cycles on a six-room floor is a maze, and the point was
    // never to make the floor hard to read.
    const links = new Set(legs.map((c) => c.id.replace(/-\d+$/, '')));
    if (links.size > 1) tooMany++;
  }
  assert.equal(tooMany, 0, `${tooMany} floors grew more than one loop`);
  assert.ok(looped / FLOORS.length > 0.6,
    `only ${looped}/${FLOORS.length} floors carry a loop — a cycle this rare is not a feature`);
});

test('...and the cycle is in the GEOMETRY, not just in the link list', () => {
  // Read off the finished rects: a connected graph with more edges than
  // rooms − 1 has a cycle in it, and that is the whole claim.
  let cyclic = 0;
  for (const { seed, depth, spec } of FLOORS) {
    if (!loopLegs(spec).length) continue;
    const adj = roomGraph(spec);
    let edges = 0;
    for (const set of adj.values()) edges += set.size;
    edges /= 2;
    assert.ok(edges >= adj.size,
      `d${depth}/s${seed} has a loop corridor but only ${edges} edges for ${adj.size} rooms — `
      + 'the loop connects nothing');
    cyclic++;
  }
  assert.ok(cyclic > 30, `only ${cyclic} floors measured — this checked almost nothing`);
});

test('THE FLOOR STILL HAS A DEAD END TO SPEND', () => {
  // The rule the cobweb count caught. floor-plan.ts owes this floor a detour;
  // the loop grows its OWN spare pocket rather than eating one of those.
  let withDeadEnd = 0;
  for (const { spec } of FLOORS) {
    const adj = roomGraph(spec);
    const leaves = [...adj.values()].filter((s) => s.size === 1).length;
    if (leaves >= 1) withDeadEnd++;
  }
  assert.ok(withDeadEnd / FLOORS.length > 0.9,
    `only ${withDeadEnd}/${FLOORS.length} floors still have a cul-de-sac — the loop is `
    + 'eating the detour the floor plan asked for');
});

test('THE LOOP IS A SHORTCUT, NOT THE ROUTE', () => {
  // Every room the spine strings together must still be reachable WITHOUT the
  // loop. If it isn't, the loop has become load-bearing and the mainline — and
  // the gating and the descent facing that read it — is about the wrong path.
  for (const { seed, depth, spec } of FLOORS) {
    const legs = new Set(loopLegs(spec).map((c) => c.id));
    if (!legs.size) continue;
    const stripped: LevelSpec = {
      ...spec, corridors: spec.corridors.filter((c) => !legs.has(c.id)),
    };
    const adj = roomGraph(stripped);
    const start = spec.rooms.find((r) => !r.logicalOnly)?.id;
    assert.ok(start, 'no rooms');
    const seen = new Set([start!]);
    const queue = [start!];
    for (let i = 0; i < queue.length; i++) {
      for (const n of adj.get(queue[i]) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    assert.equal(seen.size, adj.size,
      `d${depth}/s${seed}: with the loop removed, ${adj.size - seen.size} room(s) become `
      + 'unreachable — the loop is carrying the floor, not shortcutting it');
  }
});

test('AND THE FLOOR STILL DESCENDS', () => {
  // The forced final drop is placed on the last SPINE link. A loop is neither a
  // spur nor part of the descent and decides no elevation at all, so when the
  // drop landed on one it was discarded and the floor came out flat.
  let descends = 0;
  for (const { spec } of FLOORS) {
    const lowest = Math.min(...spec.rooms.map((r) => r.elevation ?? 0));
    if (lowest < -0.01) descends++;
  }
  assert.ok(descends / FLOORS.length > 0.85,
    `only ${descends}/${FLOORS.length} floors descend at all — the loop is eating the drop`);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
