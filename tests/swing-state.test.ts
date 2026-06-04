// Swing/combo state machine — the feel-critical attack timing that used to be
// tangled inside the THREE.js viewmodel and therefore untestable. Now a pure
// module, so these assert the rules directly: phase progression, the single
// per-swing lifecycle event, input buffering, the finisher's no-buffer rule,
// and the combo window.
//
//   npm test

import assert from 'node:assert/strict';
import { setCurrentWeapon, getCurrentWeapon } from '../src/player/current-weapon';
import { createSwingState } from '../src/combat/swing-state';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  // Every test runs against a known weapon (sword) so combo length + timings
  // are stable; we still READ them at runtime rather than hard-coding, so
  // content re-tuning can't break the tests.
  setCurrentWeapon({ reach: 2.1, coneHalfAngle: 0.8, damage: 1, critChance: 0.05, critMultiplier: 2.0, class: 'sword' });
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const W = () => getCurrentWeapon();
// A dt big enough to cross any single phase in one advance() (phase durations
// are fractions of a second). advance() applies at most one transition per
// call, so three of these walk windup→strike→recover→(idle|chain).
const BIG = 1.0;
function walkToIdleOrChain(s: ReturnType<typeof createSwingState>) {
  s.advance(BIG); // windup→strike  (or strike→recover if charged)
  s.advance(BIG); // strike→recover (or recover→end if charged)
  s.advance(BIG); // recover→idle / chain
}

test('idle → press starts a windup swing', () => {
  const s = createSwingState();
  assert.equal(s.isSwinging(), false);
  assert.equal(s.requestSwing(), true);
  assert.equal(s.getPhase(), 'windup');
  assert.equal(s.isSwinging(), true);
  assert.equal(s.isStriking(), false);
});

test('phase progression windup→strike→recover→idle', () => {
  const s = createSwingState();
  s.requestSwing();
  assert.equal(s.getPhase(), 'windup');
  s.advance(BIG); assert.equal(s.getPhase(), 'strike');
  assert.equal(s.isStriking(), true);
  s.advance(BIG); assert.equal(s.getPhase(), 'recover');
  assert.equal(s.isStriking(), false);
  s.advance(BIG); assert.equal(s.getPhase(), 'idle');
  assert.equal(s.isSwinging(), false);
});

test('charged release skips windup and flags charged:true once', () => {
  const events: boolean[] = [];
  const s = createSwingState({ onSwingStart: (i) => events.push(i.charged) });
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.equal(s.getPhase(), 'strike');         // no windup
  assert.deepEqual(events, [true]);
});

test('onSwingStart fires once per swing, not per press', () => {
  let count = 0;
  const s = createSwingState({ onSwingStart: () => count++ });
  s.requestSwing();            // 1 real swing
  s.requestSwing();            // mid-swing press → buffers, NOT a new event
  s.requestSwing();
  assert.equal(count, 1, 'one event despite three presses in one swing');
});

test('mid-swing press buffers and chains the next combo step', () => {
  let count = 0;
  const s = createSwingState({ onSwingStart: () => count++ });
  const len = W().combo.length;
  assert.ok(len >= 2, 'sword should have a multi-step combo');
  s.requestSwing();                       // fires step 0, count=1
  assert.equal(s.getComboStep(), 0);
  for (let i = 1; i < len; i++) {
    s.requestSwing();                     // buffer next step (mid-swing)
    walkToIdleOrChain(s);                 // recover-end chains straight into it
    assert.equal(s.getComboStep(), i, `chained to combo step ${i}`);
    assert.equal(s.getPhase(), 'windup', 'chain re-enters windup, not idle');
    assert.equal(count, i + 1, 'each chained step is its own swing event');
  }
});

test('the finisher does NOT accept a buffered press', () => {
  let count = 0;
  const s = createSwingState({ onSwingStart: () => count++ });
  const len = W().combo.length;
  s.requestSwing();                       // step 0
  for (let i = 1; i < len; i++) { s.requestSwing(); walkToIdleOrChain(s); }
  // Now firing the finisher (last index).
  assert.equal(s.getComboStep(), len - 1);
  const eventsBefore = count;
  s.advance(BIG);                         // → strike
  assert.equal(s.isFinisherStrike(), true);
  assert.equal(s.requestSwing(), false, 'press during finisher returns false');
  s.advance(BIG);                         // → recover
  s.advance(BIG);                         // → idle (NOT a chain)
  assert.equal(s.isSwinging(), false, 'finisher does not auto-chain');
  assert.equal(count, eventsBefore, 'no extra swing event from the finisher press');
  assert.equal(s.getComboStep(), 0, 'combo wrapped back to 0');
});

test('combo window: a press after it lapses restarts at step 0', () => {
  const s = createSwingState();
  s.requestSwing();
  walkToIdleOrChain(s);                    // back to idle, comboStep pre-advanced to 1
  assert.equal(s.getComboStep(), 1, 'combo pre-advances at recover-end');
  // Let the window lapse (advance past comboWindowMs), then the next press
  // resets the chain.
  s.advance(W().comboWindowMs / 1000 + 0.5);
  assert.equal(s.getComboStep(), 0, 'idle past the window drops back to step 0');
  s.requestSwing();
  assert.equal(s.getComboStep(), 0);
});

test('combo window: a press inside it continues the chain', () => {
  const s = createSwingState();
  s.requestSwing();
  walkToIdleOrChain(s);                    // idle, comboStep=1, window just opened
  assert.equal(s.getComboStep(), 1);
  // No further advance → still inside the window → next press fires step 1.
  assert.equal(s.requestSwing(), true);
  assert.equal(s.getComboStep(), 1, 'chain continued, not reset');
});

test('canSwing gate blocks starting a swing on empty', () => {
  let allowed = false;
  const s = createSwingState({ canSwing: () => allowed });
  assert.equal(s.requestSwing(), false, 'refused while gassed');
  assert.equal(s.isSwinging(), false);
  allowed = true;
  assert.equal(s.requestSwing(), true, 'allowed once stamina returns');
});

test('a buffered combo will not chain into an empty bar', () => {
  let allowed = true;
  let count = 0;
  const s = createSwingState({ canSwing: () => allowed, onSwingStart: () => count++ });
  s.requestSwing();              // step 0 (count=1)
  s.requestSwing();              // buffer the next step
  allowed = false;              // ...but we run dry before recover ends
  walkToIdleOrChain(s);
  assert.equal(s.isSwinging(), false, 'gassed → chain dropped, back to idle');
  assert.equal(count, 1, 'no extra swing billed when the chain is gated');
});

test('reset() wipes in-flight swing state (weapon swap)', () => {
  const s = createSwingState();
  s.requestSwing();
  s.advance(BIG);                          // mid-swing (strike)
  s.reset();
  assert.equal(s.isSwinging(), false);
  assert.equal(s.getComboStep(), 0);
  assert.equal(s.getActiveStep(), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
