// Enemy action-layer authority (src/mobs/enemy-action.ts) — pins the owned
// interrupt beats (stagger + parry flinch-lock), their dt-ticked expiry, and
// the cancel table, so the mob mirror of the player FSM has a locked contract.

import assert from 'node:assert/strict';
import { createEnemyAction } from '../src/mobs/enemy-action';
import { CONFIG } from '../src/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

// ── Fresh state ──────────────────────────────────────────────────────
test('a fresh mob can act and can be staggered', () => {
  const a = createEnemyAction();
  assert.equal(a.canAct(), true);
  assert.equal(a.canBeStaggered(), true);
  assert.equal(a.isStaggered(), false);
  assert.equal(a.isFlinchLocked(), false);
});

// ── Stagger beat ─────────────────────────────────────────────────────
test('a stagger blocks acting and re-staggering', () => {
  const a = createEnemyAction();
  a.enterStagger(1.0);
  assert.equal(a.isStaggered(), true);
  assert.equal(a.canAct(), false);         // reeling — can't start an ability
  assert.equal(a.canBeStaggered(), false); // re-stagger is a no-op while reeling
});
test('stagger elapsed counts up from 0 against STAGGER_DURATION', () => {
  const a = createEnemyAction();
  a.enterStagger(CONFIG.POISE.STAGGER_DURATION);
  assert.equal(a.staggerElapsed(), 0);
  a.tick(0.5);
  assert.ok(Math.abs(a.staggerElapsed() - 0.5) < 1e-9);
});
test('stagger expires on the dt clock, then acting resumes', () => {
  const a = createEnemyAction();
  a.enterStagger(0.6);
  a.tick(0.4); assert.equal(a.isStaggered(), true);
  a.tick(0.4); assert.equal(a.isStaggered(), false);  // 0.8 > 0.6 → done
  assert.equal(a.canAct(), true);
  assert.equal(a.staggerElapsed(), 0);   // 0 once recovered
});

// ── Flinch-lock beat (the parry) ─────────────────────────────────────
test('a parry flinch-lock blocks acting but still allows staggering', () => {
  const a = createEnemyAction();
  a.enterFlinchLock(CONFIG.DEFLECT.FLINCH_LOCK_S);
  assert.equal(a.isFlinchLocked(), true);
  assert.equal(a.canAct(), false);          // can't start a new attack
  assert.equal(a.canBeStaggered(), true);   // a follow-up heavy can still break it
});
test('flinch-lock expires on the dt clock', () => {
  const a = createEnemyAction();
  a.enterFlinchLock(0.45);
  a.tick(0.2); assert.equal(a.canAct(), false);
  a.tick(0.3); assert.equal(a.canAct(), true);   // 0.5 > 0.45 → freed
});

// ── Stagger outranks flinch-lock for "canAct"; reset clears all ──────
test('reset clears every beat', () => {
  const a = createEnemyAction();
  a.enterStagger(2); a.enterFlinchLock(2);
  a.reset();
  assert.equal(a.isStaggered(), false);
  assert.equal(a.isFlinchLocked(), false);
  assert.equal(a.canAct(), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
