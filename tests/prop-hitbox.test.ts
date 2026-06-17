// Prop collision is a real 3D volume: a footprint extruded floor→yTop
// (src/level/walkable.ts Obstacle + containsProjectile).
//
// Guards two fixes for "props eat shots they shouldn't":
//   1. A pillar's collision matches its VISIBLE shaft (a circle), not a
//      circumscribed square — a headshot grazing past the column clears
//      instead of dying on the invisible corner margin.
//   2. `yTop` is required: full-height blockers say Infinity DELIBERATELY,
//      so a prop can't silently become a floor-to-ceiling wall by omission.
//      A shot above a finite-top prop sails over; through a full-height one
//      it blocks.

import assert from 'node:assert/strict';
import { WalkableRegion, type Obstacle } from '../src/level/walkable';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}

const ROOM = [{ id: 'r', x: 0, z: 0, w: 12, d: 12 }];
const R = 0.1;        // projectile radius
const HEAD_Y = 1.5;   // headshot height
// A pillar as buildAltarPillar now emits it: a circle matching the shaft
// (radius size*0.42), full-height. size 0.5 → r 0.21.
const PILLAR: Obstacle = { kind: 'circle', x: 0, z: 0, r: 0.21, yTop: Infinity };

test('headshot grazing PAST the pillar shaft clears', () => {
  const region = new WalkableRegion(ROOM, [PILLAR], []);
  // (0.24, 0.24): dist 0.339 from centre — outside shaft+R (0.31), but INSIDE
  // the old size-0.5 square footprint (half 0.25) that used to eat it.
  assert.equal(region.containsProjectile(0.24, 0.24, R, HEAD_Y), true,
    'a shot grazing past the visible column must pass');
});

test('shot THROUGH the full-height column still blocks', () => {
  const region = new WalkableRegion(ROOM, [PILLAR], []);
  assert.equal(region.containsProjectile(0.1, 0, R, HEAD_Y), false,
    'a shot aimed through the column must be blocked');
  // ...at any height — Infinity yTop never clears.
  assert.equal(region.containsProjectile(0.1, 0, R, 99), false,
    'full-height blocker blocks even a sky-high shot');
});

test('shot ABOVE a finite-top low prop sails over', () => {
  const lowProp: Obstacle = { kind: 'circle', x: 4, z: 0, r: 0.4, yTop: 0.7 };
  const region = new WalkableRegion(ROOM, [lowProp], []);
  assert.equal(region.containsProjectile(4, 0, R, HEAD_Y), true,
    '1.5m shot clears a 0.7m-tall prop');
  assert.equal(region.containsProjectile(4, 0, R, 0.5), false,
    'a low shot still hits the prop body');
});

test('aabb prop respects yTop the same way', () => {
  const box: Obstacle = { kind: 'aabb', minX: 3.6, maxX: 4.4, minZ: -0.4, maxZ: 0.4, yTop: 0.9 };
  const region = new WalkableRegion(ROOM, [box], []);
  assert.equal(region.containsProjectile(4, 0, R, HEAD_Y), true, 'clears the waist-high box');
  assert.equal(region.containsProjectile(4, 0, R, 0.4), false, 'low shot hits the box');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
