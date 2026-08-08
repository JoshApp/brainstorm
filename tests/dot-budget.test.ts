// A STATUS EFFECT'S LETHALITY IS MEASURED IN SECONDS, NOT IN HP.
//
// Every damage-over-time in the game was tuned by hand-picking a tick interval
// against an 8-point health pool. The pool became 5. Nothing re-derived, and the
// comments in content/buffs.ts still argued about eighths for months:
//
//   bleed   0.8s × 4 stacks  →  5 HP/s  →  100% of the bar per second
//   poison  1.0s × 4 stacks  →  4 HP/s  →   80% of the bar, THROUGH armour
//   flask   3 HP per sip     →           →   60% of the bar in one sip
//
// So the statuses got 60% harsher and the answer to them got 60% stronger, from
// a single edit that touched neither file. The comment directly above bleed read
// "so it still ramps under pressure but doesn't melt you" while it melted you.
//
// This is docs/DESIGN-METHOD.md's "a cost denominated in another system's units
// is a FRACTION, not a number" — with one refinement this suite exists to
// protect. The blood altar's fix was to follow the player's LIVE pool, because a
// price you choose to pay should scale with what you have. Damage coming AT you
// must NOT: a DoT that scaled with max HP would cancel every point of HP a
// player ever buys, and the stat would be a lie. So these follow the BASE pool,
// resolved once, and investing in health genuinely buys you seconds.
//
// The load-bearing assertion here is the last one. The first three would all
// pass again on a future edit that hard-codes an interval that happens to be
// right today; only "the interval is DERIVED" catches the bug that actually
// happened, which was a literal outliving its reason.
//
//   npm test -- dot-budget

import assert from 'node:assert/strict';
import { BUFFS } from '../src/content/buffs';
import { CONFIG } from '../src/config';
import type { BuffSpec } from '../src/ecs/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** The three damage-over-time statuses and the budget each is meant to spend. */
const DOTS: ReadonlyArray<{ id: string; share: number }> = [
  { id: 'bleed', share: CONFIG.DOT_BUDGET.BLEED },
  { id: 'poison', share: CONFIG.DOT_BUDGET.POISON },
  { id: 'burn', share: CONFIG.DOT_BUDGET.BURN },
];

/** HP per second at full stacks — read off the shipped spec, never re-inlined. */
function dpsAtCap(b: BuffSpec): number {
  const amount = (b.tickEffect as { amount?: number } | undefined)?.amount ?? 0;
  return ((b.maxStacks ?? 1) * amount) / (b.tickInterval ?? Infinity);
}

test('THE STATUSES EXIST AND STILL TICK DAMAGE', () => {
  // Guard against every assertion below passing over a renamed or de-fanged
  // buff — a DoT that stopped dealing damage would satisfy any ceiling.
  for (const { id } of DOTS) {
    const b = BUFFS[id];
    assert.ok(b, `${id} is not in the buff library any more`);
    assert.equal((b.tickEffect as { type?: string } | undefined)?.type, 'damage',
      `${id} no longer ticks damage — this suite would be vacuous`);
    assert.ok(dpsAtCap(b) > 0, `${id} deals no damage at full stacks`);
  }
});

test('NO STATUS SPENDS MORE OF THE BAR THAN ITS BUDGET', () => {
  for (const { id, share } of DOTS) {
    const b = BUFFS[id];
    const realized = dpsAtCap(b) / CONFIG.PLAYER_HP_MAX;
    // 2% slack for the rounding in the derived interval, and no more — the bug
    // was a 60% overshoot, so a tolerance that could hide one is worthless.
    assert.ok(realized <= share + 0.02,
      `${id} spends ${(realized * 100).toFixed(0)}% of the bar per second, `
      + `over its ${(share * 100).toFixed(0)}% budget`);
  }
});

test('AND NONE OF THEM KILLS A FULL-HEALTH PLAYER IN UNDER A SECOND AND A HALF', () => {
  // The player-facing statement of the same rule, and the one a designer would
  // actually recognise. Bleed at cap emptied a full bar in 1.0s; the slowest a
  // status may be allowed to kill from full is a real design floor because
  // below it there is no time to react, drink, or disengage.
  const FLOOR_S = 1.5;
  for (const { id } of DOTS) {
    const seconds = CONFIG.PLAYER_HP_MAX / dpsAtCap(BUFFS[id]);
    assert.ok(seconds >= FLOOR_S,
      `${id} empties a full bar in ${seconds.toFixed(2)}s — under the ${FLOOR_S}s floor`);
  }
});

test('A SIP IS A HEAL, NOT A RESET', () => {
  // The other half of the same drift, in the other direction. A flask that
  // returns most of the bar makes every other sustain decision moot.
  const share = CONFIG.FLASK.HEAL_PER_CHARGE / CONFIG.PLAYER_HP_MAX;
  assert.ok(share <= 0.45,
    `one sip restores ${(share * 100).toFixed(0)}% of the bar — the flask is a full heal`);
  assert.ok(CONFIG.FLASK.HEAL_PER_CHARGE >= 1, 'a sip restores nothing');
});

test('THE INTERVALS ARE DERIVED FROM THE POOL, NOT WRITTEN DOWN', () => {
  // THE ONE THAT CATCHES THE REAL BUG.
  //
  // Everything above passes on a spec whose intervals are hard-coded numbers
  // that happen to be correct for today's pool — which is exactly the state the
  // game shipped in for months. This asserts the RELATIONSHIP instead: for each
  // status, interval × share × pool must equal its damage at full stacks. That
  // identity can only hold by construction. Hard-code an interval and it holds
  // until someone changes PLAYER_HP_MAX, which is the moment this test is for.
  for (const { id, share } of DOTS) {
    const b = BUFFS[id];
    const amount = (b.tickEffect as { amount?: number }).amount ?? 0;
    const expected = (b.maxStacks ?? 1) * amount;
    const actual = (b.tickInterval ?? 0) * share * CONFIG.PLAYER_HP_MAX;
    assert.ok(Math.abs(actual - expected) < 0.05,
      `${id}: interval ${b.tickInterval}s does not follow from DOT_BUDGET — `
      + `expected the interval that spends ${(share * 100).toFixed(1)}% of a `
      + `${CONFIG.PLAYER_HP_MAX}-point bar per second, got ${(expected / (b.tickInterval ?? 1) / CONFIG.PLAYER_HP_MAX * 100).toFixed(1)}%. `
      + `A literal here stops being true the moment the pool changes.`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
