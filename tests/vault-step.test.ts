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

test('A REAL FRAME DELTA VAULTS — the bug that made this a no-op for its whole life', () => {
  // The caller passes THIS FRAME'S movement: speed × dt, about 0.056m at a walk.
  // Every test in this file used to hand it a unit vector, so a guard that
  // rejected anything under 0.35m looked correct here and rejected literally
  // every call in the game. The vault never fired once. Feed it what the game
  // feeds it.
  const STEP = 0.056;
  assert.equal(tryVaultStep(0, 0, 0, STEP, 0.3, CLEAR), true,
    'a per-frame walk delta was refused — the feature is a no-op again');
});

test('a diagonal frame delta vaults too', () => {
  // 0.04² + 0.04² ≈ 0.056 — the same walk, held at 45°.
  assert.equal(tryVaultStep(0, 0, 0.04, 0.04, 0.3, CLEAR), true);
});

test('a zero move never vaults', () => {
  assert.equal(tryVaultStep(0, 0, 0, 0, 0.3, CLEAR), false);
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

// ── NEVER OVER A LIVING BODY ─────────────────────────────────────────────
// The rule Josh reported twice before it was believed: "the walk vault never
// ceases to work and works on enemies". It did, and `isInCombat()` was never
// going to stop it — combat-state latches on a hit LANDING, so walking up to a
// mob that hasn't touched you yet isn't "in combat" by that definition, and
// walking into it blocks the step exactly like a fallen pillar. The gate has to
// be geometric, so these test geometry.

/** A mob two metres ahead, in a world where the floor is otherwise clear. */
const MOB = [{ x: 0, z: 2, radius: 0.5 }];

test('A WALK NEVER VAULTS AN ENEMY', () => {
  assert.equal(tryVaultStep(0, 0, 0, 0.056, 0.3, CLEAR, MOB), false,
    'the player strolled over a mob — free, at walking pace, with no cost');
  assert.equal(isVaulting(), false);
});

test('but a kerb-hop that stops SHORT of the mob is still a vault', () => {
  // The rule is "no carry that goes OVER a body", not "no vault while an enemy
  // exists". A mob at 8m must not veto stepping over the rubble at your feet.
  const FAR_MOB = [{ x: 0, z: 8, radius: 0.5 }];
  // Only the SHORT hop is offered floor, so the vault can't reach the mob.
  const SHORT = { canDashOver: (fx: number, fz: number, tx: number, tz: number) =>
    Math.hypot(tx - fx, tz - fz) < 1.6 };
  assert.equal(tryVaultStep(0, 0, 0, 0.056, 0.3, SHORT, FAR_MOB), true,
    'a distant mob vetoed a step it is nowhere near');
});

test('a mob off to the SIDE does not block the line you are walking', () => {
  const BESIDE = [{ x: 2.5, z: 0, radius: 0.5 }];
  assert.equal(tryVaultStep(0, 0, 0, 0.056, 0.3, CLEAR, BESIDE), true);
});

test('a body you are ALREADY touching refuses the step', () => {
  // Pressed against a mob is the exact moment the old vault was most eager to
  // fire — the walk is fully blocked, so the trigger is loudest.
  assert.equal(tryVaultStep(0, 1.6, 0, 0.056, 0.3, CLEAR, MOB), false);
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
