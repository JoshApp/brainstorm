// Enemy INTENT — the liveness guarantee.
//
// Reported from the phone: "some rooms have mobs that just stand around, track
// me but never move or aggro — but not all rooms, it's weird."
//
// It was not the rooms. Every utility score in selectIntent is a function of
// personality and mood, and none of them grew with TIME, so a cautious draw
// could sit in WATCH indefinitely. Worked example at the steady-state mood for
// boldness 0.25 / patience 0.75: watch 0.641, circle 0.573, press 0.488 — watch
// wins nearly every roll, and on the rare roll where press wins, the
// MOOD_COMMIT_DROP that follows RAISES watch (it is scored on 1 - aggression)
// and lowers press, settling the mob back into staring. "Some rooms, not all"
// was rollPersonality's ±0.25 jitter: a timid draw locks up, a bold one plays
// fine, and a room reads as broken when several of its mobs drew timid.
//
// The fix is a starvation term that ramps pressure into press/close and out of
// watch as a mob goes un-committed. These tests pin the property that matters —
// EVERY personality engages eventually — rather than the numbers that produce
// it, so the scores stay free to be retuned.
//
// Imports the real selectIntent (docs/DESIGN-METHOD.md: "every audit tool
// imports the real function" — a re-inlined copy of the scoring would launder a
// guess as a measurement).
//
//   npm test -- intent-liveness

import assert from 'node:assert/strict';
import { selectIntent, rollPersonality } from '../src/mobs/intent';
import { CONFIG } from '../src/config';

const I = CONFIG.ENEMY_AI.INTENT;

/** Deterministic stand-in for the seeded game rng. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Run one mob's decision loop against a stationary player and report how many
 * seconds pass before it first chooses an engaging intent (one that either
 * closes the gap or releases an attack). Mirrors enemy.ts: mood warms toward the
 * personality target, decisions fire on the slow tick, sinceCommit accumulates
 * until a commit. Returns Infinity if it never engages inside `limitS`.
 */
function secondsUntilEngaged(
  personality: { boldness: number; patience: number; packLoyalty: number },
  distance: number,
  opts: { canAttack?: boolean; hpFrac?: number; seed?: number; limitS?: number } = {},
): number {
  const { canAttack = true, hpFrac = 1, seed = 12345, limitS = 30 } = opts;
  const rng = seededRng(seed);
  const dt = 1 / 60;
  let aggression = 0;
  let sinceCommit = 0;
  let decisionTimer = 0;
  const warmTarget = I.MOOD_TARGET_BASE + personality.boldness * I.MOOD_TARGET_BOLD;

  for (let t = 0; t < limitS; t += dt) {
    aggression += (warmTarget - aggression) * Math.min(1, I.MOOD_WARM_RATE * dt);
    sinceCommit += dt;
    decisionTimer -= dt;
    if (decisionTimer > 0) continue;
    decisionTimer = I.DECISION_MIN + rng() * I.DECISION_JITTER;
    const choice = selectIntent({
      distance, reach: 2.0, commitDistance: 3.0,
      aggression, personality, canAttack, hpFrac, sinceCommit, rng,
    });
    if (choice.releaseAttack) return t;          // committed — fed
    if (choice.moveMode === 'close') return t;   // closing the gap — also engaging
  }
  return Infinity;
}

const TIMID = { boldness: 0.15, patience: 0.9, packLoyalty: 0.5 };
const MEASURED_BAD = { boldness: 0.25, patience: 0.75, packLoyalty: 0.5 };

// ── The reported bug, as a test ──────────────────────────────────────────────
// The exact personality worked out by hand above, at the distance where it used
// to lock: inside the commit band, so the "well out of range → close" early-out
// does not rescue it.
{
  const t = secondsUntilEngaged(MEASURED_BAD, 2.6);
  assert.ok(
    Number.isFinite(t),
    'the measured lock-up personality (boldness .25 / patience .75) never engaged',
  );
  assert.ok(t <= I.STARVE_FULL + 2, `expected engagement within STARVE_FULL + 2s, got ${t.toFixed(2)}s`);
}

// The worst draw rollPersonality can produce, not just the one observed.
{
  const t = secondsUntilEngaged(TIMID, 2.6);
  assert.ok(Number.isFinite(t), 'the most timid possible personality never engaged');
  assert.ok(t <= I.STARVE_FULL + 2, `most-timid engaged only after ${t.toFixed(2)}s`);
}

// ── Sweep the whole space, not one draw ──────────────────────────────────────
// Every personality, at every distance inside the band, at full and low HP,
// across several rng streams. This is the property: nothing stares forever.
{
  let worst = 0;
  let worstDesc = '';
  for (let b = 0; b <= 1.0001; b += 0.25) {
    for (let p = 0; p <= 1.0001; p += 0.25) {
      for (const distance of [1.5, 2.0, 2.6, 3.0, 3.4]) {
        for (const hpFrac of [1, 0.2]) {
          for (const seed of [1, 7, 99]) {
            const t = secondsUntilEngaged(
              { boldness: b, patience: p, packLoyalty: 0.5 },
              distance, { hpFrac, seed },
            );
            assert.ok(
              Number.isFinite(t),
              `never engaged: boldness ${b}, patience ${p}, dist ${distance}, hp ${hpFrac}, seed ${seed}`,
            );
            if (t > worst) {
              worst = t;
              worstDesc = `boldness ${b}, patience ${p}, dist ${distance}, hp ${hpFrac}`;
            }
          }
        }
      }
    }
  }
  assert.ok(worst <= I.STARVE_FULL + 2, `slowest to engage was ${worst.toFixed(2)}s — ${worstDesc}`);
}

// The nastier half of the original bug: a mob that CANNOT attack from where it
// stands must still close, or it never reaches a range where it could. Watch
// used to out-score close here for a patient mob, which is the version of the
// bug that never resolved on its own.
{
  for (const p of [0.5, 0.75, 1.0]) {
    const t = secondsUntilEngaged(
      { boldness: 0.2, patience: p, packLoyalty: 0.5 },
      3.2, { canAttack: false },
    );
    assert.ok(Number.isFinite(t), `out-of-band mob with patience ${p} never closed`);
  }
}

// ── Personality must still MEAN something ────────────────────────────────────
// Starvation is a floor on engagement, not a flattener: a bold mob should still
// come in markedly sooner than a timid one, or we have fixed the bug by
// deleting the system.
{
  const bold = secondsUntilEngaged({ boldness: 1, patience: 0, packLoyalty: 0.5 }, 2.6);
  const timid = secondsUntilEngaged(TIMID, 2.6);
  assert.ok(
    bold < timid,
    `bold (${bold.toFixed(2)}s) should engage sooner than timid (${timid.toFixed(2)}s)`,
  );
}

// rollPersonality stays inside 0..1 — the sweep above only covers the space if
// the roller cannot escape it.
{
  const rng = seededRng(4242);
  for (let i = 0; i < 500; i++) {
    const p = rollPersonality(rng, { boldness: 0.1, patience: 0.95 });
    for (const [k, v] of Object.entries(p)) {
      assert.ok(v >= 0 && v <= 1, `rollPersonality produced ${k}=${v}, outside 0..1`);
    }
  }
}

console.log('intent-liveness: ok');
