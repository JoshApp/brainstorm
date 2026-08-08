// THE FLOOR FALLS, AND IT FALLS WITHOUT A STEP IN IT.
//
// Elevation is presentation truth — collision and pathfinding stay 2D — which
// means every way this can go wrong is INVISIBLE to the reachability tests and
// visible only as a player walking through a doorway and dropping half a metre.
// So the assertions here are about the ground itself, sampled from the REAL
// `buildElevationField` on REAL generated floors:
//
//   - a corridor and the room it meets are level where they meet;
//   - no ramp is steeper than the grade Josh signed off;
//   - the stair is the lowest ground on the floor, so downhill is forward;
//   - and the floor is not simply flat, which is how all three above pass for
//     the wrong reason.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { buildElevationField, corridorRampRun } from '../src/level/elevation';
import { planElevation, type ElevLink } from '../src/level/poly-elevation';
import { pointInPoly } from '../src/level/room-shape';
import { CONFIG } from '../src/config';
import type { LevelSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337];
const DEPTHS = [2, 3, 5, 8, 11];
// Generated once — the checks below only read it. See the note in
// poly-floor.test.ts: regenerating per call is what made the floor tests
// dominate the suite's wall clock.
let CORPUS: LevelSpec[] | null = null;
function floors(): LevelSpec[] {
  if (CORPUS) return CORPUS;
  const out: LevelSpec[] = [];
  for (const s of SEEDS) for (const d of DEPTHS) out.push(generatePolyFloor(d, s));
  return (CORPUS = out);
}

test('NO STEP WHERE A CORRIDOR MEETS A ROOM', () => {
  // The one that matters. A corridor's end apron is supposed to be pinned to
  // the room's plateau, so the seam is level BY CONSTRUCTION — but a polygon
  // room's shape can reach past the point the corridor measured, and then a
  // ramp ends inside a room at a different height. Measured before the fix:
  // 40 of these across 240 floors, the worst a 0.61m drop in a doorway.
  let checked = 0, worst = 0;
  for (const spec of floors()) {
    const field = buildElevationField(spec.rooms, spec.corridors);
    for (const c of spec.corridors) {
      const alongX = c.rampAlongX ?? (c.rect.w >= c.rect.d);
      for (const end of [-1, 1] as const) {
        const px = alongX ? c.rect.x + end * (c.rect.w / 2 - 0.15) : c.rect.x;
        const pz = alongX ? c.rect.z : c.rect.z + end * (c.rect.d / 2 - 0.15);
        for (const r of spec.rooms) {
          if (!r.poly || !pointInPoly(r.poly, px, pz)) continue;
          checked++;
          worst = Math.max(worst, Math.abs(field.groundY(px, pz) - (r.elevation ?? 0)));
        }
      }
    }
  }
  // A COVERAGE FLOOR, NOT A FINGERPRINT. This was `> 200` against a sample that
  // produced 201, and the corridor vocabulary — which narrowed the average
  // section by about 5% — took it to 199 without touching a single seam height.
  // A guard pinned to the last number the generator happened to produce fires
  // on every unrelated tuning pass, so it sits well under it now: what it is
  // for is catching a sweep that stopped finding corridors at all.
  assert.ok(checked > 150, `only ${checked} seams sampled — not measuring the rule`);
  assert.ok(worst < 0.02, `worst seam steps ${worst.toFixed(3)}m — you fall through a doorway`);
});

test('NO RAMP IS STEEPER THAN THE SIGNED-OFF GRADE', () => {
  // The clamp is per LINK and the fall is split across a dogleg's two legs, so
  // a bad split shows up here and nowhere else. Uses `corridorRampRun` — the
  // same function the field uses to place the aprons — rather than the rect
  // length, or this would be measuring a different slope than the one built.
  let ramps = 0, steepest = 0;
  for (const spec of floors()) {
    for (const c of spec.corridors) {
      if (c.rampLoElev === undefined || c.rampHiElev === undefined) continue;
      ramps++;
      const run = corridorRampRun(c.rampAlongX ? c.rect.w : c.rect.d);
      steepest = Math.max(steepest, Math.abs(c.rampHiElev - c.rampLoElev) / run);
    }
  }
  assert.ok(ramps > 50, `only ${ramps} ramps — the sample is not measuring anything`);
  assert.ok(steepest <= CONFIG.ELEVATION_MAX_GRADE + 1e-9,
    `a ramp runs at ${steepest.toFixed(2)} against a cap of ${CONFIG.ELEVATION_MAX_GRADE}`);
});

test('THE WAY OUT IS THE LOWEST GROUND ON THE FLOOR', () => {
  // Downhill is forward, and it is only a usable signal if nothing else on the
  // floor goes deeper. A dead-end pocket that dives below the exit spends the
  // signal on a room that leads nowhere — 57 floors in 240 did exactly that
  // before spurs were clamped to the spine's floor.
  for (const spec of floors()) {
    const st = spec.stairs?.[0];
    assert.ok(st, `${spec.id}: no stair`);
    const lowest = Math.min(...spec.rooms.map((r) => r.elevation ?? 0));
    const stairRoom = spec.rooms.find((r) => r.poly && pointInPoly(r.poly, st!.x, st!.z));
    assert.ok(stairRoom, `${spec.id}: the stair is in no room`);
    assert.ok(Math.abs((stairRoom!.elevation ?? 0) - lowest) < 1e-9,
      `${spec.id}: the stair sits at ${(stairRoom!.elevation ?? 0).toFixed(2)}m `
      + `and the floor bottoms out at ${lowest.toFixed(2)}m — the deepest room is a detour`);
  }
});

test('...and the floor is not simply flat', () => {
  // THE CONTROL, and the important one: every assertion above passes trivially
  // on a dungeon with no elevation at all, which is exactly what the polygon
  // generator shipped until now.
  let fell = 0;
  for (const spec of floors()) {
    const lowest = Math.min(...spec.rooms.map((r) => r.elevation ?? 0));
    if (lowest < -0.05) fell++;
  }
  assert.ok(fell >= floors().length - 2,
    `only ${fell}/${floors().length} floors descend at all`);
});

test('a room is FLAT — the plateau is the whole point', () => {
  // Rooms are internally level so a fight happens on one plane: combat math,
  // the splat map and the nav grid never see a slope. Sampled inside the
  // polygon, away from any corridor mouth, so a corridor overlapping the room
  // isn't mistaken for the room sloping.
  for (const spec of floors()) {
    const field = buildElevationField(spec.rooms, spec.corridors);
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      const inCorridor = (x: number, z: number) => spec.corridors.some((c) =>
        Math.abs(x - c.rect.x) <= c.rect.w / 2 && Math.abs(z - c.rect.z) <= c.rect.d / 2);
      for (const [fx, fz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]] as const) {
        const x = r.rect.x + fx * r.rect.w, z = r.rect.z + fz * r.rect.d;
        if (!pointInPoly(r.poly, x, z) || inCorridor(x, z)) continue;
        assert.ok(Math.abs(field.groundY(x, z) - (r.elevation ?? 0)) < 1e-9,
          `${spec.id} ${r.id}: the floor is not level inside the room`);
      }
    }
  }
});

// ── THE PLANNER ITSELF, on shapes the generator can't be asked for ───

const box = (x: number, z: number, w: number, d: number) => ({ x, z, w, d });

test('A DOGLEG DESCENDS ON ITS LEGS AND TURNS ON A LANDING', () => {
  // The bend is the place a player's footing is least predictable, so the cross
  // piece is level and the fall lives on the two legs. Asserted on a
  // hand-built dogleg because the generator cannot be asked for one on demand.
  const rooms = new Map([['A', box(0, 0, 6, 6)], ['B', box(0, 24, 6, 6)]]);
  const link: ElevLink = {
    from: 'A', to: 'B',
    rects: [box(-2, 6, 2, 8), box(0, 11, 6, 2), box(2, 18, 2, 10)],
    ids: ['c-0', 'c-1', 'c-2'],
  };
  const plan = planElevation([link], rooms, () => 0.99);   // always the biggest drop
  const eA = plan.room.get('A')!, eB = plan.room.get('B')!;
  assert.ok(eB < eA, 'the link did not fall at all');
  const landing = plan.corridor.get('c-1')!;
  assert.equal(landing.rampLoElev, undefined, 'the landing was given a slope');
  assert.ok(landing.elevation !== undefined && landing.elevation < eA && landing.elevation > eB,
    `the landing sits at ${landing.elevation} — it should be part-way down between ${eA} and ${eB}`);
  // The legs meet the landing and the rooms exactly.
  const legA = plan.corridor.get('c-0')!, legB = plan.corridor.get('c-2')!;
  assert.equal(legA.rampLoElev, eA);
  assert.equal(legA.rampHiElev, landing.elevation);
  assert.equal(legB.rampLoElev, landing.elevation);
  assert.equal(legB.rampHiElev, eB);
});

test('a link that lies over a third room stays level', () => {
  // The elevation field lets a corridor win over a room where they overlap,
  // which is only safe for the room that corridor's end is pinned to. A rect
  // over anything else would put a step in the middle of that room's floor.
  const rooms = new Map([
    ['A', box(0, 0, 6, 6)], ['B', box(0, 24, 6, 6)],
    ['C', box(0, 12, 8, 8)],   // squarely across the corridor's path
  ]);
  const link: ElevLink = { from: 'A', to: 'B', rects: [box(0, 12, 2, 20)], ids: ['c-0'] };
  const plan = planElevation([link], rooms, () => 0.99);
  assert.equal(plan.room.get('B'), plan.room.get('A'), 'it fell over a room it does not connect');
  assert.equal(plan.corridor.get('c-0')!.rampLoElev, undefined, 'a vetoed link still got a ramp');
});

test('A SPUR NEVER GOES DEEPER THAN THE SPINE', () => {
  // Geometry chosen so the two links CAN'T fall the same amount: the spine's
  // corridor is short, so the grade cap holds its drop under a metre, while the
  // spur's is long enough for the full rolled 1.2. Without the clamp the
  // dead-end pocket ends up the deepest ground on the floor and "downhill is
  // forward" starts pointing at a cul-de-sac.
  //
  // The first version of this test used a long spine corridor, so both links
  // fell the same 1.2m and it passed with the clamp deleted — a test that
  // cannot fail is not a test.
  const rooms = new Map([
    ['A', box(0, 0, 6, 6)], ['B', box(0, 8, 6, 6)], ['P', box(24, 0, 6, 6)],
  ]);
  const spine: ElevLink = { from: 'A', to: 'B', rects: [box(0, 4, 2, 4)], ids: ['s-0'] };
  const spur: ElevLink = {
    from: 'A', to: 'P', rects: [box(12, 0, 20, 2)], ids: ['p-0'], spur: true,
  };
  const plan = planElevation([spine, spur], rooms, () => 0.99);
  const eB = plan.room.get('B')!, eP = plan.room.get('P')!;
  assert.ok(eB < -0.1, `the spine did not fall (${eB}) — the fixture is not testing anything`);
  assert.ok(eP >= eB - 1e-9, `the pocket at ${eP.toFixed(2)} is below the exit at ${eB.toFixed(2)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
