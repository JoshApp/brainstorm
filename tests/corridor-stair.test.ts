// A STAIR IS A SECTION NOW, AND A SECTION HAS TO SURVIVE THE GENERATOR.
//
// Josh: *"lets do stairs as corridor section"* — then, on the first cut: *"i rather like the
// stairs going all the way ... a fully staired corridor should be possible ... and the ceiling
// should slowly descend with the stairs."*
//
// Five things are checked, and each is a way this quietly rots back into what it replaced.
//
//   1. THE STONE IS STAIR-SHAPED. The defect the section exists to fix was measured, not felt:
//      tread depth p50 1.86m, up to 6.54m, a depth-to-rise ratio of 11 against a real stair's
//      1.6. Those are terraces. If the ratio drifts back up, the section has stopped working
//      and nothing else in the game would say so.
//   2. FLIGHTS END ON A WHOLE STEP. `fall = steps × rise` exactly, or the bottom tread is a
//      stub and reads as a mistake in the stone.
//   3. BOTH SHAPES ACTUALLY HAPPEN. A vocabulary of two words where the generator only ever
//      produces one is a vocabulary of one word.
//   4. THE GRADE STAYS INSIDE THE BUDGET. `corridorRampRun` is the cap's one owner and the
//      section is what spends it; if a flight can come out steeper than
//      ELEVATION_MAX_GRADE, the floor-continuity invariant goes with it.
//   5. THE CEILING HAS NO CORNER IN IT. The whole point of the rounded knee. A ceiling that
//      is C0 but not C1 is the crease Josh photographed, and it is invisible in a screenshot
//      until you stand under it.

import assert from 'node:assert/strict';
import { generatePolyFloor } from '../src/level/poly-floor';
import { planFlight, maxFlightRun, roundedRampProfile } from '../src/level/corridor-stair';
import { CONFIG } from '../src/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const SEEDS = [7, 4242, 90210, 31337, 11, 222, 3333, 44444];
const DEPTHS = [1, 2, 5, 8, 11];

interface Run { fall: number; run: number; grade: number; rise: number; going: number;
                steps: number; shape: string; t0: number; t1: number; len: number }
const STAIRS: Run[] = [];
for (const seed of SEEDS) {
  for (const depth of DEPTHS) {
    const spec = generatePolyFloor(depth, seed) as never as {
      corridors: Array<{ rect: { w: number; d: number }; rampAlongX?: boolean; stair?: Run }>;
    };
    for (const c of spec.corridors) {
      if (!c.stair) continue;
      STAIRS.push({ ...c.stair, len: c.rampAlongX ? c.rect.w : c.rect.d });
    }
  }
}

test('the generator actually builds stairs', () => {
  assert.ok(STAIRS.length > 60, `only ${STAIRS.length} stair runs in the sample`);
});

test('THE STONE IS STAIR-SHAPED — treads, not terraces', () => {
  // The pre-section median was 11 and the max 38. A real stair is about 1.6; the section
  // targets 2.6 because the camera glides the grade rather than climbing steps (see
  // TARGET_GRADE). This is the guard against sliding back, not a claim of realism.
  const ratios = STAIRS.map((s) => s.going / s.rise).sort((a, b) => a - b);
  const p50 = ratios[Math.floor(ratios.length * 0.5)];
  const p90 = ratios[Math.floor(ratios.length * 0.9)];
  assert.ok(p50 < 4, `median tread depth is ${p50.toFixed(1)}× its rise — terraces, not stairs`);
  assert.ok(p90 < 9, `p90 tread depth is ${p90.toFixed(1)}× its rise`);
  // And no single run may be absurd, which is where the 6.54m tread lived.
  const worst = STAIRS.reduce((m, s) => (s.going > m.going ? s : m), STAIRS[0]);
  assert.ok(worst.going < 1.6,
    `a tread ${worst.going.toFixed(2)}m deep (${worst.shape}, fall ${worst.fall.toFixed(2)}m over `
    + `${worst.run.toFixed(2)}m) — that is a landing with ideas`);
});

test('a flight ends on a WHOLE step', () => {
  for (const s of STAIRS) {
    assert.ok(Math.abs(s.steps * s.rise - s.fall) < 1e-6,
      `${s.steps} steps of ${s.rise.toFixed(3)}m do not add up to a ${s.fall.toFixed(3)}m fall`);
    assert.ok(s.steps >= 1 && Number.isInteger(s.steps), `${s.steps} steps is not a whole number`);
  }
});

test('BOTH SHAPES happen — a full staircase and a flight with landings', () => {
  const full = STAIRS.filter((s) => s.shape === 'full').length;
  const flight = STAIRS.filter((s) => s.shape === 'flight').length;
  assert.ok(full > 5, `only ${full} corridors are stairs end to end — 'full' is a dead word`);
  assert.ok(flight > 5, `only ${flight} corridors carry a compact flight — 'flight' is a dead word`);
  // A full stair uses essentially the whole corridor; a flight leaves real landing behind it.
  for (const s of STAIRS) {
    if (s.shape !== 'full') continue;
    assert.ok(s.run > s.len - 1.05,
      `a 'full' stair spends its fall over ${s.run.toFixed(2)}m of a ${s.len.toFixed(2)}m corridor `
      + '— that is a flight wearing the wrong word');
  }
});

test('the grade never leaves the budget', () => {
  const max = CONFIG.ELEVATION_MAX_GRADE;
  for (const s of STAIRS) {
    assert.ok(s.grade <= max + 1e-6,
      `a ${s.shape} falls ${s.fall.toFixed(2)}m over ${s.run.toFixed(2)}m — grade `
      + `${s.grade.toFixed(3)} against a budget of ${max}. tests/elevation-continuity.test.ts `
      + 'is what breaks next.');
    // And the cap's one owner has to bound it, whichever shape was chosen.
    assert.ok(s.fall / maxFlightRun(s.len) <= max + 1e-6,
      'corridorRampRun no longer bounds the grade the section actually builds');
  }
});

test('THE FLOOR HAS NO CORNER IN IT — and so neither has the ceiling', () => {
  // The ceiling is `floor + H`, so a crease in one is a crease in the other. Sampled as second
  // differences: a slope break shows up as a spike no matter how small the step. The rounded
  // knee passes; the hard corner it replaced — slope jumping from 0 to the grade between two
  // adjacent samples — does not.
  for (const s of STAIRS.slice(0, 200)) {
    const N = 400;
    let prevSlope: number | null = null;
    let worstBreak = 0;
    for (let i = 1; i <= N; i++) {
      const a = roundedRampProfile((i - 1) / N, s.t0, s.t1, s.len);
      const b = roundedRampProfile(i / N, s.t0, s.t1, s.len);
      const slope = (b - a) * N;
      if (prevSlope !== null) worstBreak = Math.max(worstBreak, Math.abs(slope - prevSlope));
      prevSlope = slope;
    }
    // The rake's own slope is 1/(t1-t0); a genuine corner delivers all of it at once.
    const rakeSlope = 1 / Math.max(1e-6, s.t1 - s.t0);
    assert.ok(worstBreak < rakeSlope * 0.25,
      `the floor of a ${s.shape} breaks slope by ${worstBreak.toFixed(2)} against a rake of `
      + `${rakeSlope.toFixed(2)} — that is the corner the rounded knee exists to remove`);
  }
  // ...and it still gets all the way down: an ease so soft it never arrives would pass the
  // test above and leave the bottom of the flight above the room it opens into.
  for (const s of STAIRS) {
    assert.ok(Math.abs(roundedRampProfile(0, s.t0, s.t1, s.len)) < 1e-6, 'the ramp starts below its top');
    assert.ok(Math.abs(roundedRampProfile(1, s.t0, s.t1, s.len) - 1) < 1e-6, 'the ramp never reaches its bottom');
  }
});

test('a level corridor is not a stair with zero steps', () => {
  assert.equal(planFlight(0, 6), null, 'a corridor that does not fall should carry no stair');
  assert.equal(planFlight(1e-9, 6), null, 'a rounding error is not a staircase');
  assert.ok(planFlight(0.6, 6) !== null, 'a real fall should carry a stair');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
