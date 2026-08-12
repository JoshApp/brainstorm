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

test('a charge is told by time-to-contact, so warning is the same from any range', () => {
  // THE load-bearing number, and the reason the tell is time-based rather than
  // phase-based. A dash closes at its own speed from anywhere in its commit
  // band, so a fixed phase/distance tell gives wildly different warning
  // depending on where it committed from. Prove the spread is big enough to
  // matter — that's the justification for the time-to-contact branch in
  // enemy.ts's flash block.
  const charge = abilityOf('skirmisher', 'charge');
  const dash = charge.steps[0].action;
  if (dash.kind !== 'dash') { assert.fail('charge must open on a dash'); return; }

  const travelFrom = (d: number) => Math.max(0, d - dash.contactReach) / dash.speed;
  const nearest = travelFrom(charge.minRange ?? 0);
  const furthest = travelFrom(charge.maxRange);

  assert.ok(furthest - nearest > 0.3,
    `travel time varies by only ${((furthest - nearest) * 1000).toFixed(0)}ms — ` +
    'if this ever gets small, the time-to-contact tell stops earning its complexity');

  // Time-to-contact flashing means the warning IS the lead, whatever the range.
  assert.ok(CONFIG.DEFLECT.FLASH_LEAD_S >= 0.25,
    'the lead must clear human visual reaction time (~250ms)');
});

test('reacting FAST must never expire your own window before the blow lands', () => {
  // A player who taps the instant the flash appears opens their window at
  // exactly `lead` before contact. If the window is shorter than the lead, that
  // window closes BEFORE the hit — so the quickest players get punished for
  // being quick, which is the worst possible failure mode for a timing mechanic.
  // (This is a real regression that happened: raising the lead 0.30 -> 0.40 left
  // a 20ms margin against a 0.42 window.)
  const { FLASH_LEAD_S, PARRY_WINDOW_S } = CONFIG.DEFLECT;
  assert.ok(PARRY_WINDOW_S > FLASH_LEAD_S,
    `window ${PARRY_WINDOW_S}s must exceed lead ${FLASH_LEAD_S}s`);
  assert.ok(PARRY_WINDOW_S - FLASH_LEAD_S >= 0.10,
    `only ${((PARRY_WINDOW_S - FLASH_LEAD_S) * 1000).toFixed(0)}ms of slack — ` +
    'the comment on PARRY_WINDOW_S says "comfortably exceed", so hold it to that');
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
