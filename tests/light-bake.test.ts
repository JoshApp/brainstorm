// The torch bake (scene/light-bake.ts): walls stop light, open doors don't,
// and two lights that can light the same spot never share a channel.
//
//   npm test -- light-bake

import assert from 'node:assert/strict';
import { bakeLightVisibility, distanceAttenuation, type BakeWall } from '../src/scene/light-bake';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n  ${(e as Error).message}`); }
}

// A 12 × 6 box split at x = 0 by a wall with a 1 m gap at z ∈ [2, 3].
const box: BakeWall[] = [
  { ax: -6, az: -3, bx: 6, bz: -3 }, { ax: 6, az: -3, bx: 6, bz: 3 },
  { ax: 6, az: 3, bx: -6, bz: 3 }, { ax: -6, az: 3, bx: -6, bz: -3 },
];
const splitWithGap: BakeWall[] = [...box, { ax: 0, az: -3, bx: 0, bz: 2 }];
const torch = (id: string, x: number, z: number) => ({ id, x, z, range: 11, intensity: 48, decay: 2 });

function visAt(b: ReturnType<typeof bakeLightVisibility>, x: number, z: number, c: number): number {
  const tx = Math.floor((x - b.originX) / b.cell), tz = Math.floor((z - b.originZ) / b.cell);
  return b.vis[(tz * b.w + tx) * 4 + c];
}

test('attenuation matches three (1/d^decay, smooth window to 0 at the cutoff)', () => {
  assert.equal(distanceAttenuation(1, 11, 2), Math.pow(1 - 1 / 14641, 2));
  assert.equal(distanceAttenuation(11, 11, 2), 0);
  assert.ok(distanceAttenuation(2, 11, 2) > distanceAttenuation(4, 11, 2));
});

test('a wall stops the light; the open side is lit', () => {
  const b = bakeLightVisibility([torch('a', -3, -1)], splitWithGap);
  const c = b.channelOf.get('a')!;
  assert.equal(visAt(b, -2, -1, c), 255, 'same side, in reach');
  assert.equal(visAt(b, 3, -2, c), 0, 'behind the wall');
});

test('light passes through the gap', () => {
  const b = bakeLightVisibility([torch('a', -1, 2.5)], splitWithGap);
  const c = b.channelOf.get('a')!;
  assert.ok(visAt(b, 1.5, 2.5, c) > 0, 'straight through the doorway');
});

test('an openable wall (a door) does not stop the light', () => {
  const door: BakeWall = { ax: 0, az: -3, bx: 0, bz: 3, openable: true };
  const b = bakeLightVisibility([torch('a', -3, 0)], [...box, door]);
  assert.equal(visAt(b, 3, 0, b.channelOf.get('a')!), 255);
});

test('lights that see a common spot get different channels; walled-apart lights may share', () => {
  const solid: BakeWall[] = [...box, { ax: 0, az: -3, bx: 0, bz: 3 }];
  const together = bakeLightVisibility([torch('a', -4, 0), torch('b', -2, 0)], solid);
  assert.notEqual(together.channelOf.get('a'), together.channelOf.get('b'));
  const apart = bakeLightVisibility([torch('a', -3, 0), torch('b', 3, 0)], solid);
  assert.equal(apart.channelOf.get('a'), apart.channelOf.get('b'), 'nothing sees both: one channel');
});

test('more overlapping lights than channels: the extras stay live, none is dropped', () => {
  const lights = [0, 1, 2, 3, 4, 5].map((i) => torch(`t${i}`, -5 + i * 2, 0));
  const b = bakeLightVisibility(lights, box, { channels: 4 });
  assert.equal(b.slotOf.size + b.live.length, lights.length);
  assert.equal(b.slotOf.size, 4);
});

test('every texel: a channel lit by a light carries that light\'s slot', () => {
  const lights = [torch('a', -4, -1), torch('b', 4, 1), torch('c', -1, 2.5)];
  const b = bakeLightVisibility(lights, splitWithGap);
  for (let t = 0; t < b.w * b.h; t++) {
    for (let c = 0; c < 4; c++) {
      if (b.vis[t * 4 + c] > 0) assert.notEqual(b.ids[t * 4 + c], 0, `texel ${t} ch ${c}: lit but no owner`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
