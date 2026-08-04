// Ambient light → wick lift. The mapping and the smoother, which are the two
// parts that can be wrong in a way you'd only notice on a bus at noon.
//
//   npm test

import assert from 'node:assert/strict';
import { liftForLux, tickAmbientLight, ambientLux, ambientWickLift, stopAmbientLight } from '../src/settings/ambient-light';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  stopAmbientLight();
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
  stopAmbientLight();
}

test('a dark room is left exactly as authored', () => {
  assert.equal(liftForLux(0), 1);
  assert.equal(liftForLux(1), 1);
  assert.equal(liftForLux(12), 1);
});

test('the lift only ever raises, never crushes', () => {
  for (const lux of [0, 5, 12, 40, 300, 2000, 50_000, 1e6]) {
    assert.ok(liftForLux(lux) >= 1, `lux ${lux} produced a lift below 1`);
  }
});

test('daylight is capped — the dungeon never fully stops being dark', () => {
  const capped = liftForLux(1e6);
  assert.ok(capped <= 1.85 + 1e-9, `runaway lift ${capped}`);
  assert.equal(liftForLux(1e6), liftForLux(4000), 'past the top of the ramp it should stay put');
});

test('the ramp is monotonic and log-shaped, not linear', () => {
  const a = liftForLux(24), b = liftForLux(240), c = liftForLux(2400);
  assert.ok(a < b && b < c, 'not monotonic');
  // Each ×10 of lux should buy a similar slice of the lift. A LINEAR ramp would
  // spend almost nothing on the first decade and everything on the last.
  const first = b - a, second = c - b;
  assert.ok(Math.abs(first - second) < 0.12,
    `decades bought very different lifts: ${first.toFixed(3)} vs ${second.toFixed(3)}`);
});

test('nonsense readings cannot move the wick', () => {
  assert.equal(liftForLux(-5), 1);
  assert.equal(liftForLux(NaN), 1);
});

test('with no sensor at all, everything is inert', () => {
  // No reading has ever arrived (this is every iPhone, and every desktop).
  tickAmbientLight(1);
  assert.equal(ambientLux(), null);
  assert.equal(ambientWickLift(), 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
