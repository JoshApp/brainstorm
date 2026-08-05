// FEAR + BACKSTAB — the geometry and the ceiling.
//
// Two things are worth pinning here and they fail in opposite directions.
//
//   1. THE SIGN. "Behind" is a dot product against a body yaw, and CLAUDE.md
//      names axis confusion as the #1 documented failure mode for exactly this
//      kind of code. A flipped sign would not crash, would not fail a typecheck,
//      and would quietly hand out the backstab bonus to anything hit FROM THE
//      FRONT — the mechanic would look like it worked.
//
//      So every yaw in this file is built with THE CALLER'S OWN FORMULA
//      (`facingYaw`, below, is copied from enemy.ts faceTarget) rather than a
//      hand-picked number. DESIGN-METHOD §2: the vault-step guard passed its
//      tests for its entire broken life because the tests fed it unit vectors
//      while the caller fed it per-frame deltas. A test that invents its own
//      inputs agrees with the bug.
//
//   2. THE CEILING. Backstab is a player-CONTROLLED condition with a
//      multiplicative payoff — the exact shape DESIGN-METHOD §1 records as
//      "broken, always". It is only safe because it rides the additive-surplus
//      lane of composeStrikeDamage. The last test stacks every bonus a player
//      can legally hold at once, through the REAL function, and pins the total.
//
//   npm test

import assert from 'node:assert/strict';
import { composeStrikeDamage, rearDot } from '../src/combat/damage-math';
import { CONFIG } from '../src/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** The yaw a creature at (ex,ez) settles on to FACE (tx,tz) — lifted verbatim
 *  from enemy.ts faceTarget/faceWorld, which is the only thing that ever writes
 *  container.rotation.y. If this drifts from the real one, these tests are
 *  measuring a fiction. */
const facingYaw = (ex: number, ez: number, tx: number, tz: number) =>
  Math.atan2(tx - ex, tz - ez) + Math.PI;

const REAR = CONFIG.BACKSTAB.REAR_DOT;

test('a creature looking straight at you is not backstabbable', () => {
  // Player north of it, creature turned to face the player.
  const yaw = facingYaw(0, 0, 0, 5);
  const d = rearDot(0, 0, yaw, 0, 5);
  assert.ok(d > 0.99, `expected ~+1 (dead ahead), got ${d.toFixed(3)}`);
  assert.ok(d > REAR, 'a creature staring at you must never take a backstab');
});

test('a blade in the back of a creature facing away IS a backstab', () => {
  // The rout: it faced its travel, which is directly away from the player.
  // This is the exact case enemy.ts's fleeing branch produces via faceMovement.
  const yaw = facingYaw(0, 0, 0, -5);   // creature turned to face AWAY from a player at +Z
  const d = rearDot(0, 0, yaw, 0, 5);
  assert.ok(d < -0.99, `expected ~−1 (directly behind), got ${d.toFixed(3)}`);
  assert.ok(d <= REAR, 'a routing creature must be open from behind — that is the whole loop');
});

test('the flank is not the back', () => {
  // Standing square on its shoulder. Reads 0 — and the 120° rear arc must
  // refuse it, or "get behind it" degrades to "stand anywhere but in front".
  const yaw = facingYaw(0, 0, 0, 5);       // facing +Z (a player who WAS there)
  const d = rearDot(0, 0, yaw, 5, 0);      // attacker due +X
  assert.ok(Math.abs(d) < 0.01, `expected ~0 on the flank, got ${d.toFixed(3)}`);
  assert.ok(d > REAR, 'a flank hit must not pay a backstab');
});

test('the rear arc is the 120° the config claims', () => {
  // Walk the full circle and measure where the verdict flips, so the constant
  // and the arc it is supposed to describe cannot drift apart silently.
  const yaw = facingYaw(0, 0, 0, 5);   // facing +Z
  let openArc = 0;
  const STEPS = 3600;
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    if (rearDot(0, 0, yaw, Math.sin(a) * 3, Math.cos(a) * 3) <= REAR) openArc += 360 / STEPS;
  }
  assert.ok(Math.abs(openArc - 120) < 2,
    `the open arc measures ${openArc.toFixed(1)}° — REAR_DOT ${REAR} no longer means "behind its shoulders"`);
});

test('standing exactly on a creature is not a free backstab', () => {
  // Degenerate distance. Returning 0 here (or NaN) would read as "on the flank"
  // or poison every downstream comparison; +1 is the safe answer.
  const d = rearDot(3, 3, 1.2, 3, 3);
  assert.equal(d, 1);
});

test('fear cannot be chained into a permalock', () => {
  // break → panic → backstab → break again is a real loop a good player will
  // find. The immunity is the only thing standing between it and a mob that
  // never gets another turn, so it has to OUTLAST the fear it follows.
  const F = CONFIG.ENEMY_AI.FEAR;
  assert.ok(F.IMMUNE_AFTER > F.BREAK_DURATION,
    `fear lasts ${F.BREAK_DURATION}s and immunity only ${F.IMMUNE_AFTER}s — the creature can be re-feared as fast as it recovers`);
});

test('A BACKSTAB IS NOT A DELETE BUTTON', () => {
  // Every bonus a player can hold on ONE swing, stacked, through the real
  // composeStrikeDamage. This is the number that got a 1-damage dagger to 11
  // once before (DESIGN-METHOD §1) and the reason backstab went into the
  // additive lane rather than becoming an eighth true multiplier.
  const B = CONFIG.BACKSTAB.DAMAGE_MUL;
  const everything = [
    1.8,                            // full charge
    CONFIG.CHARGE.PERFECT_DAMAGE_MUL,
    CONFIG.JUST_DODGE.COUNTER_DAMAGE_MUL,
    CONFIG.EXECUTE.DAMAGE_MUL,
    1.2,                            // head zone
    B,
  ];
  const base = 10;
  const worst = composeStrikeDamage(base, true, 2.5, everything);
  assert.ok(worst / base <= 20,
    `the best legal swing multiplies base by ${(worst / base).toFixed(1)} — past the point where any fight is a fight`);

  // And the marginal cost of ADDING backstab to an already-perfect swing stays a
  // slice, not a doubling. That property is what makes it safe to add a ninth
  // good idea later; if this ratio ever climbs toward B, someone moved backstab
  // out of the surplus lane and back into the multiplicative one.
  const without = composeStrikeDamage(base, true, 2.5, everything.slice(0, -1));
  const marginal = worst / without;
  assert.ok(marginal < B,
    `backstab multiplies the whole swing by ${marginal.toFixed(2)} — it has left the additive lane`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
