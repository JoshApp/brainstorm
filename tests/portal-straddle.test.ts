// ── HOW OFTEN IS A DOORWAY CUT ACROSS A BEND? ───────────────────────────────
//
// planPortals groups hits into runs of ADJACENT edges, takes the widest run, and
// makes the frame square to the widest EDGE while sizing it to cover the whole
// run. Straddling a chamfer is therefore supported on purpose, and it works
// while a frame is there to cover it.
//
// It is not covered any more (frames are off while corridors are rebuilt), and
// Josh photographed the raw cut: *"the room had space for an anchor to the right
// but decided to do it in the middle of the bent room section, leaving a weird
// half arc opening horizontally, also part of the corridors ceiling and wall
// sticking inside the room."*
//
// MEASURED 2026-08-17 over 124 generated polygon floors, 1548 portals:
//
//     cut from ONE edge          1361   88%
//     straddling a bend           187   12.1%
//       ... of those, 3+ edges    105          up to SEVEN edges
//     sharpest bend straddled     180 degrees
//     bend severity          111 over 50 deg, 76 at 30-50, ZERO near-flat
//
// Nothing near-flat means every straddle is a real corner, not a rounding
// artefact. And 180 degrees means an opening cut across an edge AND its exact
// reverse — a corridor punched clean through a thin pocket wall and out the far
// side, which is not a doorway, it is demolition.
//
// Josh's own seed reproduces as one of these: poly-1 <- cor-l0-2, three edges,
// 90-degree bend, 2.13m clear. That is the doorway in the screenshot.
//
// THIS TEST DOES NOT ASSERT THE BUG IS FIXED. It is a characterisation test: it
// pins the current numbers so the next change to routing or portal planning has
// to state which way it moved them. Refusing a straddled portal is NOT available
// as a fix — planPortals `continue`s past it and the corridor stays, so the floor
// gets a passage with no opening, which is worse. The fix belongs in where a
// corridor ATTACHES, and this is the instrument for it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { planPortals } from '../src/level/portals';

const SEEDS = [1786919323103, 7, 4242, 90210, 31337, 11, 222, 3333];
const DEPTHS = [1, 3, 6, 9];

interface Tally { portals: number; straddling: number; threePlus: number; worstEdges: number; }

function survey(): Tally {
  const t: Tally = { portals: 0, straddling: 0, threePlus: 0, worstEdges: 0 };
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const spec = generatePolyFloor(depth, seed);
      for (const r of spec.rooms) {
        if (!r.poly || r.poly.length < 3) continue;
        const ps = planPortals(r.id, r.poly as never,
          spec.corridors.map((c) => ({ id: c.id, rect: c.rect, link: c.linkId })) as never);
        for (const p of ps) {
          t.portals++;
          const cuts = (p as unknown as { cuts?: Array<{ edge: number }> }).cuts ?? [];
          const edges = new Set(cuts.map((c) => c.edge)).size;
          t.worstEdges = Math.max(t.worstEdges, edges);
          if (edges > 1) t.straddling++;
          if (edges >= 3) t.threePlus++;
        }
      }
    }
  }
  return t;
}

test('the straddle rate is measured, and does not silently get worse', () => {
  const t = survey();
  assert.ok(t.portals > 300, `only ${t.portals} portals — the corpus is not running`);
  const pct = 100 * t.straddling / t.portals;
  // Bound set just above the measured 12.1% so a regression trips it. Lower it
  // when the attachment fix lands — that is the point of having it.
  assert.ok(pct <= 16,
    `${pct.toFixed(1)}% of doorways are cut across a bend (was 12.1% when measured). `
    + 'A straddled cut is not planar, so the wall, the corridor hull and the frame '
    + 'all disagree about where the opening is.');
  assert.ok(t.worstEdges <= 7,
    `an opening now spans ${t.worstEdges} edges (was 7). Past two this is not a `
    + 'doorway, it is a corridor eating a room.');
});

test('most doorways are cut from a single flat edge', () => {
  // The control on the bound above: if planning ever collapsed to "every opening
  // straddles", the percentage test could still pass on a technicality while the
  // dungeon fell apart. This states the shape of the distribution.
  const t = survey();
  const single = t.portals - t.straddling;
  assert.ok(single / t.portals > 0.8,
    `only ${(100 * single / t.portals).toFixed(1)}% of doorways come off one edge`);
});
