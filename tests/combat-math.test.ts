// Pure-function tests for the combat + progression math. These import only
// dependency-free modules (no browser globals), so they run under tsx in Node:
//
//   npm test
//
// Guards the pillar-1 numbers — damage floor/armor/multiplier and the leveling
// curve — against silent regressions as the stat pipeline grows.

import assert from 'node:assert/strict';
import { resolveDamage } from '../src/combat/damage-math';
import {
  xpFloorForLevel, levelForXp, xpInLevel, xpForNextLevel, XP_PER_LEVEL,
} from '../src/state/leveling';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

// ── Damage math ────────────────────────────────────────────────────────────
test('plain hit, no bonus/armor', () => {
  assert.equal(resolveDamage(10, 0, 1, 0).applied, 10);
});

test('flat bonus adds before multiplier', () => {
  // (10 + 2) * 1 = 12
  assert.equal(resolveDamage(10, 2, 1, 0).applied, 12);
});

test('multiplier applies to base+bonus', () => {
  // (10 + 2) * 1.5 = 18
  assert.equal(resolveDamage(10, 2, 1.5, 0).applied, 18);
});

test('armor subtracts after boost', () => {
  // (10 + 0) * 1 - 4 = 6
  assert.equal(resolveDamage(10, 0, 1, 4).applied, 6);
});

test('result is rounded', () => {
  // (3) * 1.5 = 4.5 -> 5 (round half up)
  assert.equal(resolveDamage(3, 0, 1.5, 0).applied, 5);
});

test('damage floors at 1 even through heavy armor', () => {
  assert.equal(resolveDamage(5, 0, 1, 999).applied, 1);
});

test('blocked reports absorbed amount', () => {
  // boosted 10, applied max(1, 10-4)=6, blocked 4
  const r = resolveDamage(10, 0, 1, 4);
  assert.equal(r.blocked, 4);
});

test('blocked is 0 when armor does not exceed boost meaningfully', () => {
  assert.equal(resolveDamage(10, 0, 1, 0).blocked, 0);
});

// ── Leveling curve ─────────────────────────────────────────────────────────
test('XP_PER_LEVEL is 10', () => {
  assert.equal(XP_PER_LEVEL, 10);
});

test('cumulative XP floors match the documented curve', () => {
  assert.equal(xpFloorForLevel(1), 0);
  assert.equal(xpFloorForLevel(2), 10);
  assert.equal(xpFloorForLevel(3), 30);
  assert.equal(xpFloorForLevel(4), 60);
  assert.equal(xpFloorForLevel(5), 100);
});

test('level 1 at 0 XP; never below 1', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(-5), 1);
});

test('levelForXp inverts the floor at boundaries', () => {
  assert.equal(levelForXp(10), 2);   // exactly at L2 floor
  assert.equal(levelForXp(29), 2);   // just below L3 floor
  assert.equal(levelForXp(30), 3);   // exactly at L3 floor
  assert.equal(levelForXp(99), 4);
  assert.equal(levelForXp(100), 5);
});

test('xpInLevel + floor reconstructs total', () => {
  for (const xp of [0, 5, 10, 15, 30, 59, 60, 250]) {
    assert.equal(xpFloorForLevel(levelForXp(xp)) + xpInLevel(xp), xp);
  }
});

test('xpForNextLevel equals the gap to the next floor', () => {
  // At L2 (xp 10..29): bar size = floor(3) - floor(2) = 30 - 10 = 20
  assert.equal(xpForNextLevel(10), 20);
  // At L3 (xp 30..59): floor(4) - floor(3) = 60 - 30 = 30
  assert.equal(xpForNextLevel(30), 30);
});

// ── Report ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
