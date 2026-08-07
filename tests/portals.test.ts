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

test('NOTHING IS REMOVED FROM A WALL WITHOUT FLOOR BEHIND IT', () => {
  // The whole bug in one assertion, stated as the thing that actually goes
  // wrong rather than as a proxy for it.
  //
  // This used to compare the wall removed on an edge against the width of the
  // PORTAL reported on that edge. That worked while an opening was always one
  // edge — and stopped meaning anything when an opening learned to span a
  // corner, because the portal then names its leading edge while the cuts land
  // on three. The proxy went red on a corridor that was doing nothing wrong.
  //
  // What the original 0.50m surplus actually was: wall removed where there is
  // NO CORRIDOR. That is checkable directly, and it holds whatever shape an
  // opening takes — a notch a corridor runs down legitimately loses three
  // walls, because all three stand inside the corridor's own floor, which is
  // the same rule `insidePolyRanges` applies from the other side.
  //
  // Measured on the CUTS, in the polygon's own edge coordinates, rather than on
  // the built spans: the ring is offset outward by the wall thickness, so
  // reading holes back off its geometry needs a quarter-metre of slack — and a
  // quarter-metre of slack is exactly the size of the bug.
  let checked = 0;
  for (const spec of floors()) {
    const rects = spec.corridors.map((c) => c.rect);
    // Tight. A cut is in the polygon's own coordinates and a corridor rect is
    // too; the only honest slack is float noise and the ring's 0.14m stub drop.
    const SLACK = 0.15;
    const overCorridor = (x: number, z: number) => rects.some((c) =>
      Math.abs(x - c.x) <= c.w / 2 + SLACK && Math.abs(z - c.z) <= c.d / 2 + SLACK);

    for (const r of spec.rooms) {
      if (!r.poly) continue;
      for (const cut of wallCutsFor(r.poly, rects)) {
        const a = r.poly[cut.edge], b = r.poly[(cut.edge + 1) % r.poly.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const span = Math.hypot(dx, dz) * (cut.t1 - cut.t0);
        const steps = Math.max(2, Math.ceil(span / 0.25));
        for (let i = 0; i <= steps; i++) {
          const t = cut.t0 + ((cut.t1 - cut.t0) * i) / steps;
          const px = a[0] + dx * t, pz = a[1] + dz * t;
          assert.ok(overCorridor(px, pz),
            `${spec.id} ${r.id}: the wall is cut at (${px.toFixed(1)}, ${pz.toFixed(1)}) `
            + `on edge ${cut.edge} with no corridor behind it — that is a see-through slot`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} cut samples — the sample is not measuring anything`);
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

test('A FRAME IN AN AXIS-ALIGNED WALL IS SQUARE TO THE WORLD', () => {
  // The rotation is derived from the edge normal, and a sign error there would
  // put every archway across its own doorway — invisible to a reachability test
  // and extremely visible on a phone. Most walls in this generator ARE axis
  // aligned, so their frames must come out at a multiple of 90°; a chamfered
  // wall is then free to be anything, which is the whole point of portal rotY.
  let axisAligned = 0, offAxis = 0;
  for (const spec of floors()) {
    const corridors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const r of spec.rooms) {
      if (!r.poly) continue;
      for (const p of planPortals(r.id, r.poly, corridors)) {
        const nx = Math.abs(p.normal[0]), nz = Math.abs(p.normal[1]);
        const isAxis = nx < 1e-6 || nz < 1e-6;
        if (!isAxis) { offAxis++; continue; }
        axisAligned++;
        // rotY should land on a quarter turn.
        const q = p.rotY / (Math.PI / 2);
        assert.ok(Math.abs(q - Math.round(q)) < 1e-6,
          `${r.id}: an axis-aligned wall got a frame at ${(p.rotY * 180 / Math.PI).toFixed(1)}°`);
      }
    }
  }
  assert.ok(axisAligned > 50, `only ${axisAligned} axis-aligned portals — not measuring much`);
  assert.ok(offAxis > 0, 'no chamfered doorway in the sample — the rotation freedom is untested');
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
