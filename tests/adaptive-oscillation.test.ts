// ADAPTIVE RESOLUTION — the controller must not oscillate at the frame cap.
//
// Josh, standing perfectly still: "there is a frame spike every x seconds, the
// blue line jumps for a tick". Four recordings agreed — render·scene CPU going
// 8.4ms → 42-61ms, GPU flat through every spike, ZERO gc frames, zero compile
// gaps, and the frame before each spike submitting nothing at all (ub 0).
//
// The cause is a control-loop bug, not a workload, which is why standing still
// didn't help. RAISE_MS is 17ms and a 60fps cap pins dt at ~16.7ms, so
// `avgMs < RAISE_MS` is true WHENEVER THE GAME IS HITTING ITS CAP. A capped
// frame is not a fast frame — it is a frame that finished early and waited — so
// the controller read "we have headroom" from the one state that proves nothing.
// It stepped up, the higher scale cost more than DROP_MS, it stepped back down,
// sat at the cap, and read headroom again. Two states, forever.
//
// Every step calls setPS1Scale, which resizes the scene render targets:
// reallocating textures and forcing three to rebuild per-object bind groups.
// That is the render·scene spike. The measured gaps were 1.2-5.0s against a
// 1500ms cooldown — a cooldown gating an oscillator, not a workload appearing.
//
// The fix is remembering which scale already failed. These tests pin it.
//
//   npm test -- adaptive-oscillation

import assert from 'node:assert/strict';
import { applyStep, __adaptiveState, __resetAdaptive } from '../src/scene/adaptive-resolution';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const CAP_MS = 16.7;   // what a capped 60fps frame actually measures
const SLOW_MS = 30;    // a frame that genuinely blew the budget
let t = 0;
/** One step, always past the cooldown so the controller is free to act. */
const step = (ms: number): void => { t += 2000; applyStep(ms, t); };

test('a capped frame does not ratchet the scale upward forever', () => {
  __resetAdaptive(0.6, 1.0);
  // Drop once (something was genuinely slow), then sit at the cap for a long time.
  step(SLOW_MS);
  const afterDrop = __adaptiveState().scale;
  for (let i = 0; i < 50; i++) step(CAP_MS);
  assert.equal(
    __adaptiveState().scale, afterDrop,
    'the controller climbed back into a scale it had already dropped from — that is the oscillation, '
    + 'and every climb costs a render-target resize the player feels as a hitch',
  );
});

test('the scale that failed is remembered', () => {
  __resetAdaptive(0.6, 1.0);
  step(SLOW_MS);
  assert.equal(__adaptiveState().failedScale, 0.6);
});

test('it still drops when frames are genuinely slow', () => {
  __resetAdaptive(0.6, 1.0);
  step(SLOW_MS);
  assert.ok(__adaptiveState().scale < 0.6, 'a slow frame must still reduce resolution');
});

test('it can still raise when nothing has failed yet', () => {
  __resetAdaptive(0.5, 1.0);
  step(CAP_MS);
  assert.ok(__adaptiveState().scale > 0.5, 'with no failure on record, headroom should be taken');
});

test('a new ceiling clears the memory — a new regime deserves a fresh try', () => {
  __resetAdaptive(0.6, 1.0);
  step(SLOW_MS);
  assert.notEqual(__adaptiveState().failedScale, Infinity);
  __resetAdaptive(0.6, 0.8);
  assert.equal(__adaptiveState().failedScale, Infinity);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
