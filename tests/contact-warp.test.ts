// ONE CLOCK — the clip's visible hit must land on the mechanical one.
//
//   npm test -- contact-warp

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Animator } from '../src/anim/animator';
import { warpToContact, clipContactAt, mechanicalContactFrac } from '../src/anim/contact-warp';
import { CONFIG } from '../src/config';
import { ENEMIES } from '../src/content/enemies';
import { resolveAbilities } from '../src/content/abilities';
import type { Clip } from '../src/anim/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
const near = (a: number, b: number, tol = 1e-9, msg = '') =>
  assert.ok(Math.abs(a - b) < tol, `${msg} ${a} ≈ ${b}`);

test('the contact frames coincide — that is the whole point', () => {
  // Feed the warp the mechanical contact; it must return the clip's contact.
  for (const [c, m] of [[0.62, 0.40], [0.34, 0.80], [0.5, 0.5], [0.2, 0.9]]) {
    near(warpToContact(m, c, m), c, 1e-9, `clip ${c} / mech ${m}`);
  }
});

test('endpoints are preserved — the clip still starts at rest and ends at rest', () => {
  near(warpToContact(0, 0.62, 0.40), 0);
  near(warpToContact(1, 0.62, 0.40), 1);
});

test('the warp is monotonic — animation never stutters or runs backward', () => {
  for (const [c, m] of [[0.62, 0.40], [0.34, 0.85], [0.9, 0.1]]) {
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = warpToContact(p, c, m);
      assert.ok(v >= prev - 1e-12, `went backward at p=${p.toFixed(2)} (c=${c} m=${m})`);
      prev = v;
    }
  }
});

test('degenerate contacts fall through to identity, never NaN', () => {
  // A NaN here is a mob folded inside out; an unwarped clip is a small
  // imprecision. Always prefer the second.
  for (const [c, m] of [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1], [0, 0], [1, 1]]) {
    const v = warpToContact(0.37, c, m);
    assert.ok(Number.isFinite(v), `NaN/Inf at c=${c} m=${m}`);
    near(v, 0.37, 1e-9, `identity at c=${c} m=${m}`);
  }
});

test('contact is inferred from the easeInCubic SNAP, per the authoring convention', () => {
  const clip: Clip = {
    id: 't', duration: 1, keyframes: [
      { t: 0, pose: {} },
      { t: 0.34, pose: {} },
      { t: 0.62, pose: {}, ease: 'easeInCubic' },
      { t: 1, pose: {} },
    ],
  };
  near(clipContactAt(clip)!, 0.62);

  // An explicit contactAt wins over the inference.
  near(clipContactAt({ ...clip, contactAt: 0.5 })!, 0.5);

  // No snap keyframe → null, and such clips are left unwarped rather than guessed.
  assert.equal(clipContactAt({ id: 'x', duration: 1, keyframes: [{ t: 0, pose: {} }] }), null);
});

test('mechanicalContactFrac locates the damage inside the window', () => {
  // stoneguard: 1.40 / 0.22 / 1.00, contact 60% through the strike.
  const m = mechanicalContactFrac(1.40, 0.22, 1.00, 0.6)!;
  near(m, (1.40 + 0.22 * 0.6) / 2.62, 1e-12);
  assert.equal(mechanicalContactFrac(0, 0, 0, 0.6), null, 'degenerate window');
});

test('EVERY mob attack clip now lands its snap on its damage frame', () => {
  // The regression guard for the original bug. Before the warp, measured drift
  // ran +34ms (ghoul) to +197ms (stoneguard) — always the damage first, the limb
  // still travelling. Re-derived here from the REAL specs and clips, so a future
  // retune of any mob's phases can't silently reintroduce it.
  const frac = CONFIG.MOB_STRIKE_CONTACT_FRAC;
  let checked = 0;

  for (const spec of Object.values(ENEMIES)) {
    const bundle = spec.animation;
    if (!bundle?.abilities) continue;
    for (const ability of resolveAbilities(spec)) {
      const clip = bundle.abilities[ability.id];
      if (!clip) continue;
      const c = clipContactAt(clip);
      if (c === null) continue;
      // Only melee-opening abilities are warped — a dash connects positionally,
      // so it has no fixed instant to align to.
      if (ability.steps[0]?.action.kind !== 'melee') continue;

      const m = mechanicalContactFrac(ability.windup, ability.strike, ability.recover, frac);
      assert.ok(m !== null, `${spec.id}/${ability.id} has a degenerate window`);

      const total = ability.windup + ability.strike + ability.recover;
      // Sample the warp at the real damage moment; it must give the clip's snap.
      const sampledClipTime = warpToContact(m!, c, m!);
      const driftMs = Math.abs(sampledClipTime - c) * total * 1000;
      assert.ok(driftMs < 1,
        `${spec.id}/${ability.id}: ${driftMs.toFixed(1)}ms of drift survives the warp`);
      checked++;
    }
  }
  assert.ok(checked >= 3, `only ${checked} clips checked — the sweep found nothing to guard`);
});

test('the ANIMATOR actually applies the warp (wiring, not just arithmetic)', () => {
  // The tests above prove the maths. This proves enemy.ts → Animator →
  // contact-warp is really connected — the failure mode where a correct helper
  // sits unused and the drift quietly persists.
  const joint = new THREE.Object3D();
  joint.name = 'shoulderR';
  const slots = new Map<string, THREE.Object3D>([['shoulderR', joint]]);

  // A clip whose SNAP at t=0.62 drives the joint to a distinctive angle.
  const SNAP_ROT = 1.2345;
  const clip: Clip = {
    id: 'probe', duration: 1, smooth: false, keyframes: [
      { t: 0, pose: { shoulderR: { rot: [0, 0, 0] } } },
      { t: 0.62, pose: { shoulderR: { rot: [SNAP_ROT, 0, 0] } }, ease: 'easeInCubic' },
      { t: 1, pose: { shoulderR: { rot: [0, 0, 0] } } },
    ],
  };

  // Stoneguard-shaped window: contact lands at ~0.584 of the total, well away
  // from the clip's 0.62 — so an unwarped play would be visibly early.
  const windup = 1.40, strike = 0.22, recover = 1.00;
  const total = windup + strike + recover;
  const mech = mechanicalContactFrac(windup, strike, recover, CONFIG.MOB_STRIKE_CONTACT_FRAC)!;

  const step = 1 / 600;   // fine steps so we land near the contact instant
  const runTo = (target: number, warped: boolean) => {
    joint.rotation.set(0, 0, 0);
    const a = new Animator(slots, ['shoulderR']);
    a.playOverride(clip, total, warped ? mech : null);
    for (let t = 0; t < target; t += step) a.update(step);
    return joint.rotation.x;
  };

  const contactTime = mech * total;
  const warpedAtContact = runTo(contactTime, true);
  const unwarpedAtContact = runTo(contactTime, false);

  // Warped: at the damage instant the limb is AT its snap pose.
  assert.ok(Math.abs(warpedAtContact - SNAP_ROT) < 0.02,
    `warped pose at contact was ${warpedAtContact.toFixed(3)}, expected ≈${SNAP_ROT}`);
  // Unwarped: it is measurably short of it — the original bug, still reproducible.
  assert.ok(unwarpedAtContact < SNAP_ROT - 0.05,
    `unwarped pose should lag at contact, got ${unwarpedAtContact.toFixed(3)}`);
  assert.ok(warpedAtContact > unwarpedAtContact,
    'the warp must move the limb CLOSER to its snap at the damage frame');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
