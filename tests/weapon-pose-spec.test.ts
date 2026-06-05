// Data-driven weapon poses — proves every migrated PoseSpec reproduces its
// original hand-coded animation EXACTLY (so the data can't drift from the tuned
// pose), plus the evaluator's envelope contract. This is the safety net that
// makes the additive migration safe to do without eyes on the screen.
//
//   npm test

import assert from 'node:assert/strict';
import {
  computeWeaponPose, legacyComputeWeaponPose, MIGRATED_POSE_KEYS,
} from '../src/player/weapon-animations';
import type { SwingPhase } from '../src/player/viewmodel';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const PHASES: SwingPhase[] = ['windup', 'strike', 'recover'];
const SAMPLES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const EPS = 1e-9;

function near(a: number, b: number, msg: string) {
  assert.ok(Math.abs(a - b) < EPS, `${msg}: ${a} ≈ ${b}`);
}

test('every migrated pose matches its original function across phase × t', () => {
  for (const key of MIGRATED_POSE_KEYS) {
    for (const phase of PHASES) {
      for (const t of SAMPLES) {
        // computeWeaponPose now routes the key through the data spec; the legacy
        // function is the untouched original. They must agree to the bit.
        const got = { ...computeWeaponPose(key, phase, t) };
        const want = { ...legacyComputeWeaponPose(key, phase, t) };
        const tag = `${key} ${phase}@${t}`;
        near(got.x, want.x, `${tag} x`);
        near(got.y, want.y, `${tag} y`);
        near(got.z, want.z, `${tag} z`);
        near(got.rotX, want.rotX, `${tag} rotX`);
        near(got.rotY, want.rotY, `${tag} rotY`);
        near(got.rotZ, want.rotZ, `${tag} rotZ`);
      }
    }
  }
});

test('envelope boundaries: windup starts at rest, recover ends at rest', () => {
  // Use a migrated key; rest pose = windup@0 = recover@1.
  const key = MIGRATED_POSE_KEYS[0];
  const rest = { ...computeWeaponPose(key, 'windup', 0) };
  const recEnd = { ...computeWeaponPose(key, 'recover', 1) };
  near(rest.x, recEnd.x, 'x rest');
  near(rest.y, recEnd.y, 'y rest');
  near(rest.z, recEnd.z, 'z rest');
  near(rest.rotX, recEnd.rotX, 'rotX rest');
  near(rest.rotZ, recEnd.rotZ, 'rotZ rest');
});

test('windup end hands off continuously to strike start (no snap)', () => {
  // The whole point of the standard envelope: windup@1 == strike@0.
  for (const key of MIGRATED_POSE_KEYS) {
    const windEnd = { ...computeWeaponPose(key, 'windup', 1) };
    const strikeStart = { ...computeWeaponPose(key, 'strike', 0) };
    near(windEnd.x, strikeStart.x, `${key} handoff x`);
    near(windEnd.z, strikeStart.z, `${key} handoff z`);
    near(windEnd.rotZ, strikeStart.rotZ, `${key} handoff rotZ`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
