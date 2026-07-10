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

// --- Dash-over: vault a shallow dashable obstacle, but only onto valid floor ---

test('canDashOver clears a DASHABLE obstacle when the landing is real floor', () => {
  // A knee-high fallen log at x=0 spanning ±0.24 in Z-crossing; dashable.
  const log: Obstacle = { kind: 'aabb', minX: -0.78, maxX: 0.78, minZ: -0.24, maxZ: 0.24, yTop: 0.5, dashable: true };
  const region = new WalkableRegion([ROOM], [log]);
  // Walk from z=-1 to z=+1 straight across the log: blocked as a walk...
  assert.equal(region.contains(0, 0, R), false, 'the log blocks a normal walk');
  // ...but a dash from the near side to clear floor beyond is allowed.
  assert.equal(region.canDashOver(0, -1, 0, 1, R), true, 'vault the log onto floor beyond');
});

test('canDashOver REFUSES when the landing itself is inside the obstacle (undershoot = no teleport-in)', () => {
  const log: Obstacle = { kind: 'aabb', minX: -0.78, maxX: 0.78, minZ: -0.24, maxZ: 0.24, yTop: 0.5, dashable: true };
  const region = new WalkableRegion([ROOM], [log]);
  // Target lands ON the log (z=0) — not valid floor, so no vault is armed.
  assert.equal(region.canDashOver(0, -1, 0, 0, R), false, 'never validate a dash that ends inside the obstacle');
});

test('canDashOver REFUSES to cross a NON-dashable obstacle (a chest still stops you)', () => {
  const chest: Obstacle = { kind: 'aabb', minX: -0.3, maxX: 0.3, minZ: -0.24, maxZ: 0.24, yTop: 0.7 };
  const region = new WalkableRegion([ROOM], [chest]);
  assert.equal(region.canDashOver(0, -1, 0, 1, R), false, 'a solid chest blocks the dash — not dashable');
});

test('canDashOver REFUSES to cross a WALL even if the landing is floor', () => {
  const wall = { ax: -1, az: 0, bx: 1, bz: 0 };
  const region = new WalkableRegion([ROOM], [], [wall]);
  assert.equal(region.canDashOver(0, -1, 0, 1, R), false, 'you cannot dash through stone');
});

test('resolveDashUndershoot completes the vault forward when stuck inside a dashable log', () => {
  const log: Obstacle = { kind: 'aabb', minX: -0.78, maxX: 0.78, minZ: -0.24, maxZ: 0.24, yTop: 0.5, dashable: true };
  const region = new WalkableRegion([ROOM], [log]);
  // Player died mid-vault at z=0 (inside the log), heading +Z.
  const land = region.resolveDashUndershoot(0, 0, 0, 1, R);
  assert.ok(land, 'a stuck-in-dashable player is resolved');
  assert.ok(land!.z > 0.24 + R - 1e-6, `pushed forward past the far edge (z=${land!.z})`);
  assert.equal(region.contains(land!.x, land!.z, R), true, 'landing is valid floor');
});

test('resolveDashUndershoot is a NO-OP on valid floor and when stuck on a non-dashable obstacle', () => {
  const chest: Obstacle = { kind: 'aabb', minX: -0.3, maxX: 0.3, minZ: -0.24, maxZ: 0.24, yTop: 0.7 };
  const region = new WalkableRegion([ROOM], [chest]);
  assert.equal(region.resolveDashUndershoot(3, 3, 0, 1, R), null, 'on clear floor: nothing to fix');
  assert.equal(region.resolveDashUndershoot(0, 0, 0, 1, R), null, 'stuck in a solid chest is NOT the dash-heal’s job');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
