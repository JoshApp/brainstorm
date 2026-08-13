// THE LEAP — a dodge aimed at a living body goes OVER it.
//
// The move used to exist by accident, on the wrong input: the walk-vault asked
// the level "can I get over this", the level only knows about stone, so walking
// into an enemy stepped over it for free. That is closed (see vault-step.test).
// The move itself is good, so it moved to the dodge — which costs stamina,
// commits you, and pays i-frames.
//
// What's pinned here is the LIFECYCLE, because every failure mode of this
// feature is a state one: a leap that keeps enemy collision off after the roll
// ends is a player walking through mobs, and a landing that fires when it isn't
// needed is a correction that undoes a better outcome than the one we planned.
//
//   npm test -- body-leap

import assert from 'node:assert/strict';
import {
  noteBodyLeap, isLeapingOverBody, pendingLeapLanding, clearBodyLeap,
  tryDash, resetDashCooldown,
} from '../src/combat/dash';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  resetDashCooldown();   // also drops any armed leap — a fresh floor's state
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
  resetDashCooldown();
}

test('nothing is leaping until something arms one', () => {
  assert.equal(isLeapingOverBody(), false);
  assert.equal(pendingLeapLanding(), null);
});

test('an armed leap remembers where it comes down', () => {
  noteBodyLeap(3, -4);
  const land = pendingLeapLanding();
  assert.deepEqual(land, { x: 3, z: -4 });
});

test('resolving it drops the leap — collision goes back to normal', () => {
  noteBodyLeap(3, -4);
  clearBodyLeap();
  assert.equal(pendingLeapLanding(), null);
  assert.equal(isLeapingOverBody(), false);
});

test('a new floor forgets an armed leap', () => {
  noteBodyLeap(3, -4);
  resetDashCooldown();
  assert.equal(pendingLeapLanding(), null,
    'a leap survived a floor load — the landing would fire in a level that no longer exists');
});

// This one runs LAST: the dodge window is game-clock timed and a headless test
// never advances the clock, so once a roll starts it stays started.
test('MID-ROLL, THE LEAP OWNS COLLISION AND THE LANDING WAITS', () => {
  tryDash(0, 1);
  noteBodyLeap(0, 3);
  assert.equal(isLeapingOverBody(), true,
    'enemy collision is still on mid-leap — the roll stops dead in the body');
  assert.equal(pendingLeapLanding(), null,
    'the landing fired while still mid-air — that is a teleport, not a leap');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
