// The vault step — walking over knee-high obstacles.
//
// Only one rule here really matters and it's the reason the feature is safe to
// have at all: THE DODGE ALWAYS WINS. A panic-dodge toward a low wall must never
// be served a traversal move instead of its i-frames. These pin that, plus the
// geometry contract (a walk-vault can never clear something a dodge couldn't).
//
//   npm test

import assert from 'node:assert/strict';
import { tryVaultStep, isVaulting, vaultPosition, vaultHeightOffset, cancelVaultStep } from '../src/player/vault-step';
import { tryDash } from '../src/combat/dash';
import { emit } from '../src/broadcast/event-bus';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  cancelVaultStep();
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
  cancelVaultStep();
}

/** combat-state derives "am I fighting" from the event bus, so entering combat
 *  in a test means doing the thing that actually causes it. */
function enterCombat() {
  emit({ type: 'player:damaged', amount: 1 } as never);
}

/** A world where everything in the way is vaultable. */
const CLEAR = { canDashOver: () => true };
/** A world where nothing is — a real wall. */
const WALL = { canDashOver: () => false };

test('walking into something vaultable starts a step', () => {
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, CLEAR), true);
  assert.equal(isVaulting(), true);
});

test('a real wall is still a wall', () => {
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, WALL), false);
  assert.equal(isVaulting(), false);
});

test('brushing an obstacle sideways does not vault', () => {
  // The player has to be genuinely pushing INTO it, not grazing past.
  assert.equal(tryVaultStep(0, 0, 0.05, 0.05, 0.3, CLEAR), false);
});

test('a vault in flight does not restart itself', () => {
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, CLEAR), true);
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, CLEAR), false);
});

test('the step is long enough to CLEAR a fallen pillar', () => {
  // The bug that made the whole feature a no-op: a fallen pillar segment is a
  // circle of r=0.45 and the player is r=0.3, so a blocked walk starts 0.75m
  // from its centre and must travel 1.5m to land clear. A world that only
  // accepts landings past 1.5m must still produce a vault.
  const FAR = { canDashOver: (fx: number, fz: number, tx: number, tz: number) =>
    Math.hypot(tx - fx, tz - fz) >= 1.5 };
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, FAR), true,
    'the step is too short to clear the obstacle it exists for');
  const p = vaultPosition()!;
  assert.ok(Math.hypot(p.x, p.z) <= 2.4, 'the step overshot into a leap');
});

test('a world that clears nothing at any distance refuses', () => {
  let asked = 0;
  const NEVER = { canDashOver: () => { asked++; return false; } };
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, NEVER), false);
  assert.ok(asked > 1, 'only one distance was probed — the step is back to guessing');
});

test('the step carries forward, and only forward', () => {
  tryVaultStep(10, 20, 0, 1, 0.3, CLEAR);
  const p = vaultPosition();
  assert.ok(p, 'no position mid-vault');
  assert.ok(p!.z >= 20, 'the step went backwards');
  assert.ok(Math.abs(p!.x - 10) < 1e-6, 'the step drifted sideways');
  assert.ok(p!.z - 20 <= 1.2, 'the step covered more ground than a stride');
});

test('the eye arcs up and comes back down', () => {
  assert.equal(vaultHeightOffset(), 0, 'lifted while not vaulting');
  tryVaultStep(0, 0, 0, 1, 0.3, CLEAR);
  assert.ok(vaultHeightOffset() >= 0, 'the arc went below the floor');
});

test('cancelling drops it cleanly', () => {
  tryVaultStep(0, 0, 0, 1, 0.3, CLEAR);
  cancelVaultStep();
  assert.equal(isVaulting(), false);
  assert.equal(vaultPosition(), null);
  assert.equal(vaultHeightOffset(), 0);
});

// ── THE GATES ────────────────────────────────────────────────────────────
// These two run LAST on purpose: both latch for a few seconds of GAME time and
// a headless test never advances the clock, so once either is on it stays on.

test('IN COMBAT IT DOES NOT EXIST', () => {
  enterCombat();
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, CLEAR), false,
    'a vault fired during a fight — the dodge no longer owns traversal');
});

test('THE DODGE ALWAYS WINS — no vault mid-roll', () => {
  tryDash(0, 1);
  assert.equal(tryVaultStep(0, 0, 0, 1, 0.3, CLEAR), false,
    'a vault fired during a dodge — this is the failure the whole gate exists for');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
