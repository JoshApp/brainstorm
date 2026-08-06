// TWO SIDES OF A DOORWAY, ONE HOLE.
//
// A doorway is a gap in the room's wall ring and a gap in the corridor's walls,
// and until now each side computed its own from a different input. The room's
// ring clipped the corridor rect INFLATED by the wall thickness; measured on
// 1203 real portals, its gap came out 0.50m wider than the corridor EVERY TIME.
// That surplus is split between the two jambs, and behind each 25cm of missing
// room wall there is nothing — which is what "gaps where the void is visible"
// looks like from inside the game.
//
// This asserts the agreement on real generated floors, not on a hand-made shape,
// because the failure was universal and a toy room would have hidden it.
//
//   npm test

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { planPortals, wallCutsFor } from '../src/level/portals';
import { planWallRing } from '../src/level/poly-shell-plan';
import { WALL_T } from '../src/level/poly-room-shell';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210];
const DEPTHS = [2, 5, 8];

function floors() {
  const out = [];
  for (const s of SEEDS) for (const d of DEPTHS) out.push(generatePolyFloor(d, s));
  return out;
}

test('THE ROOM\'S HOLE IS THE CORRIDOR\'S WIDTH — not wider', () => {
  // The whole bug in one assertion. The ring's gap on an edge has to equal the
  // portal there; anything more is wall that should exist and doesn't.
  let checked = 0;
  for (const spec of floors()) {
    const corridors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      const portals = planPortals(r.id, r.poly, corridors);
      if (!portals.length) continue;
      // THE SHIPPING CALL — same helper poly-room-shell.ts uses. The first
      // version of this test called planWallRing without the cuts and so
      // measured the path that had just been replaced.
      const rects = corridors.map((c) => c.rect);
      const spans = planWallRing(r.poly, WALL_T, rects, undefined, wallCutsFor(r.poly, rects));

      for (const p of portals) {
        // Total wall REMOVED from this edge = edge length minus what survived.
        const a = r.poly[p.edge], b = r.poly[(p.edge + 1) % r.poly.length];
        const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const kept = spans
          .filter((s) => s.edge === p.edge)
          .reduce((t, s) => t + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0);
        const removed = edgeLen - kept;
        // Several corridors can share one edge, so the removal is at LEAST this
        // portal and never more than the sum of every portal on it.
        const onEdge = portals.filter((q) => q.edge === p.edge)
          .reduce((t, q) => t + q.width, 0);
        // TOLERANCE = 2 × the ring's own minSpan (0.14m), one per jamb.
        //
        // The ring drops wall stubs shorter than that — a 4cm pier beside a
        // doorway is z-fighting, not architecture — so a little more length can
        // go than the portal asked for. That is NOT the bug this test is about:
        // a sub-14cm stub sits inside the corridor's own footprint (corridors
        // overlap into the room by 0.9m), so its side wall is behind it. The
        // 0.50m surplus that started this was OUTSIDE the corridor entirely,
        // with nothing behind it at all.
        assert.ok(removed <= onEdge + 0.28,
          `${spec.id} ${r.id}: edge ${p.edge} lost ${removed.toFixed(2)}m of wall for `
          + `${onEdge.toFixed(2)}m of doorway — the surplus is a see-through slot`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `only ${checked} portals checked — the sample is not measuring anything`);
});

test('every portal is wide enough to be a way through', () => {
  // A sliver where a corridor grazes a corner is build noise, not a doorway, and
  // shipping one means a frame mounted in a 20cm gap.
  for (const spec of floors()) {
    const corridors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      for (const p of planPortals(r.id, r.poly, corridors)) {
        assert.ok(p.width >= 0.7, `${r.id}: a ${p.width.toFixed(2)}m portal is a crack, not a door`);
      }
    }
  }
});

test('A CORRIDOR GRAZING A CORNER GETS ONE DOORWAY, NOT TWO', () => {
  // A rect overlapping two edges at a corner would punch a hole in both if every
  // hit were taken. The portal is the edge it covers MOST — the one it comes
  // through — and the other is left as wall.
  for (const spec of floors()) {
    const corridors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      const byCorridor = new Map<string, number>();
      for (const p of planPortals(r.id, r.poly, corridors)) {
        byCorridor.set(p.corridorId, (byCorridor.get(p.corridorId) ?? 0) + 1);
      }
      for (const [cid, n] of byCorridor) {
        assert.equal(n, 1, `${r.id}: corridor ${cid} punched ${n} doorways`);
      }
    }
  }
});

// NOT TESTED HERE, AND THE REASON IS WORTH KEEPING.
//
// The first version of this file asserted that a portal projects onto one of the
// corridor's four wall lines, so the corridor could subtract exactly the span
// the room opened. It failed 89 of 96 times, and the test was wrong rather than
// the code: poly-floor builds corridors that OVERLAP into the room by 0.9m
// (`OVERLAP`), so the corridor's end wall is not at the room's wall plane — it
// is nearly a metre PAST it, inside the room.
//
// Which means the corridor side is not "match the wall lines up" at all. Its end
// cap sits inside the room and should simply not exist, and its side walls
// should stop at the room's wall plane. That is the next piece of work, and it
// needs its own model rather than a symmetric mirror of the room's.

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
