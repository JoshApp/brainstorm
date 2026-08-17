// ── ONE FLOOR, ONE FRAME EMITTER ────────────────────────────────────────────
//
// There are two, and they are for different floor shapes:
//
//   emitFramesForPortals (level/portal-frames.ts) — the POLYGON path. Mounts a
//     gate square to the real wall edge, from a planned portal.
//   emitArchwaysForCorridors (level/clutter.ts) — the RECT path. Finds openings
//     from bounding-rect edges and can only face one of four world axes.
//
// portal-frames.ts states the split as settled fact: *"Frames were emitted by
// emitArchwaysForCorridors, which lives in the clutter pass and only ever runs
// on the vault path. Measured: 930 archways and 436 doorframes across 120 vault
// floors, and ZERO across 120 polygon floors."*
//
// It was measured once and stopped being true. Re-measured 2026-08-17 on 124
// generated polygon floors: 841 frames, 6.78 PER FLOOR. So every polygon doorway
// had been getting two gates — one square to its wall, one square to the world —
// and the strays were mostly CORRIDOR-TO-CORRIDOR, a gate dropped at a dogleg's
// bend where two legs of one passage meet. Josh, from in front of one: *"our
// archway doorway generation sometimes anchors in the room with weird geometry,
// there must be a systematic edgecase failure there of multiple kinds."*
//
// A comment cannot hold an invariant. This can.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { emitArchwaysForCorridors } from '../src/level/clutter';
import type { LevelSpec } from '../src/level/types';

const SEEDS = [1786919323103, 7, 4242, 90210, 31337, 11, 222, 3333, 44444, 555];
const DEPTHS = [1, 3, 6, 9];

function framesAdded(spec: LevelSpec): number {
  const before = (spec.props ?? []).length;
  emitArchwaysForCorridors(spec);
  return (spec.props ?? []).length - before;
}

test('the RECT frame emitter does not run on a polygon floor', () => {
  let floors = 0, total = 0;
  const worst: string[] = [];
  for (const seed of SEEDS) {
    for (const depth of DEPTHS) {
      const spec = generatePolyFloor(depth, seed);
      if (!spec.rooms.some((r) => r.poly && r.poly.length >= 3)) continue;
      floors++;
      const n = framesAdded(spec);
      total += n;
      if (n > 0 && worst.length < 5) worst.push(`seed=${seed} d${depth}: ${n} frames`);
    }
  }
  assert.ok(floors > 20, `only ${floors} polygon floors generated — the corpus is not running`);
  assert.equal(total, 0,
    `the rect emitter produced ${total} frames on ${floors} POLYGON floors `
    + `(${worst.join(', ')}). Polygon floors are portal-frames.ts's; a second `
    + 'emitter placing gates square to the world puts them at dogleg bends and '
    + 'inside rooms.');
});

test('...and it still runs where it IS the owner', () => {
  // The guard is only correct if it is narrow. A rect floor — the vault path and
  // the test chambers, which call this emitter directly — must still get frames,
  // or the fix has quietly deleted every doorway in the older half of the game.
  //
  // The rects must ABUT EXACTLY: wallOpenings requires the neighbour's edge to
  // land within 0.05m of the wall plane, not merely to overlap it. The first
  // version of this control floated the corridor in the gap between the rooms
  // and reported zero frames — which looked exactly like the guard being too
  // wide, and was not. Room A ends at z=4, the corridor runs 4..9, room B
  // starts at 9.
  const rectFloor: LevelSpec = {
    id: 'rect-test', depth: 1,
    rooms: [
      { id: 'a', rect: { x: 0, z: 0, w: 8, d: 8 }, height: 3.6 },
      { id: 'b', rect: { x: 0, z: 13, w: 8, d: 8 }, height: 3.6 },
    ],
    corridors: [
      { id: 'c', rect: { x: 0, z: 6.5, w: 2.2, d: 5 }, height: 2.6 },
    ],
    props: [],
    torches: [],
    spawns: [],
  } as unknown as LevelSpec;
  assert.ok(framesAdded(rectFloor) > 0,
    'a rect floor got NO frames — the polygon guard is too wide and has removed '
    + 'framing from the vault path and the test chambers');
});
