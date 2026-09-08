// ── THE INVARIANT THAT MAKES THE WHOLE GAME'S 2D MATHS EXACT ─────────────────
//
// Josh, looking at the torch-culling bug: *"can we stop using 2d checks in a 3d game, are
// there other places its bad?"* — then, on the answer: *"lets do this properly first, if we
// need it later we can do it."*
//
// This file is "properly". The answer to the question was that the 2D checks are not an
// approximation of 3D — they are EXACT — and they are exact because of one property of the
// world that nothing was enforcing:
//
//   THE WALKABLE SURFACE IS A SINGLE-VALUED, CONTINUOUS HEIGHTFIELD.
//   Every discontinuity is a HOLE, which is 2D. The floor never STEPS.
//
// Given that, XZ determines Y. A range check that ignores Y is not throwing information
// away, because there was no information in Y that XZ did not already carry. Interactable
// reach, auto-pickup, aggro radius, pack spacing, AoE rites, the spike plate — all of them
// are correct for this reason and for no other.
//
// ── WHY IT NEEDS A TEST AND NOT A COMMENT ───────────────────────────────────
//
// `walkable.ts` has NO height model at all: `contains` and `clampMove` are pure XZ, and
// nothing in the game stops you walking up a vertical face. The invariant is the only
// reason that has never been a bug. So the day someone breaks it — a sunken room with a
// stepped lip is the obvious way — nothing anywhere notices. A hundred range checks
// quietly stop being exact, with no error bound, and it surfaces as a hundred
// unrelated-looking gameplay bugs: a mob aggroing through a floor, a chest prompting from a
// level below, a blast reaching down a pit.
//
// A comment cannot catch that. This can.
//
// ── AND IT SWEEPS RATHER THAN SPOT-CHECKS ───────────────────────────────────
//
// A step in a floor is a THIN RING — the lip of a pit, the edge of a dais — so scattered
// sample points can very nearly miss it. Fault-injected with a stepped sunken room, a
// lattice of 129k points caught it on 3 samples. That is a pass/fail decision resting on
// luck. So the floor is swept by TRANSECTS at the finite-difference spacing instead: any
// closed lip inside a rect is crossed by a line across that rect, by construction.
//
// ── AND IT MEASURES THE SHIPPING FUNCTION ───────────────────────────────────
//
// `groundYAt` itself, off a real generated floor, per docs/DESIGN-METHOD.md — a report that
// re-derives the rule launders a guess as a measurement.
//
// ── SAMPLING ONLY REAL FLOOR IS THE WHOLE DIFFICULTY ────────────────────────
//
// Outside a room's polygon or a corridor's rect the field takes a nearest-rect fallback
// which is ALLOWED to jump — that space is inside a wall and nobody stands in it. The first
// version of this measurement read that fallback and reported a gradient of 18.2, which was
// a wall rather than a cliff. So both ends of every finite difference must land on floor.

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { buildElevationField, setElevationField, groundYAt } from '../src/level/elevation';
import { pointInPoly } from '../src/level/room-shape';
import { CONFIG } from '../src/config';
import type { RoomSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 8, 11];
/** The step the finite difference is taken over. Small enough to read a STEP as the cliff
 *  it is rather than averaging it away across a metre of honest slope. */
const EPS = 0.05;
/** Transects across each rect, per axis. A closed step inside a rect cannot avoid them. */
const TRANSECTS = 9;

interface Sample { grade: number; where: string }

/** Every local floor gradient on a floor, sampled where both ends are real floor. */
function gradients(spec: { rooms: RoomSpec[]; corridors: RoomSpec[] }, label: string): Sample[] {
  setElevationField(buildElevationField(spec.rooms, spec.corridors));
  const out: Sample[] = [];
  for (const room of [...spec.rooms, ...spec.corridors]) {
    const rc = room.rect;
    const poly = room.poly;
    const inside = (x: number, z: number): boolean => poly
      ? pointInPoly(x, z, poly)
      : Math.abs(x - rc.x) <= rc.w / 2 && Math.abs(z - rc.z) <= rc.d / 2;
    // Deterministic, and a SWEEP: lines across the rect on both axes, stepped at EPS.
    const probe = (x: number, z: number): void => {
      if (!inside(x, z) || !inside(x + EPS, z) || !inside(x, z + EPS)) return;
      const y = groundYAt(x, z);
      const gx = (groundYAt(x + EPS, z) - y) / EPS;
      const gz = (groundYAt(x, z + EPS) - y) / EPS;
      out.push({
        grade: Math.hypot(gx, gz),
        where: `${label} ${room.id} @(${x.toFixed(1)}, ${z.toFixed(1)})`,
      });
    };
    for (let t = 1; t <= TRANSECTS; t++) {
      const f = t / (TRANSECTS + 1);
      const zLine = rc.z + (f - 0.5) * rc.d;
      for (let x = rc.x - rc.w / 2; x <= rc.x + rc.w / 2; x += EPS) probe(x, zLine);
      const xLine = rc.x + (f - 0.5) * rc.w;
      for (let z = rc.z - rc.d / 2; z <= rc.z + rc.d / 2; z += EPS) probe(xLine, z);
    }
  }
  return out;
}

const ALL: Sample[] = [];
for (const seed of SEEDS) {
  for (const depth of DEPTHS) {
    ALL.push(...gradients(generatePolyFloor(depth, seed) as never, `d${depth}/s${seed}`));
  }
}

test('THE WALKABLE FLOOR NEVER STEPS — it is a continuous heightfield', () => {
  const max = CONFIG.ELEVATION_MAX_GRADE;
  let worst: Sample = { grade: 0, where: '(nothing sampled)' };
  let over = 0;
  for (const s of ALL) {
    if (s.grade > max + 1e-6) over++;
    if (s.grade > worst.grade) worst = s;
  }
  assert.equal(over, 0,
    `${over} of ${ALL.length} floor samples exceed ELEVATION_MAX_GRADE (${max}). `
    + `Worst ${worst.grade.toFixed(3)} at ${worst.where} — a ${(worst.grade * EPS).toFixed(2)}m `
    + `step over ${EPS}m. That is a CLIFF, and walkable.ts has no height model to stop a body `
    + 'walking off it or up it. Every XZ-only range check in the game silently stops being '
    + 'exact the moment this fails — see this file\'s header.');
});

test('...and the sample is not vacuously flat', () => {
  // A floor generator that stopped producing elevation at all would pass the test above
  // perfectly while proving nothing. So the sample has to contain real slope.
  assert.ok(ALL.length > 20000, `only ${ALL.length} floor samples — the sampler found no floor`);
  const sloped = ALL.filter((s) => s.grade > 0.01).length;
  const frac = sloped / ALL.length;
  assert.ok(frac > 0.05,
    `only ${(frac * 100).toFixed(1)}% of the floor has any slope — either elevation stopped `
    + 'being generated, or this test is no longer measuring the thing it claims to');
  // And the generator should be USING its grade budget, not sitting far under it: a limit
  // nothing approaches is not the thing keeping the floor continuous.
  const maxSeen = ALL.reduce((m, s) => Math.max(m, s.grade), 0);
  assert.ok(maxSeen > CONFIG.ELEVATION_MAX_GRADE * 0.9,
    `steepest floor seen is ${maxSeen.toFixed(3)} against a budget of `
    + `${CONFIG.ELEVATION_MAX_GRADE} — the grade limit is not what is holding the floor flat, `
    + 'so this test is not proving what it says it proves');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
