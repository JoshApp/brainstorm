// THE NEW SYSTEM MUST NOT BE QUIETLY OVERRULED BY THE OLD ONE.
//
// Josh: *"can we make sure the new graph and tech we built isn't superseded by
// parts of the old system as we go — so it's not like, well, we have the info
// but the old system parts ignore it and cleave things in two anyway."*
//
// That is the single most expensive bug shape in this codebase and it has now
// happened four separate times, always the same way: a NEW producer computes
// something once and correctly, and an OLD reader re-derives the same thing from
// a weaker input because nobody removed its ability to.
//
//   - the room's wall ring vs the corridor's end cap, each finding "the doorway"
//     from different geometry            → see the header of portals.ts
//   - the doorway cut from the corridor's RECT vs from the plate that is BUILT
//                                        → 120.7m of wall opened onto nothing
//   - one doorway per corridor RECT vs per CONNECTION
//                                        → 23 dead frames embedded in walls
//   - THIS ONE: `describeWalls` re-planning the wall ring from rects while the
//     shell builds it from the portal cuts → 216m of wall the dressing, the
//     engaged piers and the sconces did not know existed
//
// The fix each time is the same: ONE producer, and the readers take its answer
// rather than an input they could guess from. This file asserts that for the
// wall ring, which is the one with the most readers.
//
//   npm test -- one-ring

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { describeWalls } from '../src/level/wall-surfaces';
import { planWallRing, WALL_T } from '../src/level/poly-shell-plan';
import { wallCutsFor, planPortals } from '../src/level/portals';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 1137];
const DEPTHS = [2, 5, 8, 11];
let CORPUS: ReturnType<typeof generatePolyFloor>[] | null = null;
const floors = () => (CORPUS ??= SEEDS.flatMap((s) => DEPTHS.map((d) => generatePolyFloor(d, s))));

/** The openings the shell is handed, exactly as builder.ts hands them. */
const openingsOf = (spec: ReturnType<typeof generatePolyFloor>) =>
  spec.corridors.map((c) => ({ ...c.rect, link: c.linkId }));

test('THE WALL YOU MOUNT ON IS THE WALL THAT GETS BUILT', () => {
  // `describeWalls` feeds the dressing, the engaged piers and every wall-mounted
  // fixture. The shell builds its geometry from `planWallRing` with the portal
  // cuts. If those two ever plan different rings, things are bolted to a wall
  // that is not there — or a run of real wall is left undressed because the
  // describer thinks a doorway is in it.
  //
  // Compared span by span rather than by total length: two rings can agree on
  // how much wall exists and still put it in different places.
  let checked = 0;
  for (const spec of floors()) {
    const openings = openingsOf(spec);
    for (const r of spec.rooms) {
      if (!r.poly || r.poly.length < 3) continue;
      const cuts = wallCutsFor(r.poly, openings);
      const built = planWallRing(r.poly, WALL_T, openings, undefined, cuts);
      const described = describeWalls({
        poly: r.poly, height: r.height, thickness: WALL_T, openings, cuts,
      });
      assert.equal(described.length, built.length,
        `${spec.id} ${r.id}: the shell builds ${built.length} wall spans and the describer sees `
        + `${described.length} — something is mounting on a wall that is not there`);
      for (let i = 0; i < built.length; i++) {
        const b = built[i], d = described[i];
        assert.equal(d.edge, b.edge, `${spec.id} ${r.id}: span ${i} is on a different edge`);
        assert.ok(Math.hypot(d.a[0] - b.a[0], d.a[1] - b.a[1]) < 1e-9
          && Math.hypot(d.b[0] - b.b[0], d.b[1] - b.b[1]) < 1e-9,
          `${spec.id} ${r.id}: span ${i} starts or ends somewhere else`);
        checked++;
      }
    }
  }
  assert.ok(checked > 400, `only ${checked} spans compared — this measured nothing`);
});

test('AND THE CUTS PARAMETER IS ACTUALLY HONOURED', () => {
  // The control. If describing WITHOUT the cuts happened to give the same answer, the
  // test above would pass for free and protect nothing — which is exactly how the bug
  // survived: the rect-only ring was never absurd, just wrong, and nothing compared
  // them. (Measured when that was written: the rect-only plan was missing 216m of
  // wall across 144 floors.)
  //
  // ── THIS USED TO ASK REAL DATA TO DISAGREE, AND THAT WAS THE WRONG QUESTION ──
  //
  // It counted rooms where passing the cuts changed the output, and needed more than
  // five. That worked while the cuts came from `planPortals` and the openings came
  // from rects, because the two disagreed often. Stage 3 of docs/LINKS-V3.md made the
  // cut DECLARED by the link that chose it, and declared cuts agree with the rect
  // clipping almost everywhere — 100% same edge over 628 of them. So the control
  // started failing on "the cuts changed nothing on 2 rooms", reporting the fix as
  // the fault. A guard that needs the data to still be broken is not a guard.
  //
  // Asked by CONSTRUCTION instead: hand the ring a cut it could not possibly have
  // derived from any opening — a hole in the middle of an edge nothing touches — and
  // require the wall to actually lose that much stone. This cannot pass by accident
  // and it cannot rot as the generator gets better.
  let checked = 0;
  const len = (ds: ReadonlyArray<{ a: V2; b: V2 }>) =>
    ds.reduce((m, d) => m + Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), 0);
  for (const spec of floors()) {
    for (const r of spec.rooms) {
      if (!r.poly || r.poly.length < 3) continue;
      const poly = r.poly;
      // The longest edge, so the synthetic hole comfortably clears both corners.
      let edge = 0, longest = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > longest) { longest = l; edge = i; }
      }
      if (longest < 2) continue;
      checked++;
      const bare = describeWalls({ poly, height: r.height, thickness: WALL_T, openings: [] });
      const holed = describeWalls({
        poly, height: r.height, thickness: WALL_T, openings: [],
        cuts: [{ edge, t0: 0.4, t1: 0.6 }],
      });
      const removed = len(bare) - len(holed);
      assert.ok(Math.abs(removed - longest * 0.2) < 0.05,
        `${r.id}: a declared cut across 20% of a ${longest.toFixed(2)}m edge should remove `
        + `${(longest * 0.2).toFixed(2)}m of wall, and removed ${removed.toFixed(2)}m — `
        + 'describeWalls is not honouring its `cuts` parameter');
    }
  }
  assert.ok(checked > 100, `only ${checked} rooms tested — this measured nothing`);
});

test('ONE CONNECTION OPENS ONE DOORWAY', () => {
  // The same rule, one layer up. A dogleg is several rects and ONE way through;
  // the frame emitter, the wall ring and the standoff rules all call
  // `planPortals`, so if it answered per rect they would each independently
  // decide a passing leg deserves a door.
  //
  // Josh found the result on a phone: *"the corridor has two doors, one inside a
  // wall where a potential exit could have been."* 23 of them across 240 floors.
  for (const spec of floors()) {
    const cors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect, link: c.linkId }));
    const linkOf = new Map(cors.map((c) => [c.id, c.link ?? c.id]));
    for (const r of spec.rooms) {
      if (!r.poly || r.poly.length < 3) continue;
      const seen = new Map<string, string[]>();
      for (const p of planPortals(r.id, r.poly, cors)) {
        const k = linkOf.get(p.corridorId) ?? p.corridorId;
        seen.set(k, [...(seen.get(k) ?? []), p.corridorId]);
      }
      for (const [link, legs] of seen) {
        assert.equal(legs.length, 1,
          `${spec.id} ${r.id}: connection ${link} punched ${legs.length} doorways (${legs.join(', ')}) `
          + '— one of them is a leg going past, and it becomes a frame embedded in the wall');
      }
    }
  }
});

test('...and the generator still says which connection a rect belongs to', () => {
  // The rule above is only enforceable because the corridors carry `linkId`. If
  // a future change drops it, every rect silently becomes its own link, every
  // assertion above passes, and the dead frames come straight back.
  let withLink = 0, total = 0;
  for (const spec of floors()) {
    for (const c of spec.corridors) { total++; if (c.linkId) withLink++; }
  }
  assert.ok(total > 50, `only ${total} corridors sampled`);
  assert.equal(withLink, total,
    `${total - withLink} of ${total} corridor rects have no linkId — they will each claim their own doorway`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
