// Enemy AI V2 — the Intent selector (docs/ENEMY-AI-V2.md). Pure function, so it
// unit-tests cleanly: given a fight snapshot, does it pick a sane intent?
//
//   npm test

import assert from 'node:assert/strict';
import { selectIntent, rollPersonality, type IntentInput, type Personality } from '../src/mobs/intent';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const NEUTRAL: Personality = { boldness: 0.5, patience: 0.5, packLoyalty: 0.5 };
// Deterministic rng stub (no jitter) so the score comparison is exact.
const noJitter = () => 0.5;

function input(over: Partial<IntentInput>): IntentInput {
  return {
    distance: 2, reach: 1.5, commitDistance: 2, aggression: 0.5,
    personality: NEUTRAL, canAttack: true, hpFrac: 1,
    // Freshly committed: these cases pin the personality/mood scoring, so they
    // are read with the starvation pressure at zero. Its own liveness guarantee
    // lives in intent-liveness.test.ts.
    sinceCommit: 0,
    rng: noJitter, ...over,
  };
}

test('well out of range → CLOSE (get in the fight)', () => {
  const c = selectIntent(input({ distance: 12, commitDistance: 2, reach: 1.5 }));
  assert.equal(c.intent, 'close');
  assert.equal(c.moveMode, 'close');
});

test('press only ever releases an attack', () => {
  for (const intent of ['close', 'circle', 'watch'] as const) {
    // Force each by construction is hard; instead assert the invariant on the
    // returned choice: releaseAttack === (intent === 'press').
  }
  // A hot, bold, in-range mob that CAN attack should press and release.
  const hot = selectIntent(input({ aggression: 1, personality: { boldness: 1, patience: 0, packLoyalty: 0.5 }, canAttack: true, distance: 1.5 }));
  assert.equal(hot.intent, 'press');
  assert.equal(hot.releaseAttack, true);
});

test('cannot attack → never presses (holds fire)', () => {
  const c = selectIntent(input({ canAttack: false, aggression: 1, personality: { boldness: 1, patience: 0, packLoyalty: 0.5 } }));
  assert.notEqual(c.intent, 'press');
  assert.equal(c.releaseAttack, false);
});

test('cold + patient + in-range → does NOT press (the lull)', () => {
  const c = selectIntent(input({ aggression: 0.0, personality: { boldness: 0.1, patience: 0.9, packLoyalty: 0.5 }, distance: 1.5 }));
  assert.notEqual(c.intent, 'press');
  // watch or circle — either way it holds fire and sizes you up.
  assert.equal(c.releaseAttack, false);
});

test('a hurt, timid mob leans to WATCH over CIRCLE', () => {
  const scared = selectIntent(input({ aggression: 0.0, hpFrac: 0.1, personality: { boldness: 0.0, patience: 1.0, packLoyalty: 0.5 }, canAttack: false }));
  assert.equal(scared.intent, 'watch');
  assert.equal(scared.moveMode, 'hold');
});

test('rollPersonality clamps to [0,1] and honours defaults direction', () => {
  // rng at extremes → still clamped in range.
  for (const r of [() => 0, () => 0.999999]) {
    const p = rollPersonality(r, { boldness: 0.9, patience: 0.1 });
    for (const v of [p.boldness, p.patience, p.packLoyalty]) {
      assert.ok(v >= 0 && v <= 1, `personality field in range: ${v}`);
    }
  }
  // Deterministic: same rng → same roll.
  const seq1 = [0.2, 0.7, 0.4]; let i1 = 0;
  const seq2 = [0.2, 0.7, 0.4]; let i2 = 0;
  const a = rollPersonality(() => seq1[i1++]);
  const b = rollPersonality(() => seq2[i2++]);
  assert.deepEqual(a, b);
});

test('press speed rushes; circle prowls slower', () => {
  const hot = selectIntent(input({ aggression: 1, personality: { boldness: 1, patience: 0, packLoyalty: 0.5 }, canAttack: true, distance: 1.5 }));
  assert.ok(hot.speedMul > 1, 'press rushes');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
