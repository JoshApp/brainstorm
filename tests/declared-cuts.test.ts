// ── THE CUT IS DECLARED, NOT REDISCOVERED ────────────────────────────────────
//
// Stage 3 of docs/LINKS-V3.md, rule 3. The router picks an anchor and negotiates a
// width against it, so at that moment it knows exactly which edge the doorway is in
// and how far along it runs. It used to throw that away, build a rect stabbing 0.9m
// THROUGH the wall, and let a later pass intersect the rect with the polygon to work
// out where the hole must have been meant to go.
//
// This file is the gate on the declaration being CORRECT before anything consumes
// it. `Link.aCut` / `bCut` are compared against the holes the shipping rediscovery
// finds, over the real corpus. Two things have to be true:
//
//   1. The declared cut is in the SAME EDGE the rediscovery found. An edge
//      disagreement is the corner-wrapping bug: a hole recovered from a bounding
//      box lands wherever the box crossed, which may be round a corner.
//   2. The declared span COVERS the passage. Narrower than the rediscovered hole is
//      expected and fine — the rediscovered one is a rect's shadow on the wall and
//      the declaration is the negotiated width — but it may not miss it.
//
//   npm test -- declared-cuts

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { deriveAnchors } from '../src/level/anchors';
import { planPortals } from '../src/level/portals';
import type { Poly } from '../src/level/room-shape';
import type { WallCut } from '../src/level/link';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 6, 8, 11];

/** Every declared cut on the corpus, paired with the room whose wall it cuts. */
type Case = {
  seed: number; depth: number; roomId: string; poly: Poly;
  cut: WallCut; corridors: Array<{ id: string; rect: { x: number; z: number; w: number; d: number } }>;
};
function cases(): Case[] {
  const out: Case[] = [];
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      let spec;
      try { spec = generatePolyFloor(depth, seed); } catch { continue; }
      const byId = new Map(spec.rooms.map((r) => [r.id, r]));
      const corridors = (spec.corridors ?? [])
        .filter((c) => !c.logicalOnly)
        .map((c) => ({ id: c.id, rect: c.rect }));
      // One link per CONNECTION, not per rect: a dogleg's legs share a link and
      // would otherwise be counted twice with identical cuts.
      const seen = new Set<string>();
      for (const c of spec.corridors ?? []) {
        const link = c.link;
        if (!link || seen.has(c.linkId ?? c.id)) continue;
        seen.add(c.linkId ?? c.id);
        for (const [roomId, cut] of [
          [link.fromRoom, link.aCut] as const,
          [link.toRoom, link.bCut] as const,
        ]) {
          const room = byId.get(roomId);
          if (!room?.poly || room.poly.length < 3) continue;
          out.push({ seed, depth, roomId, poly: room.poly as Poly, cut, corridors });
        }
      }
    }
  }
  return out;
}

const CASES = cases();

test('the corpus produced declared cuts to check', () => {
  assert.ok(CASES.length > 400, `only ${CASES.length} declared cuts — this measured nothing`);
});

test('A DECLARED CUT LIES INSIDE THE ANCHOR THAT PUBLISHED IT', () => {
  // The cheapest possible check and the one that catches a parameterisation slip:
  // an anchor's t0/t1 are METRES along its edge and a cut's are a FRACTION of it.
  // Mixing the two produces a cut that is silently in the right edge and the wrong
  // place — on a 6m wall, a 2.2m opening declared in metres reads as 220% of the
  // edge and every doorway on the floor walks off the end of its own wall.
  for (const c of CASES) {
    assert.ok(c.cut.t0 >= -1e-6 && c.cut.t1 <= 1 + 1e-6,
      `${c.roomId} d${c.depth}/s${c.seed}: cut runs ${c.cut.t0.toFixed(3)}..${c.cut.t1.toFixed(3)} `
      + '— outside its own edge, which is the metres-vs-fraction mix-up');
    assert.ok(c.cut.t1 > c.cut.t0,
      `${c.roomId} d${c.depth}/s${c.seed}: cut is inverted or empty`);
    const anchors = deriveAnchors(c.roomId, c.poly, 3);
    const own = anchors.find((a) => a.edge === c.cut.edge);
    assert.ok(own, `${c.roomId} d${c.depth}/s${c.seed}: cut is in edge ${c.cut.edge}, `
      + 'which publishes no anchor at all — the router cut a wall that never offered');
    const len = own!.edgeLength;
    assert.ok(c.cut.t0 * len >= own!.t0 - 0.01 && c.cut.t1 * len <= own!.t1 + 0.01,
      `${c.roomId} d${c.depth}/s${c.seed}: cut spans ${(c.cut.t0 * len).toFixed(2)}..`
      + `${(c.cut.t1 * len).toFixed(2)}m, outside the anchor's published `
      + `${own!.t0.toFixed(2)}..${own!.t1.toFixed(2)}m`);
  }
});

test('AND IT AGREES WITH THE HOLE THE RECTS ARE CURRENTLY CUTTING', () => {
  // The migration gate. If the declaration and the rediscovery disagree about which
  // EDGE a doorway is in, then swapping the consumer over moves doorways, and the
  // whole point of stage 3 is that it must not — it removes a round trip, it does
  // not redesign where doors go.
  //
  // Reported as a rate rather than asserted per-case: the rediscovery is the thing
  // being replaced BECAUSE it is wrong sometimes, so a handful of disagreements are
  // the defect, not the regression. The bar is that they are rare enough that the
  // swap is a cleanup and not a redesign.
  let checked = 0, sameEdge = 0, covered = 0;
  for (const c of CASES) {
    const found = planPortals(c.roomId, c.poly, c.corridors);
    const holes = found.flatMap((p) => p.cuts);
    if (!holes.length) continue;
    checked++;
    const mine = holes.filter((h) => h.edge === c.cut.edge);
    if (mine.length) {
      sameEdge++;
      // Overlap, not containment: the rediscovered hole is a rect's shadow and the
      // declaration is the negotiated width, so neither contains the other.
      if (mine.some((h) => Math.min(h.t1, c.cut.t1) > Math.max(h.t0, c.cut.t0))) covered++;
    }
  }
  assert.ok(checked > 400, `only ${checked} comparable cuts`);
  const edgeRate = sameEdge / checked;
  const overlapRate = covered / checked;
  assert.ok(edgeRate > 0.9,
    `only ${(edgeRate * 100).toFixed(1)}% of declared cuts are in an edge the rects also `
    + 'cut — swapping the consumer would move doorways, not just stop rediscovering them');
  assert.ok(overlapRate > 0.85,
    `only ${(overlapRate * 100).toFixed(1)}% of declared cuts overlap the rediscovered hole`);
  console.log(`  ${checked} cuts: ${(edgeRate * 100).toFixed(1)}% same edge, `
    + `${(overlapRate * 100).toFixed(1)}% overlapping`);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
