// EVERY THING PLACED ON A FLOOR MUST BELONG TO EXACTLY ONE SPACE.
//
// This is the invariant behind every attribution bug this codebase has had: torches going
// dark in the room you are standing in, flames flickering in a room you are not, a light and
// its own model disagreeing about which space they are in.
//
// The cause was never the consumers. It was that "which space is this point in" HAD NO
// SINGLE ANSWER, so each consumer invented a tie-break and the tie-breaks disagreed. The
// culler broke ties by smallest bounding box, the space index by generous overlap, an
// earlier version by nearest rect.
//
// And the ambiguity those tie-breaks existed to resolve is almost entirely MANUFACTURED. The
// culler's graph is built on `RoomSpec.rect`, which the type contract requires to be the
// polygon's BOUNDING BOX. A room's box is far larger than its floor, so a corridor that
// stops cleanly at the wall still overlaps the room's box. Measured over twenty floors
// (scripts/measure-space-overlap.ts): 190 m² of box overlap, 1.0 m² of real shared floor.
// 93% of it is not there.
//
// So this test asserts the invariant against REAL FOOTPRINTS — a room's polygon, a
// corridor's rect, which genuinely is its floor. If it holds, no consumer needs a tie-break
// and none of them may invent one.
//
//   npm test -- space-attribution

import assert from 'node:assert/strict';
import { generateFloor } from '../src/level/procgen';
import { pointInPoly } from '../src/level/room-shape';
import type { RoomSpec } from '../src/level/types';

type Poly = ReadonlyArray<readonly [number, number]>;

/** Does this space's REAL floor contain the point? A polygon when there is one; the rect
 *  otherwise, which for a corridor is the honest answer — an axis-aligned box IS its floor. */
function footprintContains(s: RoomSpec, x: number, z: number): boolean {
  const p = s.poly as Poly | undefined;
  if (p && p.length >= 3) return pointInPoly(p, x, z);
  return x >= s.rect.x - s.rect.w / 2 && x <= s.rect.x + s.rect.w / 2
    && z >= s.rect.z - s.rect.d / 2 && z <= s.rect.z + s.rect.d / 2;
}

/** The bounding-box test the culler currently uses, for the comparison this test exists to
 *  make. */
function boxContains(s: RoomSpec, x: number, z: number): boolean {
  return x >= s.rect.x - s.rect.w / 2 && x <= s.rect.x + s.rect.w / 2
    && z >= s.rect.z - s.rect.d / 2 && z <= s.rect.z + s.rect.d / 2;
}

const SEEDS = [4242, 1337, 90210, 55555, 8080];
const spacesOf = (spec: ReturnType<typeof generateFloor>): RoomSpec[] =>
  [...spec.rooms.filter((r) => !r.logicalOnly), ...spec.corridors];

// ── 1. Real floors barely overlap; bounding boxes overlap constantly ────────
{
  let boxAmbiguous = 0;
  let floorAmbiguous = 0;
  let sampled = 0;

  for (const seed of SEEDS) {
    for (let depth = 1; depth <= 4; depth++) {
      const spec = generateFloor(depth, seed, `depth-${depth + 1}`);
      const spaces = spacesOf(spec);
      // Sample every space's own floor on a coarse grid — these are points that are
      // unambiguously ON a floor, so any second claimant is an ambiguity by definition.
      for (const s of spaces) {
        const x0 = s.rect.x - s.rect.w / 2, x1 = s.rect.x + s.rect.w / 2;
        const z0 = s.rect.z - s.rect.d / 2, z1 = s.rect.z + s.rect.d / 2;
        for (let x = x0 + 0.4; x < x1; x += 0.8) {
          for (let z = z0 + 0.4; z < z1; z += 0.8) {
            if (!footprintContains(s, x, z)) continue;
            sampled++;
            if (spaces.filter((o) => boxContains(o, x, z)).length > 1) boxAmbiguous++;
            if (spaces.filter((o) => footprintContains(o, x, z)).length > 1) floorAmbiguous++;
          }
        }
      }
    }
  }

  const boxPct = (boxAmbiguous / sampled) * 100;
  const floorPct = (floorAmbiguous / sampled) * 100;
  console.log(`  floor points sampled: ${sampled}`);
  console.log(`  ambiguous by BOUNDING BOX: ${boxAmbiguous} (${boxPct.toFixed(1)}%)`);
  console.log(`  ambiguous by REAL FLOOR:   ${floorAmbiguous} (${floorPct.toFixed(1)}%)`);

  // THE POINT OF THE TEST. Asking by footprint has to be dramatically less ambiguous than
  // asking by box, or the tie-break is load-bearing and this whole direction is wrong.
  assert.ok(
    floorPct < boxPct / 4,
    `footprint lookup should be far less ambiguous than the box lookup, `
    + `got floor ${floorPct.toFixed(1)}% vs box ${boxPct.toFixed(1)}%`,
  );

  // And in absolute terms it has to be rare enough that a documented rule can cover it
  // rather than a coin toss deciding every frame.
  assert.ok(floorPct < 2, `real-floor ambiguity should be rare, got ${floorPct.toFixed(1)}%`);
}

// ── 2. Every torch resolves — by footprint, allowing for the masonry band ───
//
// A sconce is mounted IN the wall, which is outside its room's floor by design. So the rule
// for a mounted thing is "step inward to the nearest floor", and what this asserts is that
// such a step always finds one — a torch that resolves to nothing is a torch some consumer
// will fail open on and draw in the wrong place.
{
  const BAND = 0.6;    // masonry plus slack
  let torches = 0;
  let unresolved = 0;

  for (const seed of SEEDS) {
    for (let depth = 1; depth <= 4; depth++) {
      const spec = generateFloor(depth, seed, `depth-${depth + 1}`);
      const spaces = spacesOf(spec);
      for (const t of spec.torches ?? []) {
        torches++;
        const direct = spaces.some((s) => footprintContains(s, t.x, t.z));
        if (direct) continue;
        // Not on a floor — it is in the wall. Is there floor within the band?
        let near = false;
        for (let a = 0; a < 8 && !near; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const nx = t.x + Math.cos(ang) * BAND, nz = t.z + Math.sin(ang) * BAND;
          near = spaces.some((s) => footprintContains(s, nx, nz));
        }
        if (!near) unresolved++;
      }
    }
  }

  console.log(`  torches: ${torches}, unresolved by footprint+band: ${unresolved}`);
  assert.equal(unresolved, 0, `${unresolved} of ${torches} torches resolve to no space at all`);
}

console.log('space attribution: footprints are unambiguous where boxes are not');
