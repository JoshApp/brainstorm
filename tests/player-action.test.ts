// Player-action FSM (src/combat/player-action.ts) — pins the derived-state
// priority and the lockout policy so the Phase-2 migration (making this the
// authority) has a fixed contract to preserve.

import assert from 'node:assert/strict';
import {
  bindPlayerActionSources, getPlayerAction, canStartAction,
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

// Mutable fake sources so each test poses a state.
const s = { swinging: false, phase: 'idle' as SwingPhase, dodging: false, parry: false, dashLocked: false };
const fake: PlayerActionSources = {
  isSwinging: () => s.swinging,
  swingPhase: () => s.phase,
  isDodging: () => s.dodging,
  parryActive: () => s.parry,
  dashLocked: () => s.dashLocked,
};
bindPlayerActionSources(fake);
function reset() { s.swinging = false; s.phase = 'idle'; s.dodging = false; s.parry = false; s.dashLocked = false; }

// ── Derived-state priority ───────────────────────────────────────────
test('idle when nothing active', () => { reset(); assert.equal(getPlayerAction(), 'idle'); });
test('attacking when swinging', () => { reset(); s.swinging = true; s.phase = 'strike'; assert.equal(getPlayerAction(), 'attacking'); });
test('dodging outranks attacking', () => {
  reset(); s.swinging = true; s.dodging = true;
  assert.equal(getPlayerAction(), 'dodging');
});
test('parrying outranks all', () => {
  reset(); s.swinging = true; s.dodging = true; s.parry = true;
  assert.equal(getPlayerAction(), 'parrying');
});

// ── Lockout policy ───────────────────────────────────────────────────
test('cannot attack mid-roll', () => { reset(); s.dodging = true; assert.equal(canStartAction('attack'), false); });
test('can attack when idle', () => { reset(); assert.equal(canStartAction('attack'), true); });
test('cannot dodge while strike-locked', () => { reset(); s.dashLocked = true; assert.equal(canStartAction('dodge'), false); });
test('can dodge mid-recover (not strike-locked)', () => {
  reset(); s.swinging = true; s.phase = 'recover'; s.dashLocked = false;
  assert.equal(canStartAction('dodge'), true);
});
test('cannot parry mid-strike', () => {
  reset(); s.swinging = true; s.phase = 'strike';
  assert.equal(canStartAction('parry'), false);
});
test('cannot parry mid-roll', () => { reset(); s.dodging = true; assert.equal(canStartAction('parry'), false); });
test('can parry from idle', () => { reset(); assert.equal(canStartAction('parry'), true); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
