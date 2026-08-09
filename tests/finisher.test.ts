// The finisher ceremony's CLOCK (src/combat/finisher.ts).
//
// The ceremony is feel work and most of it can only be judged on a phone — but
// its shape is not a matter of taste. The hush has to hold deep long enough to
// READ before it releases (the mistake bullet-time already made once with a
// plain linear ramp: the dip was there and nobody could see it), it has to
// finish, and it must not start counting while the hit-pause still has the
// world frozen — or the freeze silently eats the front of the window and the
// beat everyone tuned is not the beat that ships.
//
// So: assert the curve, not the vibe.

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import {
  triggerFinisher, tickFinisher, resetFinisher,
  finisherWorldTimeScale, finisherIntensity, isFinisherActive,
} from '../src/combat/finisher';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { resetFinisher(); fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

const C = CONFIG.EXECUTE.CEREMONY;

test('idle: no contribution at all', () => {
  assert.equal(finisherWorldTimeScale(), 1);
  assert.equal(finisherIntensity(), 0);
  assert.equal(isFinisherActive(), false);
});

test('opens at the floor — the deep part is there on frame one', () => {
  triggerFinisher();
  assert.equal(finisherWorldTimeScale(), C.WORLD_SCALE);
  assert.equal(finisherIntensity(), 1);
  assert.equal(isFinisherActive(), true);
});

test('HOLDS at the floor for the whole hold fraction', () => {
  triggerFinisher();
  // Step to just inside the end of the hold in 60Hz frames.
  const holdEnd = C.DURATION_S * C.HOLD_FRAC;
  let t = 0;
  while (t + 1 / 60 < holdEnd) { tickFinisher(1 / 60); t += 1 / 60; }
  assert.equal(finisherWorldTimeScale(), C.WORLD_SCALE, 'still at the floor inside the hold');
  // The hold has to be long enough to actually be seen — a handful of frames,
  // not one. (This is the regression bullet-time shipped once.)
  assert.ok(holdEnd > 6 / 60, `hold is ${(holdEnd * 1000).toFixed(0)}ms — too short to read`);
});

test('releases monotonically back to full speed, and ends', () => {
  triggerFinisher();
  let prev = finisherWorldTimeScale();
  for (let i = 0; i < 200; i++) {
    tickFinisher(1 / 60);
    const v = finisherWorldTimeScale();
    assert.ok(v >= prev - 1e-9, `time scale went backwards at step ${i}: ${prev} → ${v}`);
    prev = v;
  }
  assert.equal(finisherWorldTimeScale(), 1, 'back to full speed');
  assert.equal(finisherIntensity(), 0);
  assert.equal(isFinisherActive(), false);
});

test('the whole window is spent within DURATION_S of real time', () => {
  triggerFinisher();
  const steps = Math.ceil(C.DURATION_S * 60);
  for (let i = 0; i < steps; i++) tickFinisher(1 / 60);
  assert.equal(isFinisherActive(), false);
  // …and it was still live one step earlier, so the constant means what it says.
  resetFinisher();
  triggerFinisher();
  for (let i = 0; i < steps - 2; i++) tickFinisher(1 / 60);
  assert.equal(isFinisherActive(), true);
});

test('intensity tracks the dip exactly — one source of truth for every cue', () => {
  triggerFinisher();
  for (let i = 0; i < 40; i++) {
    tickFinisher(1 / 60);
    const expected = (1 - finisherWorldTimeScale()) / (1 - C.WORLD_SCALE);
    assert.ok(Math.abs(finisherIntensity() - expected) < 1e-9);
    assert.ok(finisherIntensity() >= -1e-9 && finisherIntensity() <= 1 + 1e-9);
  }
});

test('reset clears an in-flight hush (floor load must not carry it over)', () => {
  triggerFinisher();
  tickFinisher(1 / 60);
  assert.equal(isFinisherActive(), true);
  resetFinisher();
  assert.equal(isFinisherActive(), false);
  assert.equal(finisherWorldTimeScale(), 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
