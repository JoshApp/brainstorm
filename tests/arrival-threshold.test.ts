// WHEN IS THE DUNGEON ALLOWED TO NOTICE YOU?
//
// Arriving on a floor buys a grace: nothing sees you and nothing can hurt you
// until you DO something. Not on a clock — someone getting their bearings on a
// bus gets as long as they need. It ends when they move, look, swing or use.
//
// The rule had a hole, and the hole reads as "enemies ignore me". The player can
// act DURING the wake ceremony — movement is held but the stick is readable, and
// the input system ends the threshold the moment it sees one. That end landed on
// a threshold that had not been armed yet, so it did nothing; then the ceremony
// finished and armed it anyway. The action was discarded, and the player got the
// full grace AFTER they had already started playing.
//
// In play: walk in, stop to look at the room, and nothing in it reacts to you —
// for up to 45 seconds, until you happen to move again. That is the shape of the
// #173 report: the first room you stop in ignores you, the rest of the floor is
// fine, because moving on clears it.
//
//   npm test -- arrival-threshold

import assert from 'node:assert/strict';
import {
  resetThreshold, armThreshold, endThreshold, tickThreshold, inThreshold,
} from '../src/player/arrival-threshold';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Arrive on a fresh floor and let the wake ceremony finish, untouched. */
function arriveAndWake(): void {
  resetThreshold();
  armThreshold();
}

test('a player who just arrived is not noticed', () => {
  arriveAndWake();
  assert.equal(inThreshold(), true);
});

test('acting ends it', () => {
  arriveAndWake();
  endThreshold();
  assert.equal(inThreshold(), false);
});

test('ACTING DURING THE WAKE IS NOT DISCARDED', () => {
  // THE BUG. The stick is readable while the eyelids are still parting, so the
  // input system calls end() before the ceremony hands over. Arming afterwards
  // must respect that, or the player is invisible to the dungeon for the next
  // 45 seconds having already started playing.
  resetThreshold();
  endThreshold();     // pushed the stick mid-blink
  armThreshold();     // ceremony finishes and hands over
  assert.equal(inThreshold(), false,
    'the ceremony re-armed a threshold the player had already ended');
});

test('it stays ended — one action is enough for the whole floor', () => {
  // Otherwise a player who moves, stops, and looks around gets the grace back
  // the moment anything re-arms, which is the same bug wearing a different hat.
  arriveAndWake();
  endThreshold();
  armThreshold();
  assert.equal(inThreshold(), false);
});

test('a NEW floor gets its own grace', () => {
  // The memory is per-arrival. Acting on depth 3 must not make depth 4 hostile
  // the instant you land.
  arriveAndWake();
  endThreshold();
  resetThreshold();
  armThreshold();
  assert.equal(inThreshold(), true);
});

test('the backstop releases a threshold nothing ended', () => {
  // If an end-call ever goes missing we would rather the player be mortal than
  // immortal for a whole floor.
  arriveAndWake();
  tickThreshold(44);
  assert.equal(inThreshold(), true, 'must not expire during honest orientation');
  tickThreshold(2);
  assert.equal(inThreshold(), false, 'the 45s backstop must fire');
});

test('the backstop clock does not run once the player has acted', () => {
  arriveAndWake();
  endThreshold();
  tickThreshold(100);
  assert.equal(inThreshold(), false);
});

test('ending twice is harmless', () => {
  // Input handlers call it unconditionally, every frame they see a stick.
  arriveAndWake();
  endThreshold();
  endThreshold();
  assert.equal(inThreshold(), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
