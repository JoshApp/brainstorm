// The tap-resolution rules — the whole "attack vs interact vs nothing" ladder
// in one testable place. These lock the intent:
//   - a mob (tapped or in range) → attack; combat takes preference
//   - a deliberate tap on an interactable NEVER swings (the chest/pickup bug)
//   - an ambient tap reaches for the best in-range interactable, else swings
//   - the joystick half never acts ambiently
//
//   npm test

import assert from 'node:assert/strict';
import { resolveTap, type TapInputs } from '../src/controls/tap-resolve';
import type { Interactable } from '../src/interactables/types';
import type { TapTarget } from '../src/controls/tap-target';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const chest = { id: 'c', promptLabel: 'OPEN' } as unknown as Interactable;
const pickup = { id: 'p', promptLabel: 'TAKE' } as unknown as Interactable;
const enemyAim: TapTarget = { kind: 'enemy', enemy: {} as never };
const chestAim: TapTarget = { kind: 'interactable', interactable: chest };

function inputs(over: Partial<TapInputs>): TapInputs {
  return { aimed: null, aimedReachable: false, mobInRange: false, bestInRange: null, canAttack: true, ...over };
}

test('tapping a mob attacks', () => {
  assert.deepEqual(resolveTap(inputs({ aimed: enemyAim })), { kind: 'attack' });
});

test('a mob in range attacks — preference over a nearby interactable', () => {
  assert.deepEqual(resolveTap(inputs({ mobInRange: true, bestInRange: pickup })), { kind: 'attack' });
});

test('a deliberate tap on a reachable interactable interacts (no swing)', () => {
  assert.deepEqual(
    resolveTap(inputs({ aimed: chestAim, aimedReachable: true })),
    { kind: 'interact', interactable: chest },
  );
});

test('tapping an interactable you are too far from does NOTHING (never flails)', () => {
  assert.deepEqual(resolveTap(inputs({ aimed: chestAim, aimedReachable: false })), { kind: 'none' });
});

test('ambient tap reaches for the best in-range interactable when no mob', () => {
  assert.deepEqual(resolveTap(inputs({ bestInRange: pickup })), { kind: 'interact', interactable: pickup });
});

test('ambient tap with nothing around swings at the air', () => {
  assert.deepEqual(resolveTap(inputs({})), { kind: 'attack' });
});

test('the joystick half never acts on an ambient tap', () => {
  assert.deepEqual(resolveTap(inputs({ canAttack: false, mobInRange: true, bestInRange: pickup })), { kind: 'none' });
});

test('but a direct tap is honoured on the joystick half too', () => {
  assert.deepEqual(resolveTap(inputs({ canAttack: false, aimed: enemyAim })), { kind: 'attack' });
  assert.deepEqual(
    resolveTap(inputs({ canAttack: false, aimed: chestAim, aimedReachable: true })),
    { kind: 'interact', interactable: chest },
  );
});

// Desktop mouse: interactEligible=false → left-click is attack-only. The
// `E` key owns interaction, so a click never interacts; combat still wins.
test('desktop click on a reachable interactable swings (E owns interact)', () => {
  assert.deepEqual(
    resolveTap(inputs({ aimed: chestAim, aimedReachable: true, deliberate: false, interactEligible: false })),
    { kind: 'attack' },
  );
});

test('desktop click reaching an in-range interactable still swings, never interacts', () => {
  assert.deepEqual(
    resolveTap(inputs({ bestInRange: pickup, deliberate: false, interactEligible: false })),
    { kind: 'attack' },
  );
});

test('desktop click on a mob still attacks (combat unaffected by interactEligible)', () => {
  assert.deepEqual(
    resolveTap(inputs({ aimed: enemyAim, deliberate: false, interactEligible: false })),
    { kind: 'attack' },
  );
});

test('a tap is ALWAYS a swing — parry has its own button and never steals it', () => {
  // Parry used to pre-empt this whole ladder: while any enemy flashed a
  // deflectable strike, a combat-zone tap parried instead of swinging. Two
  // things were wrong with that. The player could never choose to TRADE — take
  // the hit and swing anyway, which is a legitimate read they had no input for.
  // And a LEAKED opportunity (a mob killed mid-flash left the count stuck true)
  // dead-routed every tap to a no-op parry while the player mashed a button
  // that no longer swung.
  //
  // Neither can recur: this function no longer knows what a deflect is. Locked
  // in here because the failure mode is silent — combat simply stops responding.
  assert.deepEqual(resolveTap(inputs({ aimed: enemyAim })), { kind: 'attack' });
  assert.deepEqual(resolveTap(inputs({ mobInRange: true })), { kind: 'attack' });
  assert.ok(!('deflectAvailable' in inputs({})), 'the deflect input is gone from the arbiter');
  // And no input combination can produce a deflect any more.
  for (const over of [
    { aimed: enemyAim }, { mobInRange: true }, { bestInRange: pickup },
    { aimed: chestAim, aimedReachable: true }, { canAttack: false },
  ]) {
    assert.notEqual(resolveTap(inputs(over)).kind, 'deflect');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
