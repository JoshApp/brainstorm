// Floor reproducibility: a given (depth, runSeed) must generate a byte-
// identical floor — including build-time rolls (corpse rotation, wall
// fixtures) now that they draw from the seeded build stream. Guards the
// "same seed → same run" property the Phase-4 replay foundation relies on.
//
//   npm test
//
// Imports procgen (which pulls THREE) — runs fine under tsx in Node.

import assert from 'node:assert/strict';
import { generateFloor } from '../src/level/procgen';

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

const gen = (depth: number, seed: number) => JSON.stringify(generateFloor(depth, seed));

test('same (depth, seed) generates an identical floor', () => {
  assert.equal(gen(5, 12345), gen(5, 12345));
});

test('different seed generates a different floor', () => {
  assert.notEqual(gen(5, 12345), gen(5, 99999));
});

test('different depth generates a different floor', () => {
  assert.notEqual(gen(3, 12345), gen(7, 12345));
});

test('build stream is isolated per floor (no cross-floor contamination)', () => {
  // Generating other floors in between must not change a floor's output —
  // proves seedBuildRng() resets the stream per floor rather than letting
  // draw position carry over.
  const first = gen(5, 12345);
  gen(2, 777);
  gen(9, 4242);
  const again = gen(5, 12345);
  assert.equal(first, again);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
