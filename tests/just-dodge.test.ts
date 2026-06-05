// Just-dodge — the perfect-dodge classifier + the reward lifecycle (slow-mo dip
// + counter window). Pure where it can be; the lifecycle runs synchronously so
// performance.now() elapsed is ~0, well inside the perfect window.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import {
  isPerfectDodge,
  noteDashStarted,
  notePlayerHitNegated,
  isJustDodgeCounterActive,
  consumeJustDodgeCounter,
  getJustDodgeTimeScale,
  tickJustDodge,
  resetJustDodge,
} from '../src/combat/just-dodge';

const W = CONFIG.JUST_DODGE.PERFECT_WINDOW_S * 1000;
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('isPerfectDodge: inside the window is perfect, outside is not', () => {
  assert.equal(isPerfectDodge(0), true, 'a negation the instant you dash');
  assert.equal(isPerfectDodge(W * 0.5), true, 'mid-window');
  assert.equal(isPerfectDodge(W), true, 'the exact edge still counts (forgiving)');
  assert.equal(isPerfectDodge(W + 1), false, 'just past the window = an early/safe dodge');
  assert.equal(isPerfectDodge(-1), false, 'negative is never perfect');
  assert.equal(isPerfectDodge(Infinity), false, 'no recent dash is never perfect');
});

test('a dodge with no recent dash earns nothing', () => {
  resetJustDodge();
  assert.equal(notePlayerHitNegated(), false, 'entry-grace invuln (no dash) is not a just-dodge');
  assert.equal(isJustDodgeCounterActive(), false, 'no counter window opened');
});

test('a perfectly-timed dodge opens the counter window + a slow-mo dip', () => {
  resetJustDodge();
  noteDashStarted();
  assert.equal(notePlayerHitNegated(), true, 'dash just fired → negation is perfect');
  assert.equal(isJustDodgeCounterActive(), true, 'counter window is live');
  assert.ok(getJustDodgeTimeScale() < 1, 'world slowed for the clarity beat');
});

test('the slow-mo dip eases back to full real-time', () => {
  resetJustDodge();
  noteDashStarted();
  notePlayerHitNegated();
  tickJustDodge(CONFIG.JUST_DODGE.SLOWMO_DURATION_S + 0.01);
  assert.equal(getJustDodgeTimeScale(), 1, 'time-scale restored once the dip elapses');
});

test('the counter is a single discrete punish — consuming closes the window', () => {
  resetJustDodge();
  noteDashStarted();
  notePlayerHitNegated();
  assert.equal(isJustDodgeCounterActive(), true);
  consumeJustDodgeCounter();
  assert.equal(isJustDodgeCounterActive(), false, 'spent on the counter hit');
});

test('reset clears any in-flight window + dip', () => {
  noteDashStarted();
  notePlayerHitNegated();
  resetJustDodge();
  assert.equal(isJustDodgeCounterActive(), false);
  assert.equal(getJustDodgeTimeScale(), 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
