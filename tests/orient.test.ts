// The orient() helper: solves "I want this local axis to point in
// this world direction" without authoring Euler decimals. Tests verify
// the math actually produces a rotation that maps the requested local
// axis to the requested world direction.

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { orient, tilt, DIR } from '../src/anim/orient';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}: ${(e as Error).message}`);
  }
}

const Y = (e: [number, number, number]): THREE.Vector3 => {
  // Apply Euler XYZ to local +Y and return the resulting world direction.
  return new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
};
const Z = (e: [number, number, number]): THREE.Vector3 => {
  return new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
};

const closeTo = (got: number, want: number, eps = 1e-4): boolean => Math.abs(got - want) < eps;
const vecCloseTo = (got: THREE.Vector3, want: THREE.Vector3, eps = 1e-3): void => {
  assert(closeTo(got.x, want.x, eps), `x: got ${got.x}, want ${want.x}`);
  assert(closeTo(got.y, want.y, eps), `y: got ${got.y}, want ${want.y}`);
  assert(closeTo(got.z, want.z, eps), `z: got ${got.z}, want ${want.z}`);
};

// eslint-disable-next-line no-console
console.log('orient');

test('y → UP with default up: identity (Y already up)', () => {
  const e = orient({ yAxisTo: DIR.UP });
  vecCloseTo(Y(e), new THREE.Vector3(0, 1, 0));
});

test('y → FORWARD: Y maps to forward in world', () => {
  const e = orient({ yAxisTo: DIR.FORWARD });
  vecCloseTo(Y(e), new THREE.Vector3(0, 0, -1));
});

test('y → RIGHT: Y maps to +X', () => {
  const e = orient({ yAxisTo: DIR.RIGHT });
  vecCloseTo(Y(e), new THREE.Vector3(1, 0, 0));
});

test('y → DOWN: Y maps to -Y', () => {
  const e = orient({ yAxisTo: DIR.DOWN });
  vecCloseTo(Y(e), new THREE.Vector3(0, -1, 0));
});

test('y → FORWARD, upTo UP: Z back of object faces up', () => {
  // Local +Y forward, local +Z (back of object) maps to world UP.
  const e = orient({ yAxisTo: DIR.FORWARD, upTo: DIR.UP });
  vecCloseTo(Y(e), new THREE.Vector3(0, 0, -1));
  vecCloseTo(Z(e), new THREE.Vector3(0, 1, 0));
});

test('tilt blends two directions proportionally', () => {
  const d = tilt(DIR.UP, DIR.FORWARD, 0.2);
  // Should be mostly UP with slight forward (negative Z).
  assert(d[1] > 0.95, `Y dominant: got ${d[1]}`);
  assert(d[2] < -0.15 && d[2] > -0.25, `slight forward: got ${d[2]}`);
  assert(closeTo(d[0], 0), `no X: got ${d[0]}`);
  // Normalised.
  assert(closeTo(d[0] * d[0] + d[1] * d[1] + d[2] * d[2], 1), 'normalised');
});

test('tilt amount=0 is the principal direction', () => {
  const d = tilt(DIR.UP, DIR.FORWARD, 0);
  assert.deepEqual([d[0], d[1], d[2]], [0, 1, 0]);
});

test('orient handles non-perpendicular up reference', () => {
  // y along FORWARD, upRef partly aligned with y — should orthogonalise.
  const e = orient({
    yAxisTo: DIR.FORWARD,
    upTo: tilt(DIR.UP, DIR.FORWARD, 0.5),  // up + forward
  });
  vecCloseTo(Y(e), new THREE.Vector3(0, 0, -1));
  // Local +Z (after orient) should be perpendicular to local +Y,
  // pointing mostly up (the upRef minus its forward component).
  const z = Z(e);
  assert(z.y > 0.85, `+Z mostly up: got ${z.y}`);
  assert(closeTo(z.x, 0, 1e-3), `no X drift: got ${z.x}`);
});

test('orient degenerate: y parallel to up falls back gracefully', () => {
  // Both y and up = UP. The function should pick a fallback +Z and
  // return a valid rotation (not NaN).
  const e = orient({ yAxisTo: DIR.UP, upTo: DIR.UP });
  assert(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2]),
    'all components finite');
  vecCloseTo(Y(e), new THREE.Vector3(0, 1, 0));
});

// eslint-disable-next-line no-console
console.log(`orient: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
