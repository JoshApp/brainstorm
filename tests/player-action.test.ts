// Player-action FSM (src/combat/player-action.ts) — pins the state priority,
// the dt-ticked owned beats (dodge/parry), and the cancel table, so the
// authority's contract is locked.
//
// Parry is its own committed action. Its entry point (the tap) is SHARED with
// attack — main.ts only routes a tap to parry while a deflect opportunity is
// open, so outside the window a tap always swings (never locked out). But once
// a parry commits, it's a real beat the FSM owns and gates here.

import assert from 'node:assert/strict';
import {
  bindPlayerActionSources, getPlayerAction, canStartAction,
  enterDodge, enterParry, tickPlayerAction, resetPlayerAction,
  type PlayerActionSources,
} from '../src/combat/player-action';
import type { SwingPhase } from '../src/player/viewmodel';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

const s = { swinging: false, phase: 'idle' as SwingPhase };
const fake: PlayerActionSources = { isSwinging: () => s.swinging, swingPhase: () => s.phase };
bindPlayerActionSources(fake);
function reset() { s.swinging = false; s.phase = 'idle'; resetPlayerAction(); }

// ── Derived + owned state priority ───────────────────────────────────
test('idle when nothing active', () => { reset(); assert.equal(getPlayerAction(), 'idle'); });
test('attacking when the swing sim is swinging', () => {
  reset(); s.swinging = true; s.phase = 'strike';
  assert.equal(getPlayerAction(), 'attacking');
});
test('a committed dodge outranks an in-flight swing', () => {
  reset(); s.swinging = true; enterDodge(0.3);
  assert.equal(getPlayerAction(), 'dodging');
});
test('a committed parry outranks all', () => {
  reset(); s.swinging = true; enterDodge(0.3); enterParry(0.28);
  assert.equal(getPlayerAction(), 'parrying');
});

// ── dt-ticked expiry (NOT wall-clock) ────────────────────────────────
test('parry beat expires after its duration of dt', () => {
  reset(); enterParry(0.3);
  assert.equal(getPlayerAction(), 'parrying');
  tickPlayerAction(0.2); assert.equal(getPlayerAction(), 'parrying');   // still committed
  tickPlayerAction(0.2); assert.equal(getPlayerAction(), 'idle');       // 0.4 > 0.3 → done
});
test('dodge beat expires on the dt clock', () => {
  reset(); enterDodge(0.25);
  tickPlayerAction(0.1); assert.equal(getPlayerAction(), 'dodging');
  tickPlayerAction(0.2); assert.equal(getPlayerAction(), 'idle');
});

// ── Cancel table ─────────────────────────────────────────────────────
test('nothing starts during a committed parry', () => {
  reset(); enterParry(0.3);
  assert.equal(canStartAction('attack'), false);
  assert.equal(canStartAction('dodge'), false);
  assert.equal(canStartAction('parry'), false);
});
test('nothing starts during a committed dodge', () => {
  reset(); enterDodge(0.3);
  assert.equal(canStartAction('attack'), false);
  assert.equal(canStartAction('dodge'), false);
  assert.equal(canStartAction('parry'), false);
});
test('cannot dodge/parry mid-strike, but a new swing (combo) is allowed', () => {
  reset(); s.swinging = true; s.phase = 'strike';
  assert.equal(canStartAction('dodge'), false);
  assert.equal(canStartAction('parry'), false);
  assert.equal(canStartAction('attack'), true);
});
test('dodge cancels attack RECOVERY, but parry needs a FREE stance', () => {
  reset(); s.swinging = true; s.phase = 'recover';
  assert.equal(canStartAction('dodge'), true);    // the escape can cancel recovery
  assert.equal(canStartAction('parry'), false);   // no parrying out of your own swing
});
test('everything is free from idle', () => {
  reset();
  assert.equal(canStartAction('attack'), true);
  assert.equal(canStartAction('dodge'), true);
  assert.equal(canStartAction('parry'), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
