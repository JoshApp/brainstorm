// Meeting a charge — the contract that makes the counter takeable.
//
// A deflectable attack the player cannot REACT to isn't an option, it's a
// coin flip with extra steps. These assertions are about time and payoff, the
// two things that decide whether anyone ever chooses to meet a charge instead
// of sidestepping it (which is free, and always works).
//
//   npm test -- deflect-charge

import assert from 'node:assert/strict';
import { ENEMIES } from '../src/content/enemies';
import { CONFIG } from '../src/config';
import { threatReach, isDeflectable, type Ability } from '../src/content/abilities';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const abilityOf = (enemyId: string, abilityId: string): Ability => {
  const a = ENEMIES[enemyId]?.abilities?.find((x) => x.id === abilityId);
  assert.ok(a, `${enemyId}/${abilityId} exists`);
  return a!;
};

test('the skirmisher charge is deflectable, and its slash still is too', () => {
  assert.equal(isDeflectable(abilityOf('skirmisher', 'charge')), true,
    'a charge must have a committed answer, not only a sidestep');
  assert.equal(isDeflectable(abilityOf('skirmisher', 'slash')), true);
});

test('a dash threatens over its COMMIT range, not its contact reach', () => {
  const charge = abilityOf('skirmisher', 'charge');
  const dash = charge.steps[0].action;
  assert.equal(dash.kind, 'dash');
  if (dash.kind !== 'dash') return;
  assert.equal(threatReach(charge), charge.maxRange,
    'flashing at contactReach would light the tell after it is already too late');
  assert.ok(threatReach(charge)! > dash.contactReach);
});

test('meeting a charge leaves a human enough time to answer', () => {
  // THE load-bearing number. The white flash opens FLASH_LEAD_S before the
  // strike; the charge then has to physically cross from wherever it committed
  // down to contactReach. The WORST case is committing at its minimum range,
  // where there is almost no travel — so the flash lead is nearly all the
  // warning there is. Human reaction to a visual cue is ~250ms.
  const charge = abilityOf('skirmisher', 'charge');
  const dash = charge.steps[0].action;
  if (dash.kind !== 'dash') { assert.fail('charge must open on a dash'); return; }

  const closest = charge.minRange ?? 0;
  const travel = Math.max(0, closest - dash.contactReach) / dash.speed;
  const warning = CONFIG.DEFLECT.FLASH_LEAD_S + travel;

  assert.ok(warning >= 0.25,
    `only ${(warning * 1000).toFixed(0)}ms of warning — under human reaction time`);
  // And the window must still be open when it lands.
  assert.ok(CONFIG.DEFLECT.PARRY_WINDOW_S >= warning,
    'the parry window must still be live when the charge arrives');
});

test('meeting a charge pays better than dodging it', () => {
  // If the counter only means "you did not get hit", the sidestep dominates it
  // and the option is decoration. The charge multipliers are what buy the risk.
  assert.ok(CONFIG.DEFLECT.CHARGE_POISE_MUL > 1, 'a met charge must stagger harder');
  assert.ok(CONFIG.DEFLECT.CHARGE_KNOCKBACK_MUL > 1, 'and shove harder');

  // Concretely: a clean read should BREAK a skirmisher outright and open the
  // execute, rather than merely flinching it.
  const poise = ENEMIES['skirmisher'].poise ?? ENEMIES['skirmisher'].hp;
  const chunk = CONFIG.DEFLECT.POISE_DAMAGE * CONFIG.DEFLECT.CHARGE_POISE_MUL;
  assert.ok(chunk >= poise,
    `a met charge (${chunk} poise) should break a skirmisher (${poise}) outright`);
});

test('things that are avoided, not parried, never claim a threat band', () => {
  // Ranged / aoe / leap / blast must return null — a white flash on an
  // unparryable attack is a promise the combat system cannot keep.
  assert.equal(threatReach(abilityOf('bomb-ooze', 'detonate')), null,
    'a blast is dodge-only — there is nothing to put a blade against');
  assert.equal(isDeflectable(abilityOf('bomb-ooze', 'detonate')), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
