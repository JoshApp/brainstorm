// Player attack commitment — the pure agency curve (move/turn loss + dash lock
// per swing phase, scaled by weapon weight). Pure function, no camera needed.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import { swingAgency } from '../src/combat/swing-agency';

const K = CONFIG.COMMITMENT;
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('idle = full freedom regardless of weight', () => {
  for (const c of [0, 0.5, 1]) {
    const a = swingAgency('idle', c);
    assert.equal(a.moveMul, 1);
    assert.equal(a.turnMul, 1);
    assert.equal(a.dashLocked, false);
  }
});

test('a weightless weapon (commitment 0) never loses agency', () => {
  for (const p of ['windup', 'strike', 'recover'] as const) {
    const a = swingAgency(p, 0);
    assert.equal(a.moveMul, 1, `${p} move`);
    assert.equal(a.turnMul, 1, `${p} turn`);
  }
});

test('a fully committed weapon (1) reaches the configured per-phase floors', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(swingAgency('windup', 1).moveMul, K.WINDUP_MOVE);
  near(swingAgency('windup', 1).turnMul, K.WINDUP_TURN);
  near(swingAgency('strike', 1).moveMul, K.STRIKE_MOVE);
  near(swingAgency('strike', 1).turnMul, K.STRIKE_TURN);
  near(swingAgency('recover', 1).moveMul, K.RECOVER_MOVE);
  near(swingAgency('recover', 1).turnMul, K.RECOVER_TURN);
});

test('dash is locked ONLY during the strike', () => {
  assert.equal(swingAgency('windup', 1).dashLocked, false);
  assert.equal(swingAgency('strike', 1).dashLocked, true);
  assert.equal(swingAgency('strike', 0.01).dashLocked, true, 'lock is independent of weight');
  assert.equal(swingAgency('recover', 1).dashLocked, false);
  assert.equal(swingAgency('idle', 1).dashLocked, false);
});

test('agency scales monotonically with weight (heavier = less)', () => {
  const light = swingAgency('strike', 0.3);
  const heavy = swingAgency('strike', 0.9);
  assert.ok(heavy.moveMul < light.moveMul, 'heavier moves less');
  assert.ok(heavy.turnMul < light.turnMul, 'heavier turns less');
  assert.ok(light.moveMul < 1, 'even a light weapon commits somewhat during strike');
});

test('the strike commits harder than windup or recovery', () => {
  const c = 1;
  assert.ok(swingAgency('strike', c).moveMul <= swingAgency('windup', c).moveMul);
  assert.ok(swingAgency('strike', c).moveMul <= swingAgency('recover', c).moveMul);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
