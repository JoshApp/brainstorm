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
  // Every test runs against a known weapon (spear — a still-legacy class; sword migrated to the move-timeline) so combo length + timings
  // are stable; we still READ them at runtime rather than hard-coding, so
  // content re-tuning can't break the tests.
  setCurrentWeapon({ reach: 2.1, coneHalfAngle: 0.8, damage: 1, critChance: 0.05, critMultiplier: 2.0, class: 'spear' });
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
    s.advance(BIG);                       // windup→strike
    s.advance(BIG);                       // strike→recover (buffer window open)
    s.requestSwing();                     // buffer next step (in recover)
    s.advance(BIG);                       // recover-end chains straight into it
    assert.equal(s.getComboStep(), i, `chained to combo step ${i}`);
    assert.equal(s.getPhase(), 'windup', 'chain re-enters windup, not idle');
    assert.equal(count, i + 1, 'each chained step is its own swing event');
  }
});

test('an early press during windup does NOT buffer (no double-swing)', () => {
  let count = 0;
  const s = createSwingState({ onSwingStart: () => count++ });
  s.requestSwing();                       // step 0 → windup, count=1
  assert.equal(s.getPhase(), 'windup');
  s.requestSwing();                       // EARLY double-tap during windup → dropped
  walkToIdleOrChain(s);                   // no buffer → falls to idle, not a chain
  assert.equal(s.getPhase(), 'idle', 'a windup press must not bank a chain');
  assert.equal(count, 1, 'the early double-tap did not produce a second swing');
});

test('the finisher does NOT accept a buffered press', () => {
  let count = 0;
  const s = createSwingState({ onSwingStart: () => count++ });
  const len = W().combo.length;
  s.requestSwing();                       // step 0
  for (let i = 1; i < len; i++) { s.advance(BIG); s.advance(BIG); s.requestSwing(); s.advance(BIG); }
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

test('breakCombo: drops a banked chain back to the opener (menu/chest resume)', () => {
  const s = createSwingState();
  s.requestSwing();
  walkToIdleOrChain(s);                    // idle, comboStep=1, window open
  assert.equal(s.getComboStep(), 1);
  // A menu/chest paused the world: the sim clock froze, so the window never
  // lapsed. breakCombo() stands in for "combat flow broke" → fresh opener.
  s.breakCombo();
  assert.equal(s.getComboStep(), 0, 'banked chain reset to the opener');
  assert.equal(s.requestSwing(), true);
  assert.equal(s.getComboStep(), 0, 'next press is a clean step-0 swing');
});

test('breakCombo: no-op mid-swing (never yanks the active step)', () => {
  const s = createSwingState();
  s.requestSwing();
  walkToIdleOrChain(s);                    // idle, comboStep=1, window open
  s.requestSwing();                        // start the step-1 swing
  assert.equal(s.getComboStep(), 1);
  s.breakCombo();                          // mid-swing → ignored
  assert.equal(s.getComboStep(), 1, 'an in-flight swing is left alone');
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
  s.advance(BIG);                // windup→strike
  s.advance(BIG);                // strike→recover (buffer window open)
  s.requestSwing();              // buffer the next step (in recover)
  allowed = false;              // ...but we run dry before recover ends
  s.advance(BIG);                // recover-end → chain gated by the empty bar
  assert.equal(s.isSwinging(), false, 'gassed → chain dropped, back to idle');
  assert.equal(count, 1, 'no extra swing billed when the chain is gated');
});

// ── Directional input flavors only the combo OPENER ──────────────

test('directional input flavors the OPENER but the chain stays fixed + advances', () => {
  // (spear is set by the harness — a legacy class with directional moves)
  const s = createSwingState();
  const w = W();
  assert.ok(w.directionalMoves?.strafeLeft, 'spear has a strafe-left directional move');
  // Opener with a held direction → the directional variant (not the combo step 0).
  s.requestSwing({ direction: 'strafe-left' });
  assert.deepEqual(s.getActiveStep(), w.directionalMoves!.strafeLeft, 'opener uses the directional variant');
  walkToIdleOrChain(s);                    // light swing → idle, combo advanced to 1
  assert.equal(s.getComboStep(), 1, 'the chain still advances (moving never breaks it)');
  // Mid-chain press WITH a direction → ignored; the fixed combo step 1 plays.
  s.requestSwing({ direction: 'strafe-left' });
  assert.deepEqual(s.getActiveStep(), W().combo[1], 'step 1 is the fixed combo — direction ignored past the opener');
});

test('a centered opener (no direction) plays the normal combo step 0', () => {
  const s = createSwingState();
  s.requestSwing();   // no direction
  assert.deepEqual(s.getActiveStep(), W().combo[0], 'centered → the normal opener');
});

// ── Heavy combo chain + light→heavy ender (the hammer) ───────────
const LEGACY_HEAVY = { reach: 2.4, coneHalfAngle: 0.9, damage: 2, critChance: 0.05, critMultiplier: 2.0, class: 'spear' as const };  // a still-legacy class (heavyCombo+ender); hammer migrated to the timeline
// A CHARGED swing skips windup (strike→recover→idle), so it reaches idle in TWO
// advances — a third would lapse the combo window. Stops at idle, window open.
function walkChargedToIdle(s: ReturnType<typeof createSwingState>) {
  s.advance(BIG); // strike→recover
  s.advance(BIG); // recover→idle (pre-advance, window opens)
}

test('heavy chain: charged releases walk the escalating heavy combo', () => {
  setCurrentWeapon(LEGACY_HEAVY);
  const s = createSwingState();
  const heavy = W().heavyCombo!;
  assert.ok(heavy && heavy.length >= 3, 'hammer has a heavy 1-2-3');
  // H1 — a charged release starts the heavy track at step 0.
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.equal(s.getPhase(), 'strike', 'charged skips windup');
  assert.deepEqual(s.getActiveStep(), heavy[0], 'H1 is heavy step 0');
  walkChargedToIdle(s);
  assert.equal(s.getComboStep(), 1, 'heavy chain pre-advances to H2');
  // H2 — another charged release inside the window continues the heavy chain.
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.deepEqual(s.getActiveStep(), heavy[1], 'H2 is heavy step 1');
  walkChargedToIdle(s);
  assert.equal(s.getComboStep(), 2);
  // H3 — the finisher.
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.deepEqual(s.getActiveStep(), heavy[2], 'H3 is heavy step 2');
  assert.equal(s.isFinisherStrike(), true, 'H3 is the heavy finisher');
});

test('ender: a charged release at the end of a LIGHT chain fires the ender', () => {
  setCurrentWeapon(LEGACY_HEAVY);
  const s = createSwingState();
  s.requestSwing();              // light tap — step 0
  walkToIdleOrChain(s);          // light swing: idle, comboStep pre-advanced to 1, window open
  assert.equal(s.getComboStep(), 1);
  // Charged release while mid-light-chain → the ENDER, not a fresh heavy.
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.deepEqual(s.getActiveStep(), W().ender, 'cashed the light chain into the ender');
  assert.equal(s.isFinisherStrike(), true, 'the ender is a finisher');
  walkChargedToIdle(s);
  assert.equal(s.getComboStep(), 0, 'ender ends the chain → back to light step 0');
});

test('a cold charged release (no light chain) starts the heavy chain, not the ender', () => {
  setCurrentWeapon(LEGACY_HEAVY);
  const s = createSwingState();
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.deepEqual(s.getActiveStep(), W().heavyCombo![0], 'fresh charge = H1, not the ender');
});

// RETIRED (docs/MOVE-TIMELINE.md): this covered the LEGACY charged/heavy chain
// with directional flavoring — a feature only the SWORD class defined
// (heavyCombo + chargedMoves.back "ward"), and the sword has now migrated to the
// move-timeline. No remaining legacy class defines chargedMoves, so there's
// nothing legacy left to exercise it. Charged/heavy is a pending timeline
// migration (a `charged` MoveStep variant, like the directional set); this test
// returns, retargeted at the move runtime, when that lands.

test('heavy chain survives the inter-heavy charge time', () => {
  // A back-to-back heavy needs the player to HOLD to charge again (~570ms).
  // The cadence-set comboWindowMs alone (~520ms hammer) would lapse during
  // that hold, snapping the chain back to step 0. Window must extend with a
  // charge-time grace so chaining heavies actually works.
  setCurrentWeapon(LEGACY_HEAVY);
  const s = createSwingState();
  const heavy = W().heavyCombo!;
  // H1
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  walkChargedToIdle(s);
  assert.equal(s.getComboStep(), 1, 'pre-advanced to H2');
  // Sim a full-charge hold — longer than comboWindowMs alone.
  s.advance(0.60);
  assert.equal(s.getComboStep(), 1, 'window still open through the charge');
  // H2 fires inside the extended window → continues the heavy chain.
  assert.equal(s.requestSwing({ skipWindup: true }), true);
  assert.deepEqual(s.getActiveStep(), heavy[1], 'H2 chains after the charge wait');
});

test('heavy chain resets to the light track after the combo window lapses', () => {
  setCurrentWeapon(LEGACY_HEAVY);
  const s = createSwingState();
  s.requestSwing({ skipWindup: true });   // H1
  walkChargedToIdle(s);                    // idle, heavy comboStep 1, window open
  assert.equal(s.getComboStep(), 1);
  // Heavy windows are extended by a charge-time grace (~570ms) on top of
  // comboWindowMs; bump the lapse by more than that so the test really clears
  // the extended window.
  s.advance(W().comboWindowMs / 1000 + 1.5);
  assert.equal(s.getComboStep(), 0, 'lapse resets to a fresh step 0');
  s.requestSwing({ skipWindup: true });   // a fresh charge starts heavy at 0
  assert.deepEqual(s.getActiveStep(), W().heavyCombo![0]);
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
