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
    for (const t of [0, 0.5, 1]) {
      const a = swingAgency(p, 0, t);
      assert.equal(a.moveMul, 1, `${p}@${t} move`);
      assert.equal(a.turnMul, 1, `${p}@${t} turn`);
    }
  }
});

test('a fully committed weapon (1) reaches the configured floors at the phase DEEPEST point', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  // windup eases IN — deepest at the END (progress 1).
  near(swingAgency('windup', 1, 1).moveMul, K.WINDUP_MOVE);
  near(swingAgency('windup', 1, 1).turnMul, K.WINDUP_TURN);
  // strike holds full commitment throughout.
  near(swingAgency('strike', 1).moveMul, K.STRIKE_MOVE);
  near(swingAgency('strike', 1).turnMul, K.STRIKE_TURN);
  // recover eases OUT — deepest at the START (progress 0).
  near(swingAgency('recover', 1, 0).moveMul, K.RECOVER_MOVE);
  near(swingAgency('recover', 1, 0).turnMul, K.RECOVER_TURN);
});

test('the swing arc eases commitment IN on windup and OUT on recover', () => {
  // windup: free at the start, committed by the end.
  assert.equal(swingAgency('windup', 1, 0).moveMul, 1, 'windup starts free');
  assert.ok(swingAgency('windup', 1, 1).moveMul < swingAgency('windup', 1, 0.5).moveMul,
    'windup commits deeper as it progresses');
  // recover: committed at the start, free by the end.
  assert.equal(swingAgency('recover', 1, 1).moveMul, 1, 'recover ends free');
  assert.ok(swingAgency('recover', 1, 0).moveMul < swingAgency('recover', 1, 0.5).moveMul,
    'recover releases as it progresses');
});

test('the recover DECAYS — you get your footing back well ahead of linear', () => {
  // Josh, 2026-08-12: the hammer's post-swing slow "feels too punishing". The
  // cause was a LINEAR release across a recover that is ~2x a sword's, so the
  // whole tail sat slowed. The bite at the strike's end is the part that sells
  // weight; the tail was just tax. Lock the decay in so it can't drift back.
  const c = 1;
  const linearAt = (t: number) => 1 + (K.RECOVER_MOVE - 1) * (c * (1 - t));

  assert.ok(K.RECOVER_FALLOFF > 1, 'falloff must be front-loaded, not linear');
  for (const t of [0.25, 0.5, 0.75]) {
    assert.ok(swingAgency('recover', c, t).moveMul > linearAt(t),
      `recover@${t} must be freer than the old linear ramp`);
  }
  // Most of the footing is back by the halfway point...
  assert.ok(swingAgency('recover', c, 0.5).moveMul > 0.9, 'half-way through recover is nearly free');
  // ...but the BITE as the strike ends is deliberately untouched.
  assert.equal(swingAgency('recover', c, 0).moveMul, K.RECOVER_MOVE, 'the bite is preserved');
});

test('TURN is throttled more gently than MOVE (mobile aim is the lifeline)', () => {
  // At every committed instant, you keep more of your aim than your footing.
  assert.ok(swingAgency('strike', 1).turnMul > swingAgency('strike', 1).moveMul, 'strike');
  assert.ok(swingAgency('windup', 1, 1).turnMul > swingAgency('windup', 1, 1).moveMul, 'windup');
  assert.ok(swingAgency('recover', 1, 0).turnMul > swingAgency('recover', 1, 0).moveMul, 'recover');
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

test('the strike commits harder than windup or recovery (compared at full depth)', () => {
  const c = 1;
  // windup deepest at progress 1, recover deepest at progress 0 — compare like
  // for like, against the strike's flat full commitment.
  assert.ok(swingAgency('strike', c).moveMul <= swingAgency('windup', c, 1).moveMul);
  assert.ok(swingAgency('strike', c).moveMul <= swingAgency('recover', c, 0).moveMul);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
