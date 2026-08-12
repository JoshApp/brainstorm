// STEP-IN — attacks that travel, so a backstep isn't a universal answer.
//
//   npm test -- step-in

import assert from 'node:assert/strict';
import { withDefaultStepIn, resolveAbilities, type Ability } from '../src/content/abilities';
import { CONFIG } from '../src/config';
import { ENEMIES } from '../src/content/enemies';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const CFG = CONFIG.ENEMY_AI.STEP_IN;
const FRAC = CONFIG.MOB_STRIKE_CONTACT_FRAC;

const melee = (over: Partial<Ability> = {}): Ability => ({
  id: 'strike', maxRange: 1.5, windup: 0.9, strike: 0.18, recover: 0.6,
  steps: [{ trigger: { at: 0 }, action: { kind: 'melee', reach: 1.4, damage: 1 } }],
  ...over,
});

test('a melee swing gets a step-in spanning its contact frame', () => {
  const a = withDefaultStepIn(melee(), CFG, FRAC);
  assert.ok(a.motion, 'melee should step in');
  const total = a.windup + a.strike + a.recover;
  const contact = (a.windup + a.strike * FRAC) / total;
  assert.ok(a.motion!.from < contact, 'the step must begin BEFORE the blow lands');
  assert.ok(a.motion!.to >= contact, 'and still be carrying through it');
  assert.equal(a.motion!.distance, CFG.DISTANCE);
});

test('the span is anchored to contact, so different phase shapes still line up', () => {
  // A glacial stoneguard and a quick jab must both start stepping the same beat
  // before they land — that's the point of anchoring to contact rather than to
  // fixed window fractions.
  const slow = withDefaultStepIn(melee({ windup: 1.4, strike: 0.22, recover: 1.0 }), CFG, FRAC);
  const fast = withDefaultStepIn(melee({ windup: 0.4, strike: 0.14, recover: 0.5 }), CFG, FRAC);
  const lead = (a: Ability) => {
    const total = a.windup + a.strike + a.recover;
    return ((a.windup + a.strike * FRAC) / total - a.motion!.from) * total;
  };
  // Both lead the hit by CFG.LEAD of their own window — so in SECONDS the slow
  // one leads by more, which is correct: a heavier attack telegraphs longer.
  assert.ok(lead(slow) > lead(fast), 'a heavier swing should lean in for longer');
  assert.ok(lead(fast) > 0.05, 'but a quick jab still has a visible lean');
});

test('explicit motion wins, and null opts out entirely', () => {
  const authored = { distance: 3, from: 0.1, to: 0.2 };
  assert.deepEqual(withDefaultStepIn(melee({ motion: authored }), CFG, FRAC).motion, authored);
  assert.equal(withDefaultStepIn(melee({ motion: null }), CFG, FRAC).motion, null,
    'a planted swing must stay planted');
});

test('things that move themselves are left alone', () => {
  const charge = melee({
    steps: [{ trigger: { at: 0 }, action: { kind: 'dash', toward: 'player', speed: 7.5, contactReach: 1.35, damage: 1 } }],
  });
  assert.equal(withDefaultStepIn(charge, CFG, FRAC).motion, undefined,
    'a dash already carries the body — a step-in on top would double-move it');

  const blast = melee({
    steps: [{ trigger: { at: 0 }, action: { kind: 'blast', origin: 'self', radius: 2, damage: 2 } }],
  });
  assert.equal(withDefaultStepIn(blast, CFG, FRAC).motion, undefined);
});

test('ROSTER SWEEP: every mobile melee mob now steps in, and no rooted one does', () => {
  // The check that matters for a default applied game-wide. A step-in on a
  // floor-anchored mob would teach it to walk, which is a silent regression in
  // exactly the enemy whose identity is that it CAN'T.
  let stepping = 0, rooted = 0;
  for (const spec of Object.values(ENEMIES)) {
    const cfg = spec.moveSpeed > 0 ? CFG : undefined;
    for (const a of resolveAbilities(spec, undefined, cfg, FRAC)) {
      const opensOnMelee = a.steps[0]?.action.kind === 'melee';
      if (spec.moveSpeed === 0) {
        assert.ok(!a.motion, `${spec.id}/${a.id} is rooted (moveSpeed 0) but would step in`);
        if (opensOnMelee) rooted++;
      } else if (opensOnMelee && a.motion !== null) {
        assert.ok(a.motion, `${spec.id}/${a.id} is a melee swing that still stands still`);
        assert.ok(a.motion!.distance > 0 && a.motion!.to > a.motion!.from,
          `${spec.id}/${a.id} has a degenerate step`);
        stepping++;
      }
    }
  }
  assert.ok(stepping >= 8, `only ${stepping} melee attacks step in — the default isn't reaching the roster`);
  assert.ok(rooted >= 1, 'expected at least one rooted melee mob (the lasher) to prove the guard fires');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
