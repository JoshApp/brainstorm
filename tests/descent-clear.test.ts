// NOTHING STANDS ON THE WAY DOWN.
//
// Josh: *"some pillars can generate over the descent. The descent stairs are
// essential enough that it should happen early enough in the event passes, with
// intent, not to be overlapped with pillars etc."*
//
// The descent was already known where the room gets furnished — it is passed in
// — and was used only to light the way on. Nothing told the room's OCCUPANCY
// about it, so the interior planner, which reads occupancy footprints to decide
// where a colonnade can go, laid its pillars straight through the stair.
//
// Measured across 240 floors before the fix: 36 pillars within a metre of a
// stair (closest 0.47m) and 104 more between 1.0m and 2.2m. Only pillars —
// everything else already goes through the occupancy.
//
// The fix is a reservation, not a check in the pillar planner, for the reason
// tests/one-ring.test.ts exists: a rule that lives in one producer is a rule the
// next producer will break.
//
//   npm test -- descent-clear

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [1000, 1137, 1274, 1411, 1548, 1685, 7, 4242];
const DEPTHS = [1, 3, 5, 6, 8, 9, 11, 12];
let CORPUS: ReturnType<typeof generatePolyFloor>[] | null = null;
const floors = () => (CORPUS ??= SEEDS.flatMap((s) => DEPTHS.map((d) => generatePolyFloor(d, s))));

/** Things that BLOCK or hide the stair. Decals, cracks and scorch marks lie flat
 *  on the floor and are not in question. */
const BLOCKS = /pillar|chest|vase|offering|merchant|altar|basin|brazier|statue|spike/;
const kindOf = (p: { kind: string; _dbg?: string }) =>
  p.kind === 'model' ? `model:${p._dbg ?? '?'}` : p.kind;

test('NOTHING BLOCKING STANDS WITHIN REACH OF A DESCENT', () => {
  // 1.6m rather than the 2.2m the generator reserves: the assertion should fail
  // on the bug, not on the tuning. A pillar at 1.8m is a judgement call about
  // how much standing room a stair wants; a pillar at 0.5m is on the stair.
  const REACH = 1.6;
  let stairs = 0, checked = 0;
  for (const spec of floors()) {
    for (const st of spec.stairs ?? []) {
      stairs++;
      for (const p of spec.props ?? []) {
        const q = p as unknown as { kind: string; _dbg?: string; x?: number; z?: number };
        if (typeof q.x !== 'number' || typeof q.z !== 'number') continue;
        const k = kindOf(q);
        if (!BLOCKS.test(k)) continue;
        checked++;
        const d = Math.hypot(q.x - st.x, q.z - st.z);
        assert.ok(d >= REACH,
          `${spec.id}: a ${k} stands ${d.toFixed(2)}m from the descent — you cannot see or take the stair past it`);
      }
    }
  }
  assert.ok(stairs > 40, `only ${stairs} stairs sampled`);
  assert.ok(checked > 500, `only ${checked} blocking props considered — this measured nothing`);
});

test('...and the stair room still gets its architecture', () => {
  // The control, and the reason the fix is a RESERVATION rather than "do not
  // plan a colonnade in the stair room". Reserving the descent costs about one
  // pillar a floor (measured 6.8/floor before, 5.4/floor after); refusing the
  // room its colonnade outright would cost all of them and leave the one room
  // every player definitely visits as a bare box.
  let pillars = 0;
  for (const spec of floors()) {
    for (const p of spec.props ?? []) {
      if ((p as unknown as { kind: string }).kind === 'pillar') pillars++;
    }
  }
  const perFloor = pillars / floors().length;
  assert.ok(perFloor > 3,
    `${perFloor.toFixed(1)} pillars per floor — the descent reservation is eating the colonnades, `
    + 'not just the pillars that were standing on the stair');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
