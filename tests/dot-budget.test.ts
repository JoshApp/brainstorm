// A STATUS EFFECT IS PRESSURE, NOT A DEATH SENTENCE.
//
// Every damage-over-time was tuned by hand-picking a tick interval against an
// 8-point health pool. The pool became 5, nothing was re-derived, and the
// comments in content/buffs.ts still argued about eighths for months:
//
//   bleed   0.8s × 4 stacks  →  5 HP/s  →  100% of the bar per second
//   poison  1.0s × 4 stacks  →  4 HP/s  →   80% of the bar, THROUGH armour
//   flask   3 HP per sip     →           →   60% of the bar in one sip
//
// So the statuses got 60% harsher and the answer to them got 60% stronger, from
// one edit that touched neither file. The comment directly above bleed read "so
// it still ramps under pressure but doesn't melt you" while it melted you.
//
// TWO SEPARATE RULES, because fixing only the first one is not enough:
//
//   THE RATE. How fast a status drains you at full stacks. This is the drift
//   above, and the cure is docs/DESIGN-METHOD.md's "a cost denominated in
//   another system's units is a FRACTION" — with one refinement. The blood
//   altar's fix was to follow the player's LIVE pool, because a price you choose
//   to pay should scale with what you have. Damage coming AT you must not, or
//   every point of max HP a player buys is cancelled the moment anything bleeds
//   them. So these follow the BASE pool, resolved once.
//
//   THE SPIKE. `ecs/buffs.ts` multiplies the tick by stacks, so at the old cap
//   of 4 ONE poison tick was 4 damage on a 5-point bar — 80% of your health
//   between two frames, nothing to react to. A rate ceiling cannot see this: it
//   is satisfied by spacing the near-kills further apart. The stack cap is
//   derived from MAX_TICK_SHARE instead of picked.
//
// The numbers are deliberately gentler than the ones the game was ORIGINALLY
// tuned with. Restoring the old intent got bleed back to emptying a full bar in
// 1.6s, which was the design all along and is still wrong — a rat lands one bite
// and you are most of the way dead with no counterplay.
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
  { id: 'bleed', share: CONFIG.DOT_BUDGET.BLEED.share },
  { id: 'poison', share: CONFIG.DOT_BUDGET.POISON.share },
  { id: 'burn', share: CONFIG.DOT_BUDGET.BURN.share },
];

/** Damage from ONE tick at full stacks — `ecs/buffs.ts` multiplies by stacks. */
function tickAtCap(b: BuffSpec): number {
  return (b.maxStacks ?? 1) * ((b.tickEffect as { amount?: number } | undefined)?.amount ?? 0);
}

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

test('NO SINGLE TICK IS MOST OF YOUR HEALTH', () => {
  // THE ONE THAT MADE A RAT LETHAL, and the one a rate ceiling cannot express.
  //
  // Stacks multiply the tick, so at the old cap of 4 a single poison tick was 4
  // damage on a 5-point bar: 80% of your health between two frames, no warning,
  // nothing to react to. Slowing the interval does not touch a spike like that —
  // it only spaces the near-kills further apart. The stack cap is derived from
  // MAX_TICK_SHARE for exactly this reason; this asserts the derivation held.
  for (const { id } of DOTS) {
    const share = tickAtCap(BUFFS[id]) / CONFIG.PLAYER_HP_MAX;
    assert.ok(share <= CONFIG.DOT_BUDGET.MAX_TICK_SHARE + 0.001,
      `one ${id} tick at full stacks is ${(share * 100).toFixed(0)}% of the bar, `
      + `over the ${(CONFIG.DOT_BUDGET.MAX_TICK_SHARE * 100).toFixed(0)}% ceiling`);
  }
});

test('AND ONE PROC FROM ONE BITE IS A FIFTH OF THE BAR, NOT MOST OF IT', () => {
  // What the player actually meets. Enemies and affixes apply these for 2.5-4s
  // at a single stack (content/enemies.ts, content/affixes.ts), so the honest
  // question is not the rate at cap — it is what ONE rat bite costs. It used to
  // be 2-3 HP of a 5-point bar off a chance proc, which is how a trash mob
  // became a lethal threat without ever hitting you twice.
  const DURATION_S = 3;        // typical onHit duration across the content
  for (const { id } of DOTS) {
    const b = BUFFS[id];
    const amount = (b.tickEffect as { amount?: number }).amount ?? 0;
    const ticks = Math.floor(DURATION_S / (b.tickInterval ?? Infinity));
    const share = (ticks * amount) / CONFIG.PLAYER_HP_MAX;
    assert.ok(share <= 0.25,
      `a single-stack ${id} proc over ${DURATION_S}s costs ${(share * 100).toFixed(0)}% of the bar`);
    // And it must still DO something — a status that expires before it ticks is
    // a proc the player never sees and an enemy design that quietly does nothing.
    assert.ok(ticks >= 1, `a single-stack ${id} proc over ${DURATION_S}s never ticks at all`);
  }
});

test('AND NONE OF THEM KILLS A FULL-HEALTH PLAYER IN UNDER FIVE SECONDS', () => {
  // The player-facing statement of the rate rule. Bleed at cap emptied a full
  // bar in 1.0s, and restoring its ORIGINAL tuning only got that to 1.6s —
  // which was the design all along and still too fast to be anything but a
  // death sentence. A DoT is pressure: it should make you back off, drink, or
  // finish the fight faster. Five seconds is the floor at which those are
  // actually choices.
  const FLOOR_S = 5;
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
    const expected = tickAtCap(b);
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
