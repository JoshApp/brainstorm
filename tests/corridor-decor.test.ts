// ROOMS STAGE EVENTS. CORRIDORS HOLD EVIDENCE.
//
// Measured before any of this existed, over 36 floors and 2008 metres of
// corridor: the only props standing in a corridor were 362 doorframes and 20
// strays that had leaked in from room dressing. One prop every hundred metres.
//
// Four things are checked, and each is a way corridor content goes wrong:
//
//   1. IT IS ACTUALLY THERE, AND NOT EVERYWHERE. A density assertion with both
//      ends. The first cut of the placer floored its slot count and shipped
//      three beats a floor — one every nineteen metres — which is a rounding
//      error away from the empty corridors it was written about.
//   2. NOTHING STANDS WHERE YOU WALK. Everything here is cosmetic and carries
//      no collision, so an oversized beat does not block a corridor: you walk
//      THROUGH it, which reads worse. Asserted against MIN_WALKABLE_WIDTH via
//      the shipping eligibility rule, not a copy of it.
//   3. NOTHING STANDS IN A DOORWAY. A frame and a claw rake in the same half
//      metre of wall is the geometry Josh has photographed three times.
//   4. A SQUEEZE AND A GALLERY DO NOT CARRY THE SAME THINGS. If they do, the
//      section vocabulary bought nothing and the intents field is decoration.
//
// Plus the rule this pass must not break: a corridor may never hold a
// DECISION. Every interactable in this game is placed by machinery that reasons
// about rooms, and a chest in a corridor silently invalidates all of it.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { CORRIDOR_BEATS, dressCorridors } from '../src/level/corridor-decor';
import { corridorType, MIN_WALKABLE_WIDTH } from '../src/level/corridor-types';
import { planPortals } from '../src/level/portals';
import type { PropSpec, RoomSpec } from '../src/level/types';

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

/** The props this pass put down, identified the way the builder identifies them. */
const beatsIn = (props: readonly PropSpec[]) =>
  props.filter((p) => ((p as { _dbg?: string })._dbg ?? '').startsWith('corridor-'))
    .map((p) => p as PropSpec & { x: number; z: number; _dbg: string });

const runLen = (c: RoomSpec) => Math.max(c.rect.w, c.rect.d);

/** Every doorway on a floor, from the same call the frames and the placer make. */
function doorwaysOf(spec: { rooms: RoomSpec[]; corridors: RoomSpec[] }): Array<{ x: number; z: number }> {
  const cors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
  const out: Array<{ x: number; z: number }> = [];
  for (const r of spec.rooms) {
    if (!r.poly) continue;
    for (const p of planPortals(r.id, r.poly, cors)) out.push({ x: p.mid[0], z: p.mid[1] });
  }
  return out;
}

test('A CORRIDOR IS NO LONGER EMPTY, AND IS NOT A JUNK SHOP EITHER', () => {
  let beats = 0, metres = 0, legs = 0, bare = 0;
  for (const { spec } of FLOORS) {
    const placed = beatsIn(spec.props ?? []);
    beats += placed.length;
    for (const c of spec.corridors) {
      legs++; metres += runLen(c);
      const any = placed.some((p) =>
        Math.abs(p.x - c.rect.x) <= c.rect.w / 2 && Math.abs(p.z - c.rect.z) <= c.rect.d / 2);
      if (!any) bare++;
    }
  }
  const every = metres / Math.max(1, beats);
  assert.ok(beats > 300, `only ${beats} corridor beats over ${FLOORS.length} floors`);
  // Both ends, and the low end is the one that actually caught a bug.
  assert.ok(every < 8, `one beat every ${every.toFixed(1)}m — that is still an empty corridor`);
  assert.ok(every > 2.0, `one beat every ${every.toFixed(1)}m — a corridor is not a junk shop`);
  assert.ok(bare / legs < 0.15,
    `${bare}/${legs} corridor legs have nothing in them at all`);
});

test('NOTHING A CORRIDOR CARRIES STANDS WHERE YOU WALK', () => {
  // Asserted on WHAT WAS PLACED, not on what the table offers. The table
  // deliberately over-lists: `intents` is a taste call, and a beat is dropped
  // from a section it does not fit by arithmetic in the placer. So checking the
  // declarations would pass while the placer put shards in a squeeze.
  //
  // Everything here is cosmetic — no collision — so the failure this prevents is
  // walking straight through a pile of bones, not a blocked passage. Same
  // number, different bug; see the header in corridor-decor.ts.
  let placed = 0;
  for (const { seed, depth, spec } of FLOORS) {
    for (const b of beatsIn(spec.props ?? [])) {
      for (const c of spec.corridors) {
        if (Math.abs(b.x - c.rect.x) > c.rect.w / 2 || Math.abs(b.z - c.rect.z) > c.rect.d / 2) continue;
        const beat = CORRIDOR_BEATS.find((k) => `corridor-${k.id}` === b._dbg);
        assert.ok(beat, `${b._dbg} is not in the beat table`);
        const section = corridorType(c.corridorType);
        placed++;
        assert.ok(section.width - beat.footprint >= MIN_WALKABLE_WIDTH,
          `d${depth}/s${seed}: ${beat.id} (${beat.footprint}m) stands in a ${section.id} `
          + `(${section.width}m), leaving ${(section.width - beat.footprint).toFixed(2)}m `
          + `against a ${MIN_WALKABLE_WIDTH}m floor`);
        break;
      }
    }
  }
  assert.ok(placed > 300, `only ${placed} beats resolved to a corridor — this measured nothing`);

  // AND THE ARITHMETIC ACTUALLY EXCLUDES SOMETHING. Without this the rule above
  // is satisfied by a table that never offers anything too big, and deleting
  // the width check entirely would not change a single floor — which is exactly
  // what the first version of this table did.
  const squeeze = corridorType('squeeze');
  const excluded = CORRIDOR_BEATS.filter((b) =>
    b.intents.includes(squeeze.intent) && squeeze.width - b.footprint < MIN_WALKABLE_WIDTH);
  assert.ok(excluded.length >= 2,
    `only ${excluded.length} beats are kept out of a squeeze by SIZE — the width rule is `
    + 'decorative, and a hand-kept intents list is doing the work instead');
  // And nothing carries collision — that IS the contract, and a beat that
  // quietly gained one would narrow a corridor for real.
  for (const { spec } of FLOORS) {
    for (const p of beatsIn(spec.props ?? [])) {
      assert.ok(!('collision' in p) || !(p as { collision?: unknown }).collision,
        `${p._dbg} carries collision — corridor dressing must stay cosmetic`);
    }
  }
});

test('AND NOTHING STANDS IN A DOORWAY', () => {
  // Same call the frames make, so a beat and the archway it would clip are
  // measured against one answer rather than two that agree until one changes.
  const CLEAR = 0.9;
  let checked = 0, worst = Infinity;
  for (const { seed, depth, spec } of FLOORS) {
    const doors = doorwaysOf(spec);
    if (!doors.length) continue;
    for (const b of beatsIn(spec.props ?? [])) {
      checked++;
      for (const { x: dx, z: dz } of doors) {
        const d = Math.hypot(b.x - dx, b.z - dz);
        worst = Math.min(worst, d);
        assert.ok(d >= CLEAR,
          `d${depth}/s${seed}: ${b._dbg} sits ${d.toFixed(2)}m from a doorway — inside the frame`);
      }
    }
  }
  assert.ok(checked > 300, `only ${checked} beats sampled — this measured nothing`);
});

test('A SQUEEZE AND A GALLERY DO NOT CARRY THE SAME THINGS', () => {
  // If the two ends of the vocabulary draw from one pool, `intents` is
  // decoration and slice 1 bought nothing.
  const seen: Record<string, Set<string>> = { squeeze: new Set(), passage: new Set(), gallery: new Set() };
  for (const { spec } of FLOORS) {
    for (const b of beatsIn(spec.props ?? [])) {
      for (const c of spec.corridors) {
        if (Math.abs(b.x - c.rect.x) > c.rect.w / 2 || Math.abs(b.z - c.rect.z) > c.rect.d / 2) continue;
        seen[c.corridorType ?? 'passage']?.add(b._dbg);
        break;
      }
    }
  }
  for (const [k, set] of Object.entries(seen)) {
    assert.ok(set.size >= 3, `the ${k} only ever carries ${set.size} kind(s) of thing`);
  }
  const sq = seen.squeeze, ga = seen.gallery;
  const onlyGallery = [...ga].filter((x) => !sq.has(x));
  assert.ok(onlyGallery.length >= 3,
    `only ${onlyGallery.length} beats are gallery-exclusive — the sections read the same`);
  // And the squeeze must NOT have picked up anything that needs floor space.
  for (const id of sq) {
    const beat = CORRIDOR_BEATS.find((b) => `corridor-${b.id}` === id);
    assert.ok(beat && corridorType('squeeze').width - beat.footprint >= MIN_WALKABLE_WIDTH,
      `${id} turned up in a squeeze and does not fit one`);
  }
});

test('the dressing is DETERMINISTIC and does not move the floor', () => {
  // Two guarantees in one. Same seed, same corridors, same evidence — a floor
  // that re-dresses differently on reload is the bug that made HP and flasks
  // unstable across a descent. And the pass is a pure function of the corridors
  // it is handed, so it cannot reach back into the layout.
  const legs = FLOORS[0].spec.corridors;
  const stream = (seed: number) => { let t = seed >>> 0; return () => {
    t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }; };
  const doors = doorwaysOf(FLOORS[0].spec);
  const floors = FLOORS[0].spec.rooms.map((r) => r.poly!).filter(Boolean);
  const a = dressCorridors(legs, doors, floors, stream(99));
  const b = dressCorridors(legs, doors, floors, stream(99));
  assert.equal(JSON.stringify(a.map((p) => [(p as { x: number }).x, (p as { z: number }).z])),
    JSON.stringify(b.map((p) => [(p as { x: number }).x, (p as { z: number }).z])),
    'the same corridors and the same stream produced different evidence');
  assert.ok(a.length > 0, 'the pass produced nothing at all');
});

test('a corridor never holds a DECISION', () => {
  // The load-bearing rule. Interactables are placed by machinery that reasons
  // about ROOMS — spacing from the door you came in by, one major per region,
  // the contract in floor-plan.ts. One chest in a corridor and all of that is
  // quietly untrue. This asserts the finished floor, so it catches the day
  // somebody adds an inviting beat to the table as much as it catches this pass.
  const DECISIONS = new Set([
    'chest', 'altar', 'blood-altar', 'fountain', 'tithe-basin', 'reliquary',
    'merchant', 'trinket-merchant', 'blacksmith', 'tome-pillar', 'starter-altar',
    'stash-chest', 'challenge-offering', 'gate-offering', 'offering',
  ]);
  for (const { seed, depth, spec } of FLOORS) {
    for (const p of (spec.props ?? []) as Array<{ kind: string; x: number; z: number }>) {
      if (!DECISIONS.has(p.kind)) continue;
      for (const c of spec.corridors) {
        const inside = Math.abs(p.x - c.rect.x) <= c.rect.w / 2 - 0.3
          && Math.abs(p.z - c.rect.z) <= c.rect.d / 2 - 0.3;
        assert.ok(!inside,
          `d${depth}/s${seed}: a ${p.kind} stands inside corridor ${c.id}`);
      }
    }
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
