// Geometry tests for the unified wall-opening model (src/level/opening.ts).
// These guard the boss fog-gate placement fix: a gate must sit at the real
// entrance edge with its normal pointing INTO the arena (the way the player
// walks), for all four connection directions. Pure functions — runs under tsx.

import assert from 'node:assert/strict';
import { rotYForEdge, openingNormal, openingEndpoints, orientationEW, rotYForRun, type Edge } from '../src/level/opening';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// The way the player heads IN per connection direction; the gate normal must
// point this way (into the arena). Matches DIR_VEC in vault-compose.
const DIR_VEC: Record<Edge, { x: number; z: number }> = {
  N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 },
};

// ── Normal points along the placeDir for every edge ─────────────────────
for (const dir of ['N', 'S', 'E', 'W'] as Edge[]) {
  test(`fog-gate normal points into the arena (+${dir})`, () => {
    const n = openingNormal(rotYForEdge(dir));
    assert.ok(close(n.x, DIR_VEC[dir].x) && close(n.z, DIR_VEC[dir].z),
      `dir ${dir}: normal (${n.x.toFixed(2)},${n.z.toFixed(2)}) != (${DIR_VEC[dir].x},${DIR_VEC[dir].z})`);
  });
}

// ── Endpoints run perpendicular to the normal, span = width ──────────────
for (const dir of ['N', 'S', 'E', 'W'] as Edge[]) {
  test(`fog-gate seal spans perpendicular to travel (${dir})`, () => {
    const rotY = rotYForEdge(dir);
    const ep = openingEndpoints({ x: 5, z: -3, rotY, widthM: 3 });
    // Segment vector
    const sx = ep.bx - ep.ax, sz = ep.bz - ep.az;
    const len = Math.hypot(sx, sz);
    assert.ok(close(len, 3), `span ${len} != 3`);
    // Perpendicular to the normal: dot == 0
    const n = openingNormal(rotY);
    assert.ok(close(sx * n.x + sz * n.z, 0), `seg not perpendicular to normal`);
    // Centre preserved
    assert.ok(close((ep.ax + ep.bx) / 2, 5) && close((ep.az + ep.bz) / 2, -3), 'centre moved');
  });
}

// ── Tile-run orientation rule ────────────────────────────────────────────
test('orientationEW: floor N&S ⇒ EW run (rotY 0)', () => {
  assert.equal(orientationEW(true, true), true);
  assert.equal(rotYForRun(true), 0);
});
test('orientationEW: not both ⇒ NS run (rotY π/2)', () => {
  assert.equal(orientationEW(true, false), false);
  assert.equal(orientationEW(false, true), false);
  assert.equal(rotYForRun(false), Math.PI / 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
