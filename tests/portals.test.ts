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
import { gateAdmits } from '../src/level/nav-grid';
import { WIDEST_ROAMER } from '../src/level/anchors';
import { planWallRing, type Ring } from '../src/level/poly-shell-plan';
import { WALL_T } from '../src/level/poly-room-shell';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210];
const DEPTHS = [2, 5, 8];

// Generated once — the checks below only read it. See poly-floor.test.ts.
let CORPUS: ReturnType<typeof generatePolyFloor>[] | null = null;
function floors() {
  if (CORPUS) return CORPUS;
  const out = [];
  for (const s of SEEDS) for (const d of DEPTHS) out.push(generatePolyFloor(d, s));
  return (CORPUS = out);
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
  // NOT `assert.ok(offAxis > 0)`. That guard stood here to stop the test passing
  // vacuously, and it was the right instinct aimed at the wrong thing: it made a
  // GENERATOR outcome load-bearing for a GEOMETRY check. Freeing corridor
  // placement let the router pick flat runs over chamfers, doorways on diagonal
  // edges went to zero, and a test of `rotY` went red over a change that never
  // touched `rotY`. The branch is pinned directly below instead.
  void offAxis;
});

test('A FRAME IN A CHAMFERED WALL TURNS TO MATCH IT', () => {
  // The counterpart to the check above, and the reason portals carry a rotY at
  // all. A sign error here mounts the archway ACROSS its own doorway — invisible
  // to any reachability test and extremely visible on a phone.
  //
  // Synthetic, deliberately. The generator produced diagonal doorways when this
  // was written and stopped producing them the same afternoon; a branch that
  // only runs when procgen feels like it is a branch that is not tested. Build
  // the shape that forces it.
  //
  // A square room with one corner cut, and a corridor straddling only the cut —
  // the neighbouring walls end before the corridor reaches them, so the chamfer
  // is the one edge it can come through.
  const room = (cut: number): Ring => [[-6, -6], [6, -6], [6, 6 - cut], [6 - cut, 6], [-6, 6]];
  for (const cut of [4, 6, 2.5]) {
    const poly = room(cut);
    // Straddling the chamfer's midpoint, nudged outward so the corridor leaves
    // the room rather than sitting inside it. The neighbouring walls stop short
    // of the rect on both sides, so the cut edge is the only one it can clip —
    // asserted below by demanding exactly one doorway.
    const at = 6 - cut / 2 + 0.6;   // the chamfer's midpoint is at x = z = 6 - cut/2
    const portals = planPortals('probe', poly, [{ id: 'cor', rect: { x: at, z: at, w: 3, d: 3 } }]);
    assert.equal(portals.length, 1, `a ${cut}m chamfer got ${portals.length} doorways, not 1`);
    const p = portals[0];

    // The edge runs (6, 6-cut) → (6-cut, 6): direction (-1, 1)/√2 whatever the
    // cut, so its outward normal is (1, 1)/√2 — 45°, and the same for all three
    // sizes. Checked as a value rather than "not axis aligned", because a normal
    // that is merely off-axis can still be off by a sign.
    assert.ok(Math.abs(p.normal[0] - Math.SQRT1_2) < 1e-6 && Math.abs(p.normal[1] - Math.SQRT1_2) < 1e-6,
      `a ${cut}m chamfer got normal (${p.normal.map((v) => v.toFixed(3)).join(', ')}), expected the outward diagonal`);

    // And rotY must AGREE with that normal, not merely be non-zero. Reconstruct
    // the facing from the angle and compare: this is the assertion a sign error
    // fails, and it is stated in terms of the frame's own direction rather than
    // by copying `atan2(nrm[0], nrm[1])` out of portals.ts — a test that repeats
    // the implementation's arithmetic passes for whatever the implementation
    // does, including the wrong thing.
    const faced: [number, number] = [Math.sin(p.rotY), Math.cos(p.rotY)];
    assert.ok(Math.hypot(faced[0] - p.normal[0], faced[1] - p.normal[1]) < 1e-6,
      `a ${cut}m chamfer's frame faces (${faced.map((v) => v.toFixed(3)).join(', ')}) `
      + `but its wall faces (${p.normal.map((v) => v.toFixed(3)).join(', ')}) — the frame is across the doorway`);

    // Not a quarter turn — the whole point of the freedom.
    const q = p.rotY / (Math.PI / 2);
    assert.ok(Math.abs(q - Math.round(q)) > 1e-3,
      `a ${cut}m chamfer produced an axis-aligned frame at ${(p.rotY * 180 / Math.PI).toFixed(1)}°`);
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

test('A FRAME IS AS WIDE AS THE WAY THROUGH, NOT AS LONG AS THE CUT', () => {
  // Josh, on a phone: *"a smaller corridor connected to a big gate by embedding
  // a tiny corridor inside the middle of the big gate."*
  //
  // `width` is how much OUTLINE the hole eats, summed across a run of adjacent
  // edges — and the outline around a chamfered corner is longer than the line
  // across it. Sizing the frame from that built a 4.94m gate for a 2.20m
  // passage on 5% of doorways, with the corridor's own side walls then standing
  // inside the frame's opening. Two questions, one number; now two numbers.
  //
  // The CUT still wants the arc: getting THAT wrong the other way left walls
  // standing across passages and sealed rooms on 24 of 72 floors. So both halves
  // are asserted — the cut is never shorter than the span it must clear, and the
  // frame is never wider than the corridor behind it.
  let checked = 0, chamfered = 0;
  for (const spec of floors()) {
    const byId = new Map(spec.corridors.map((c) => [c.id, c]));
    const cors = spec.corridors.map((c) => ({ id: c.id, rect: c.rect }));
    for (const room of spec.rooms) {
      if (!room.poly || room.poly.length < 3) continue;
      for (const p of planPortals(room.id, room.poly, cors)) {
        const c = byId.get(p.corridorId);
        if (!c) continue;
        checked++;
        const clear = Math.min(c.rect.w, c.rect.d);
        // ── AND IT STANDS PROUD OF THE CORRIDOR'S WALLS ────────────────────
        //
        // Josh: "the doorframes are stuck inside the corridor's walls so it's
        // z-fighting ... it's the same as a pipe and the pipe's connector."
        //
        // Sizing the frame to EXACTLY the corridor's clear width — which this
        // test asserted an hour before this block was added, and was right to —
        // puts the jambs precisely on the corridor's own side-wall planes. Two
        // coplanar surfaces both claiming the same depth is a shimmer down both
        // sides of every doorway. The frame gives up a few centimetres a side
        // so the two can never be confused, which is also what a real reveal
        // does.
        const reveal = (clear - p.clearWidth) / 2;
        assert.ok(reveal > 0.02,
          `${room.id}: the frame's jamb sits ${reveal.toFixed(3)}m from the corridor wall — `
          + 'that is the same plane, and it will shimmer');
        // ...but never so proud that it narrows the way through. The nav gate
        // reads the FRAME's half-band, so a greedy reveal starts refusing mobs
        // the corridor itself admits.
        assert.ok(gateAdmits(p.clearWidth / 2, WIDEST_ROAMER),
          `${room.id}: a ${p.clearWidth.toFixed(2)}m frame refuses the widest roamer, in a `
          + `${clear.toFixed(2)}m corridor that admits it`);
        assert.ok(p.clearWidth <= clear + 1e-6,
          `${room.id}: a ${p.clearWidth.toFixed(2)}m frame on a ${clear.toFixed(2)}m corridor — `
          + 'the passage does not fill its own doorway');
        assert.ok(p.width >= p.clearWidth - 1e-6,
          `${room.id}: the cut (${p.width.toFixed(2)}m) is shorter than the span it must clear `
          + `(${p.clearWidth.toFixed(2)}m) — that leaves masonry across the way through`);
        if (p.width > p.clearWidth + 0.05) chamfered++;
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} doorways sampled — this measured nothing`);
  // And the two genuinely differ somewhere, or the distinction is decorative and
  // the next reader collapses it again.
  assert.ok(chamfered > 10,
    `the cut and the clear span never disagreed across ${checked} doorways — either the `
    + 'shapes stopped being chamfered, or one of them is not being computed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
