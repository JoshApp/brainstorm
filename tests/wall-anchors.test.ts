// ── WALL ANCHORS, AND WHAT THEY WOULD HAVE REFUSED ──────────────────────────
//
// level/wall-anchors.ts publishes the stretches of wall a room is willing to have
// a doorway cut from. Nothing consumes it yet — routing still discovers holes the
// old way — so this file does two jobs:
//
//   1. Pin the anchor derivation itself (one edge each, margins honoured,
//      classes consistent).
//   2. AUDIT the doorways the generator currently produces AGAINST the anchors
//      that would have been offered. That is the number that says whether the
//      model is worth wiring in, and whether CORNER_MARGIN at 0.75m is too
//      greedy — before any routing change can break a floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { planPortals } from '../src/level/portals';
import { describeWalls } from '../src/level/wall-surfaces';
import { WALL_T } from '../src/level/poly-shell-plan';
import {
  wallAnchors, anchorClassFor, anchorFits, anchorSpan, anchorsFor,
  CORNER_MARGIN, CLASS_WIDTH,
} from '../src/level/wall-anchors';

const SEEDS = [1786919323103, 7, 4242, 90210, 31337, 11, 222, 3333];
const DEPTHS = [1, 3, 6, 9];

/** The anchors a room offers, from its UNCUT ring. */
function anchorsOf(r: { poly?: unknown; height: number }) {
  const surfaces = describeWalls({
    poly: r.poly as never, height: r.height, elevation: 0, thickness: WALL_T,
  });
  return wallAnchors(surfaces);
}

test('an anchor belongs to ONE edge and honours both margins', () => {
  let checked = 0;
  for (const seed of SEEDS.slice(0, 4)) {
    for (const depth of DEPTHS) {
      const spec = generatePolyFloor(depth, seed);
      for (const r of spec.rooms) {
        if (!r.poly || r.poly.length < 3) continue;
        const surfaces = describeWalls({
          poly: r.poly as never, height: r.height, elevation: 0, thickness: WALL_T,
        });
        const anchors = wallAnchors(surfaces);
        assert.equal(anchors.length, surfaces.length, 'one anchor per wall face');
        for (let i = 0; i < anchors.length; i++) {
          const an = anchors[i], s = surfaces[i];
          assert.equal(an.edge, s.edge, 'anchor drifted off its face');
          const faceL = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
          const usableL = Math.hypot(an.b[0] - an.a[0], an.b[1] - an.a[1]);
          // The usable span is the face minus a margin at EACH end — and at zero
          // it collapses to the midpoint rather than inverting.
          const want = Math.max(0, faceL - 2 * CORNER_MARGIN);
          assert.ok(Math.abs(usableL - want) < 1e-6,
            `usable span ${usableL.toFixed(2)} on a ${faceL.toFixed(2)}m face, want ${want.toFixed(2)}`);
          assert.ok(Math.abs(an.usable - want) < 1e-6, 'reported usable disagrees with the span');
          assert.equal(an.cls, anchorClassFor(an.usable), 'class disagrees with its own span');
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} anchors — the corpus is not running`);
});

test('a class promises a width the anchor can actually hold', () => {
  // The vocabulary is only useful if asking for a class and asking for its width
  // can never disagree.
  for (const [cls, w] of Object.entries(CLASS_WIDTH)) {
    assert.equal(anchorClassFor(w), cls, `${cls} at its own width classifies as something else`);
    assert.notEqual(anchorClassFor(w - 0.01), cls, `${cls} accepts a span below its width`);
  }
  const fake = {
    edge: 0, a: [0, 0] as const, b: [3, 0] as const, mid: [1.5, 0] as const,
    inward: [0, 1] as const, facingY: 0, faceLength: 4.5, usable: 3, cls: 'gate' as const,
  };
  assert.ok(anchorFits(fake, 2.6) && !anchorFits(fake, 3.01));
  // A cut is CENTRED on the usable span and never clamped to fit.
  const span = anchorSpan(fake, 2)!;
  assert.ok(span, 'a fitting width produced no span');
  assert.ok(Math.abs(Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1]) - 2) < 1e-9);
  assert.equal(anchorSpan(fake, 4), null, 'an over-wide cut was clamped instead of refused');
  assert.equal(anchorsFor([fake], 4).length, 0);
});

test('AUDIT: how many of today\'s doorways would an anchor have granted?', () => {
  let portals = 0, straddle = 0, wouldGrant = 0, tooCloseToCorner = 0, noAnchorWide = 0;
  let roomsWithNoAnchorAtAll = 0, rooms = 0;
  const worst: string[] = [];

  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const spec = generatePolyFloor(depth, seed);
      for (const r of spec.rooms) {
        if (!r.poly || r.poly.length < 3) continue;
        rooms++;
        const anchors = anchorsOf(r);
        if (!anchors.some((a) => a.cls !== 'none')) roomsWithNoAnchorAtAll++;
        const ps = planPortals(r.id, r.poly as never,
          spec.corridors.map((c) => ({ id: c.id, rect: c.rect, link: c.linkId })) as never);
        for (const p of ps) {
          portals++;
          const cuts = (p as unknown as { cuts?: Array<{ edge: number }> }).cuts ?? [];
          const edges = new Set(cuts.map((c) => c.edge));
          if (edges.size > 1) { straddle++; continue; }
          const edge = [...edges][0] ?? p.edge;
          const an = anchors.find((x) => x.edge === edge);
          if (!an) continue;
          if (!anchorFits(an, p.clearWidth)) {
            // Distinguish "this wall is too short for this door" from "the door
            // is fine but sits in the corner margin" — different fixes.
            if (an.faceLength >= p.clearWidth) tooCloseToCorner++;
            else noAnchorWide++;
            if (worst.length < 8) {
              worst.push(`seed=${seed} d${depth} ${r.id} edge${edge}: needs `
                + `${p.clearWidth.toFixed(2)}m, face ${an.faceLength.toFixed(2)}m, `
                + `usable ${an.usable.toFixed(2)}m (${an.cls})`);
            }
            continue;
          }
          wouldGrant++;
        }
      }
    }
  }

  const pct = (n: number) => `${(100 * n / Math.max(1, portals)).toFixed(1)}%`;
  console.log('\n  ANCHOR AUDIT');
  console.log(`   portals                    ${portals}`);
  console.log(`   an anchor would grant      ${wouldGrant}  ${pct(wouldGrant)}`);
  console.log(`   straddles a bend           ${straddle}  ${pct(straddle)}`);
  console.log(`   fits the face, not the     ${tooCloseToCorner}  ${pct(tooCloseToCorner)}`);
  console.log(`     usable span (margins)`);
  console.log(`   face too short entirely    ${noAnchorWide}  ${pct(noAnchorWide)}`);
  console.log(`   rooms offering NO anchor   ${roomsWithNoAnchorAtAll} of ${rooms}`);
  for (const w of worst) console.log('   ', w);

  // The bar this has to clear to be worth wiring in: most doorways the generator
  // already makes must be ones an anchor would have granted. If the model refused
  // most of what works today, CORNER_MARGIN is too greedy or the classes are
  // wrong, and finding that out HERE is the entire point of auditing before
  // routing consumes it.
  assert.ok(wouldGrant / portals > 0.6,
    `an anchor would grant only ${pct(wouldGrant)} of existing doorways — the model `
    + 'is stricter than the dungeon it has to describe');
  // And a room that can host nothing is a room no corridor can reach.
  assert.ok(roomsWithNoAnchorAtAll / rooms < 0.05,
    `${roomsWithNoAnchorAtAll} of ${rooms} rooms offer no anchor at all`);
});
