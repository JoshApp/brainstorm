// The animation engine core — pure, so fully testable without rendering.
// Locks: easing endpoints + overshoot, frame-rate-independent damping, spring
// convergence (critical = no overshoot, under-damped = overshoot), keyframe
// sampling (endpoints / mid-segment / eased), and additive layer blending.
//
//   npm test

import assert from 'node:assert/strict';
import { ease } from '../src/anim/easing';
import { damp, spring, makeSpring } from '../src/anim/spring';
import { sampleTrack, sampleClip, clipDuration, type ClipSpec } from '../src/anim/keyframes';
import { blendAdditive } from '../src/anim/pose-layers';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test('eases hit 0→1 endpoints; easeOutBack overshoots past 1', () => {
  for (const n of ['linear', 'easeOutQuad', 'easeInOutCubic', 'easeOutBack'] as const) {
    assert.ok(near(ease(n, 0), 0), `${n}(0) != 0`);
    assert.ok(near(ease(n, 1), 1), `${n}(1) != 1`);
  }
  // easeOutBack rises above 1 somewhere in the middle (the settle overshoot).
  let over = false;
  for (let t = 0.5; t < 1; t += 0.02) if (ease('easeOutBack', t) > 1.001) over = true;
  assert.ok(over, 'easeOutBack should overshoot past 1');
});

test('damp is frame-rate independent (one big step == two half steps)', () => {
  const big = damp(0, 10, 0.2, 0.1);
  let two = 0; two = damp(two, 10, 0.2, 0.05); two = damp(two, 10, 0.2, 0.05);
  assert.ok(near(big, two, 1e-9), `compose mismatch: ${big} vs ${two}`);
  // and it actually converges toward target
  let x = 0; for (let i = 0; i < 200; i++) x = damp(x, 10, 0.1, 0.016);
  assert.ok(near(x, 10, 1e-3), `did not converge: ${x}`);
});

test('critically-damped spring converges without overshoot; under-damped overshoots', () => {
  const crit = makeSpring(0);
  let maxCrit = 0;
  for (let i = 0; i < 600; i++) maxCrit = Math.max(maxCrit, spring(crit, 1, 3, 1.0, 0.016));
  assert.ok(maxCrit <= 1.0001, `critical spring overshot to ${maxCrit}`);
  assert.ok(near(crit.value, 1, 1e-2), `critical spring did not settle: ${crit.value}`);

  const under = makeSpring(0);
  let maxUnder = 0;
  for (let i = 0; i < 600; i++) maxUnder = Math.max(maxUnder, spring(under, 1, 3, 0.3, 0.016));
  assert.ok(maxUnder > 1.05, `under-damped spring should overshoot, peaked ${maxUnder}`);
  assert.ok(near(under.value, 1, 1e-2), `under-damped spring did not settle: ${under.value}`);
});

test('sampleTrack: clamps endpoints, eases segments', () => {
  const tr = [{ t: 0, v: 0 }, { t: 1, v: 10, ease: 'linear' as const }];
  assert.equal(sampleTrack(tr, -1), 0);     // before start clamps
  assert.equal(sampleTrack(tr, 2), 10);     // after end clamps
  assert.ok(near(sampleTrack(tr, 0.5), 5)); // linear midpoint
  // easeOutQuad on the segment pulls the midpoint above linear (fast then slow)
  const eased = [{ t: 0, v: 0 }, { t: 1, v: 10, ease: 'easeOutQuad' as const }];
  assert.ok(sampleTrack(eased, 0.5) > 5, 'easeOut midpoint should lead linear');
});

test('sampleClip evaluates every track; clipDuration derives from latest key', () => {
  const clip: ClipSpec = { tracks: {
    'blade.rot.x': [{ t: 0, v: 0 }, { t: 0.4, v: 2 }],
    'blade.pos.z': [{ t: 0, v: 0 }, { t: 0.2, v: -0.3 }, { t: 0.4, v: 0 }],
  } };
  assert.equal(clipDuration(clip), 0.4);
  const s = sampleClip(clip, 0.2);
  assert.ok(near(s['blade.rot.x'], 1), `rot mid = ${s['blade.rot.x']}`);
  assert.ok(near(s['blade.pos.z'], -0.3), `pos at key = ${s['blade.pos.z']}`);
});

test('blendAdditive sums weighted deltas over a base', () => {
  const base = { 'a.rot.x': 1, 'b.pos.y': 0 };
  const out = blendAdditive(base, [
    { delta: { 'a.rot.x': 2 }, weight: 0.5 },   // +1
    { delta: { 'b.pos.y': 4, 'c.rot.z': 1 }, weight: 0.25 }, // +1, and a base-less channel
    { delta: { 'a.rot.x': 100 }, weight: 0 },   // weight 0 → ignored
  ]);
  assert.ok(near(out['a.rot.x'], 2), `a = ${out['a.rot.x']}`);
  assert.ok(near(out['b.pos.y'], 1), `b = ${out['b.pos.y']}`);
  assert.ok(near(out['c.rot.z'], 0.25), `c = ${out['c.rot.z']}`);
  assert.equal(base['a.rot.x'], 1, 'base must not be mutated');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
