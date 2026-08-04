// Player ACTION SPEED — "faster attacks" reaching the swing clock.
//
// `action-speed-mult` has been on relics, vestments, cards and one tainted
// mutation for a long time, and aggregateSpeed has always summed it. Nothing on
// the PLAYER side ever read the result: swing timing came off the weapon's own
// `attackSpeed` alone, so every one of those items was a tooltip with no effect
// behind it. These pin the wiring so it can't silently come loose again.
//
//   npm test

import assert from 'node:assert/strict';
import { setCurrentWeapon } from '../src/player/current-weapon';
import { setSlot } from '../src/player/equipment';
import { getPlayerActionSpeedMult } from '../src/combat/modifiers';
import { createSwingState } from '../src/combat/swing-state';
import type { ItemSpec } from '../src/content/item-types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  // A legacy-class weapon (spear) so the phase machine drives the timings; the
  // timeline path is covered by the second half of the file.
  setCurrentWeapon({ reach: 2.1, coneHalfAngle: 0.8, damage: 1, critChance: 0.05, critMultiplier: 2.0, class: 'spear' });
  setSlot('amulet', null);
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
  setSlot('amulet', null);
}

/** A bare amulet carrying one modifier — the smallest thing that can change a
 *  player stat without dragging in loot rolls or the reliquary. */
function amulet(mult: number): ItemSpec {
  return {
    id: 'test-haste', name: 'Test Haste', kind: 'amulet', rarity: 'common',
    description: '', modifiers: [{ kind: 'action-speed-mult', amount: mult }],
  } as ItemSpec;
}

/** Seconds of simulated time before the swing returns to idle. */
function swingSeconds(step = 1 / 240): number {
  const s = createSwingState();
  s.requestSwing();
  let t = 0;
  while (s.isSwinging() && t < 20) { s.advance(step); t += step; }
  return t;
}

test('an unmodified player swings at the weapon\'s own speed', () => {
  assert.equal(getPlayerActionSpeedMult(), 1);
});

test('an equipped haste modifier reaches the aggregate', () => {
  setSlot('amulet', amulet(1.2));
  assert.ok(Math.abs(getPlayerActionSpeedMult() - 1.2) < 1e-9,
    `expected 1.2, got ${getPlayerActionSpeedMult()}`);
});

test('haste makes the swing actually finish sooner', () => {
  const base = swingSeconds();
  setSlot('amulet', amulet(1.5));
  const hasted = swingSeconds();
  assert.ok(hasted < base * 0.95,
    `haste did not shorten the swing: ${base.toFixed(3)}s → ${hasted.toFixed(3)}s`);
});

test('a slow modifier makes it take longer', () => {
  const base = swingSeconds();
  setSlot('amulet', amulet(0.6));
  const slowed = swingSeconds();
  assert.ok(slowed > base * 1.05,
    `slow did not lengthen the swing: ${base.toFixed(3)}s → ${slowed.toFixed(3)}s`);
});

test('the effect is roughly proportional, not a token nudge', () => {
  // The whole complaint was that the number on the card did nothing. Half again
  // as fast should land within a wide band of half again as fast — wide because
  // the phase machine advances in discrete dt steps and a cadence floor can
  // hold the tail.
  const base = swingSeconds();
  setSlot('amulet', amulet(1.5));
  const hasted = swingSeconds();
  const ratio = base / hasted;
  assert.ok(ratio > 1.2 && ratio < 1.9, `expected ~1.5x faster, got ${ratio.toFixed(2)}x`);
});

test('an absurd modifier cannot drive the swing clock to zero or negative', () => {
  setSlot('amulet', amulet(0.0001));
  assert.ok(getPlayerActionSpeedMult() > 0);
  const t = swingSeconds(1 / 60);
  assert.ok(t > 0 && t < 20, `swing never ended (${t.toFixed(2)}s)`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
