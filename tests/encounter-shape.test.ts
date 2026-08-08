// A BIG ROOM SHOULD BE A DIFFERENT FIGHT, NOT THE SAME FIGHT TWICE.
//
// Josh, on the barren-halls ticket: *"I don't want to just randomly fill rooms.
// I want to fill them with intent — we should use the bigger space for GAMEPLAY
// rather than decorating it aimlessly."*
//
// The measurement agreed and moved the target. A hall was not under-decorated:
// spawn COUNT already scaled with area, so a big room got more enemies. It got
// no different FIGHT, because `rollFloorEnemies` hard-coded `archetype: 'mixed'`
// for every room on every polygon floor. Ranged share of spawns ran 14.8% in a
// mid room, 16.0% in a large one and 8.9% in a hall — flat, and backwards at the
// top: the rooms where a 9m attack range is the only place it can mean anything
// were getting the fewest archers.
//
// Three things are checked, and two are mistakes this pass made first:
//
//   1. THE GRADIENT IS REAL, measured on the finished floors and against SPAN —
//      the variable the rule actually branches on. Reporting it against AREA
//      showed the hall band flat at 8.7% and nearly sent this back to the
//      drawing board; it is the same error that shipped galleries on 1% of
//      corridors earlier this session.
//   2. THE BANDS CUT THE FLOOR SENSIBLY. The first cut put "hall" at 1.6×
//      RANGED_SPAN, which is 14.4m, which is the MEDIAN room — half of every
//      floor came out a hall, and a hall that is half the rooms is just a room.
//   3. THE THRESHOLD IS DERIVED FROM THE ROSTER. A number typed in here would be
//      right today and silently wrong after the next balance pass.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { archetypeForSpan, roomSpan, RANGED_SPAN } from '../src/level/encounter-shape';
import { ENEMIES } from '../src/content/enemies';
import { ARCHETYPE_SLOTS } from '../src/content/encounters';

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

const isRanged = (id: string) =>
  !!(ENEMIES as Record<string, { ranged?: boolean }>)[id]?.ranged;

/** Rooms and their spawns, bucketed by the band the rule uses. */
function byBand() {
  const out = {
    tight: { rooms: 0, spawns: 0, ranged: 0 },
    middle: { rooms: 0, spawns: 0, ranged: 0 },
    hall: { rooms: 0, spawns: 0, ranged: 0 },
  };
  for (const { spec } of FLOORS) {
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      const span = roomSpan(r.poly);
      const k = span < RANGED_SPAN * 1.25 ? 'tight'
        : span < RANGED_SPAN * 1.8 ? 'middle' : 'hall';
      out[k].rooms++;
      for (const s of spec.spawns ?? []) {
        if (s.roomId !== r.id) continue;
        out[k].spawns++;
        if (isRanged(s.enemyId)) out[k].ranged++;
      }
    }
  }
  return out;
}

test('THE BIGGER THE ROOM, THE MORE OF THE FIGHT HAPPENS ACROSS IT', () => {
  const b = byBand();
  const share = (k: keyof ReturnType<typeof byBand>) =>
    b[k].ranged / Math.max(1, b[k].spawns);
  assert.ok(b.hall.spawns > 100 && b.middle.spawns > 100,
    `only ${b.hall.spawns}/${b.middle.spawns} spawns in the hall/middle bands — measured nothing`);
  // The gradient, and it is the whole point. Asserted as an ORDER rather than a
  // number so a roster change moves it without failing the suite.
  assert.ok(share('hall') > share('middle') * 1.3,
    `hall ${(share('hall') * 100).toFixed(1)}% ranged vs middle `
    + `${(share('middle') * 100).toFixed(1)}% — a hall is still the same fight as a chamber`);
  assert.ok(share('middle') >= share('tight'),
    `a tight room fields more archers (${(share('tight') * 100).toFixed(1)}%) than a middling `
    + `one (${(share('middle') * 100).toFixed(1)}%) — the bands are inverted`);
  // And a tight room stays a brawl. An archer at three metres is a melee enemy
  // with worse animations.
  assert.ok(share('tight') < 0.10,
    `${(share('tight') * 100).toFixed(1)}% of a tight room's spawns are ranged`);
});

test('...AND A HALL IS NOT MOST OF THE FLOOR', () => {
  // The first cut set the top band at the MEDIAN span, so half of every floor
  // was a "hall" and the word stopped meaning anything.
  const b = byBand();
  const total = b.tight.rooms + b.middle.rooms + b.hall.rooms;
  const hallShare = b.hall.rooms / total;
  assert.ok(hallShare > 0.12 && hallShare < 0.35,
    `${(hallShare * 100).toFixed(0)}% of rooms are halls — a band this size is either `
    + 'the whole floor or a rounding error');
  assert.ok(b.tight.rooms / total > 0.10,
    `only ${(100 * b.tight.rooms / total).toFixed(0)}% of rooms are tight — nothing is a brawl`);
});

test('THE SPAN THRESHOLD COMES OFF THE ROSTER, NOT OUT OF THE AIR', () => {
  // If the acolyte's reach changes, this number must move with it.
  let longest = 0, id = '?';
  for (const [k, e] of Object.entries(ENEMIES) as Array<[string, { ranged?: boolean; attackRange?: number }]>) {
    if (e.ranged && (e.attackRange ?? 0) > longest) { longest = e.attackRange ?? 0; id = k; }
  }
  assert.ok(longest > 0, 'no ranged enemy on the roster — the derivation has nothing to read');
  assert.equal(RANGED_SPAN, longest,
    `RANGED_SPAN is ${RANGED_SPAN} but the longest ranged reach is ${id}'s ${longest}`);
});

test('a room span is the polygon’s, not its bounding box’s', () => {
  // An L-shaped room's box spans a quadrant it has no floor in. Crediting that
  // as a sightline is the same "a polygon room is not its bounding box" mistake
  // that has cost this session four separate bugs.
  const ell: Array<[number, number]> = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  const span = roomSpan(ell);
  // The longest line between two of its OWN corners is (10,0)→(0,10) ≈ 14.1.
  assert.ok(Math.abs(span - Math.hypot(10, 10)) < 0.01,
    `an L 10m on a side measured ${span.toFixed(2)}m`);
});

test('every archetype the bands can pick is one the content layer authored', () => {
  // The bands name archetypes as data. A typo here would fall through to an
  // empty slot list and a room with no enemies in it, silently.
  const seen = new Set<string>();
  for (let span = 0; span < 40; span += 0.25) {
    for (const roll of [0.01, 0.3, 0.6, 0.99]) seen.add(archetypeForSpan(span, () => roll));
  }
  assert.ok(seen.size >= 4, `only ${seen.size} archetypes are reachable across every span`);
  for (const a of seen) {
    const slots = (ARCHETYPE_SLOTS as Record<string, unknown[]>)[a];
    assert.ok(Array.isArray(slots) && slots.length > 0,
      `archetype '${a}' has no slots in content/encounters.ts`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
