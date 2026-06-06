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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
