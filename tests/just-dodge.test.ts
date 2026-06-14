// Just-dodge — the perfect-dodge classifier + the reward lifecycle (counter
// window; the slow-mo itself now lives in reactive-defense's bullet-time). The
// reward is fired enemy-side via tryJustDodge when a strike connects with a
// precisely-rolled player — NOT off the i-frame flag. Pure where it can be;
// the lifecycle runs synchronously so performance.now() elapsed is ~0, well
// inside the perfect window.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import {
  isPerfectDodge,
  noteDashStarted,
  tryJustDodge,
  isJustDodgeCounterActive,
  consumeJustDodgeCounter,
  resetJustDodge,
} from '../src/combat/just-dodge';

const W = CONFIG.JUST_DODGE.PERFECT_WINDOW_S * 1000;
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('isPerfectDodge: inside the window is perfect, outside is not', () => {
  assert.equal(isPerfectDodge(0), true, 'a strike the instant you roll');
  assert.equal(isPerfectDodge(W * 0.5), true, 'mid-window');
  assert.equal(isPerfectDodge(W), true, 'the exact edge still counts (forgiving)');
  assert.equal(isPerfectDodge(W + 1), false, 'just past the window = an early/safe roll');
  assert.equal(isPerfectDodge(-1), false, 'negative is never perfect');
  assert.equal(isPerfectDodge(Infinity), false, 'no recent roll is never perfect');
});

test('tryJustDodge with no recent roll earns nothing', () => {
  resetJustDodge();
  assert.equal(tryJustDodge(), false, 'entry-grace invuln (no roll) is not a just-dodge');
  assert.equal(isJustDodgeCounterActive(), false, 'no counter window opened');
});

test('a precisely-timed roll opens the counter window', () => {
  resetJustDodge();
  noteDashStarted();
  assert.equal(tryJustDodge(), true, 'roll just fired → the strike is a perfect dodge');
  assert.equal(isJustDodgeCounterActive(), true, 'counter window is live');
});

test('the reward fires once per roll — a flurry does not re-trigger', () => {
  resetJustDodge();
  noteDashStarted();
  assert.equal(tryJustDodge(), true, 'first strike of the flurry pays out');
  assert.equal(tryJustDodge(), false, 'second strike in the same roll does not');
});

test('the counter is a single discrete punish — consuming closes the window', () => {
  resetJustDodge();
  noteDashStarted();
  tryJustDodge();
  assert.equal(isJustDodgeCounterActive(), true);
  consumeJustDodgeCounter();
  assert.equal(isJustDodgeCounterActive(), false, 'spent on the counter hit');
});

test('reset clears the dash marker + counter window', () => {
  noteDashStarted();
  tryJustDodge();
  resetJustDodge();
  assert.equal(isJustDodgeCounterActive(), false);
  assert.equal(tryJustDodge(), false, 'no perfect dodge after reset');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
