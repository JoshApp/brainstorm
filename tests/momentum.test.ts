// MOMENTUM — the rules that must hold, stated as failures.
//
// docs/MOVEMENT.md argues for this mechanic; src/player/momentum.ts implements
// it. What makes it safe rather than just fun is a short list of things it must
// NEVER do, and every one of them is a thing that would only show up on a phone
// three weeks from now:
//
//   - build while you push hopelessly into a wall (intent is not travel);
//   - survive a fight (it would become a kiting buff, competing with the dodge);
//   - survive a hit (you could tank one and keep running);
//   - give a meaningful payout for a trickle (the vault would read as random).
//
// These exercise `stepMomentum`, which is the shipping function — the game's
// per-frame tick is a thin wrapper that feeds it real travel.
//
//   npm test

import assert from 'node:assert/strict';
import { stepMomentum } from '../src/player/momentum';
import { CONFIG } from '../src/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const DT = 1 / 60;

/** Run the real step function for `seconds`, and hand back where it landed. */
function simulate(
  seconds: number,
  o: { travelFrac: number; holdingRun?: boolean; inCombat?: boolean; from?: number },
): number {
  let m = o.from ?? 0;
  for (let t = 0; t < seconds; t += DT) {
    m = stepMomentum(m, DT, {
      travelFrac: o.travelFrac,
      holdingRun: o.holdingRun ?? false,
      inCombat: o.inCombat ?? false,
    });
  }
  return m;
}

test('IT BUILDS FROM TRAVEL, and fills in about the time config says', () => {
  const M = CONFIG.MOMENTUM;
  // Not instantly...
  assert.ok(simulate(0.4, { travelFrac: 1 }) < 0.4, 'momentum filled far too fast to feel earned');
  // ...and it is actually full by the stated build time, with the decay term
  // accounted for. If this drifts, BUILD_S has stopped meaning what it says.
  assert.ok(simulate(M.BUILD_S + 0.4, { travelFrac: 1 }) > 0.98,
    `not full after ${M.BUILD_S}s of unbroken running`);
});

test('PUSHING INTO A WALL EARNS NOTHING — intent is not travel', () => {
  // The whole reason the tick is fed metres actually covered rather than stick
  // deflection. A player mashing forward against a pillar has not gone
  // anywhere, and must not arrive at the next gap able to clear it.
  assert.equal(simulate(5, { travelFrac: 0 }), 0);
  // And a half-blocked scrape along a wall BLEEDS rather than holds, which is
  // what makes picking a clean line the skill.
  const scraping = simulate(3, { travelFrac: 0.25, from: 1 });
  assert.ok(scraping < 0.6, `a quarter-speed scrape held ${scraping.toFixed(2)} momentum`);
});

test('HOLDING RUN ONLY FILLS FASTER — it is not a second speed system', () => {
  const held = simulate(1.0, { travelFrac: 1, holdingRun: true });
  const walked = simulate(1.0, { travelFrac: 1, holdingRun: false });
  assert.ok(held > walked, 'the run button did nothing');
  // But walking alone STILL gets there eventually — that is the Terraria-boots
  // discovery, and losing it would make this a plain sprint button again.
  assert.ok(simulate(CONFIG.MOMENTUM.BUILD_S + 0.4, { travelFrac: 1 }) > 0.98,
    'momentum can only be built by holding the button — the discovery is gone');
});

test('A FIGHT KILLS IT, however fast you are moving', () => {
  // The rule that keeps this from competing with the dodge. Not a gate someone
  // has to remember — running full tilt in combat still drains.
  assert.equal(simulate(2, { travelFrac: 1, inCombat: true, from: 1 }), 0);
  assert.equal(simulate(2, { travelFrac: 1, inCombat: true, holdingRun: true, from: 1 }), 0);
});

test('...and it drains FASTER in combat than out of it', () => {
  // Otherwise "dies in a fight" is a comment rather than a behaviour.
  const inFight = simulate(0.2, { travelFrac: 0, inCombat: true, from: 1 });
  const clear = simulate(0.2, { travelFrac: 0, inCombat: false, from: 1 });
  assert.ok(inFight < clear, 'combat drain is no faster than ordinary decay');
});

test('you can rebuild once you have BROKEN OFF, so fleeing is possible', () => {
  // The other side of the combat rule. If momentum could never return after a
  // fight started, disengaging would be punished rather than rewarded — and on
  // a phone, being unable to leave is how a run ends badly for the wrong
  // reason. combat-state.ts opens back up 3s after the last hit.
  const afterBreakingOff = simulate(2.5, { travelFrac: 1, inCombat: false, from: 0 });
  assert.ok(afterBreakingOff > 0.8, 'momentum could not be rebuilt after disengaging');
});

test('IT NEVER LEAVES 0..1', () => {
  // Bounds, checked at both ends and from silly starting values, because every
  // consumer multiplies by this and an out-of-range value would show up as a
  // camera or a speed doing something inexplicable.
  assert.equal(simulate(10, { travelFrac: 1, holdingRun: true, from: 1 }), 1);
  assert.equal(simulate(10, { travelFrac: 0, from: 0 }), 0);
  assert.ok(stepMomentum(1, 100, { travelFrac: 1, holdingRun: true, inCombat: false }) <= 1);
  assert.ok(stepMomentum(0, 100, { travelFrac: 0, holdingRun: false, inCombat: false }) >= 0);
});

test('a huge frame delta does not overshoot into nonsense', () => {
  // A tab-out or a stall hands the tick a dt measured in seconds. Clamping is
  // the difference between "you come back fast" and "you come back broken".
  const spike = stepMomentum(0.5, 3.0, { travelFrac: 1, holdingRun: true, inCombat: false });
  assert.ok(spike >= 0 && spike <= 1);
});

test('DISABLING IT IN CONFIG ACTUALLY DISABLES IT', () => {
  // The kill switch has to work, because the first phone pass on a feel
  // mechanic is exactly when you want to turn it off and compare.
  const was = CONFIG.MOMENTUM.ENABLED;
  try {
    (CONFIG.MOMENTUM as { ENABLED: boolean }).ENABLED = false;
    assert.equal(simulate(10, { travelFrac: 1, holdingRun: true }), 0);
  } finally {
    (CONFIG.MOMENTUM as { ENABLED: boolean }).ENABLED = was;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
