// WalkableRegion obstacle lifecycle — the regression guard for the
// destroyed-vase INVISIBLE BLOCKER bug. Collision reads the spatial HASH, not
// the raw array, so removing an obstacle MUST clear it from queries. The vase /
// vase-cluster / mimic destroy paths used to splice the array only, leaving the
// collider live in the grid; they now route through removeObstacle (below).
//
//   npm test

import assert from 'node:assert/strict';
import { WalkableRegion, type Obstacle } from '../src/level/walkable';
import type { WalkableRect } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const ROOM: WalkableRect = { x: 0, z: 0, w: 10, d: 10 };
const R = 0.3;   // an agent radius

test('a circle obstacle (vase) blocks, and removeObstacle CLEARS it from collision', () => {
  const vase: Obstacle = { kind: 'circle', x: 0, z: 0, r: 0.18, yTop: 0.6 };
  const region = new WalkableRegion([ROOM], [vase]);
  assert.equal(region.contains(0, 0, R), false, 'the vase should block its cell');
  region.removeObstacle(vase);
  assert.equal(region.contains(0, 0, R), true, 'after removal the cell must be walkable — the bug was it stayed blocked');
});

test('an AABB obstacle (chest/mimic) blocks, and removeObstacle clears it', () => {
  const chest: Obstacle = { kind: 'aabb', minX: -0.28, maxX: 0.28, minZ: -0.23, maxZ: 0.23, yTop: 0.7 };
  const region = new WalkableRegion([ROOM], [chest]);
  assert.equal(region.contains(0, 0, R), false);
  region.removeObstacle(chest);
  assert.equal(region.contains(0, 0, R), true);
});

test('removing ONE obstacle leaves the others blocking (identity-based)', () => {
  const a: Obstacle = { kind: 'circle', x: -2, z: 0, r: 0.18, yTop: 0.6 };
  const b: Obstacle = { kind: 'circle', x: 2, z: 0, r: 0.18, yTop: 0.6 };
  const region = new WalkableRegion([ROOM], [a, b]);
  region.removeObstacle(a);
  assert.equal(region.contains(-2, 0, R), true, 'removed one is clear');
  assert.equal(region.contains(2, 0, R), false, 'the other still blocks');
});

test('removeObstacle bumps version so the nav grid rebuilds (mobs stop pathing around the ghost)', () => {
  const vase: Obstacle = { kind: 'circle', x: 0, z: 0, r: 0.18, yTop: 0.6 };
  const region = new WalkableRegion([ROOM], [vase]);
  const before = region.version;
  region.removeObstacle(vase);
  assert.ok(region.version > before, 'version must advance so NavGrid invalidates');
});

test('addObstacle then removeObstacle round-trips cleanly', () => {
  const region = new WalkableRegion([ROOM], []);
  assert.equal(region.contains(0, 0, R), true);
  const o: Obstacle = { kind: 'circle', x: 0, z: 0, r: 0.18, yTop: 0.6 };
  region.addObstacle(o);
  assert.equal(region.contains(0, 0, R), false, 'added obstacle blocks');
  region.removeObstacle(o);
  assert.equal(region.contains(0, 0, R), true, 'removed again is clear');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
