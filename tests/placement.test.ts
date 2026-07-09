// Geometry-aware placement — chests face the entrance, wall-anchored ones keep
// their facing, and the start room (no descent dir) is left alone.
//
//   npm test

import assert from 'node:assert/strict';
import { faceEntranceRotY, roomFor, resolvePlacement, type RoomBox } from '../src/level/placement';
import type { PropSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const room: RoomBox = { cx: 0, cz: 0, w: 8, d: 8, placeDir: 'S' };

test('faceEntranceRotY faces the entrance (−placeDir), distinct per dir', () => {
  const s = faceEntranceRotY('S'), n = faceEntranceRotY('N'), e = faceEntranceRotY('E'), w = faceEntranceRotY('W');
  assert.ok(s !== null && n !== null && e !== null && w !== null);
  // S faces +Z entrance-side; N the opposite — they must differ by π.
  assert.ok(Math.abs(((s! - n!) % (2 * Math.PI)) - Math.PI) < 1e-9 || Math.abs(((n! - s!) % (2 * Math.PI)) - Math.PI) < 1e-9);
  assert.equal(faceEntranceRotY(undefined), null);
});

test('roomFor finds the containing room', () => {
  assert.ok(roomFor(0, 0, [room]));
  assert.ok(roomFor(3, -3, [room]));
  assert.equal(roomFor(100, 100, [room]), null);
});

test('a CENTRAL chest turns to face the entrance (clears its wall-facing)', () => {
  const props: PropSpec[] = [{ kind: 'chest', x: 0, z: 0, rotY: 0.5, facing: { kind: 'wall-away' } } as PropSpec];
  resolvePlacement(props, [room]);
  const c = props[0] as { rotY: number; facing?: unknown };
  assert.equal(c.rotY, faceEntranceRotY('S'));
  assert.equal(c.facing, undefined);
});

test('a WALL-ANCHORED chest keeps its authored facing', () => {
  // x = 3.5 is 0.5m from the +X wall (x=4) — wall-anchored.
  const props: PropSpec[] = [{ kind: 'chest', x: 3.5, z: 0, rotY: 0.5, facing: { kind: 'wall-away' } } as PropSpec];
  resolvePlacement(props, [room]);
  assert.equal((props[0] as { rotY: number }).rotY, 0.5);
});

test('the start room (no placeDir) leaves chests untouched', () => {
  const start: RoomBox = { cx: 0, cz: 0, w: 8, d: 8 };
  const props: PropSpec[] = [{ kind: 'chest', x: 0, z: 0, rotY: 0.5 } as PropSpec];
  resolvePlacement(props, [start]);
  assert.equal((props[0] as { rotY: number }).rotY, 0.5);
});

test('the facing CONE — an off-centre chest angles toward the entrance point', () => {
  // Dead-centre chest points straight at the entrance (cardinal).
  const center: PropSpec[] = [{ kind: 'chest', x: 0, z: 0, rotY: 0 } as PropSpec];
  resolvePlacement(center, [room]);
  assert.ok(Math.abs((center[0] as { rotY: number }).rotY - faceEntranceRotY('S')!) < 1e-9, 'centre → straight in');
  // A chest off to the side turns toward WHERE you enter, not the cardinal dir.
  const east: PropSpec[] = [{ kind: 'chest', x: 2, z: 0, rotY: 0 } as PropSpec];
  resolvePlacement(east, [room]);
  assert.ok(Math.abs((east[0] as { rotY: number }).rotY - faceEntranceRotY('S')!) > 0.1, 'off-side → angled');
});

test('a slumped corpse seats its −X back against the nearest wall', () => {
  // Corpse near the EAST wall (x≈+4): back (−X) should point +X (rotY = π).
  const east: PropSpec[] = [{ kind: 'corpse', x: 3.5, z: 0, rotY: 0, pose: 'slumped' } as PropSpec];
  resolvePlacement(east, [room]);
  assert.ok(Math.abs((east[0] as { rotY: number }).rotY - Math.PI) < 1e-9, 'east wall → rotY π');
  // Corpse near the SOUTH wall (z≈+4): back should point +Z (rotY = π/2).
  const south: PropSpec[] = [{ kind: 'corpse', x: 0, z: 3.5, rotY: 0, pose: 'slumped' } as PropSpec];
  resolvePlacement(south, [room]);
  assert.ok(Math.abs((south[0] as { rotY: number }).rotY - Math.PI / 2) < 1e-9, 'south wall → rotY π/2');
});

test('a non-slumped corpse is left alone (floor poses need no wall)', () => {
  const props: PropSpec[] = [{ kind: 'corpse', x: 3.5, z: 0, rotY: 0.5, pose: 'crawled' } as PropSpec];
  resolvePlacement(props, [room]);
  assert.equal((props[0] as { rotY: number }).rotY, 0.5);
});

test('a near-centre pillar snaps to the true room centre', () => {
  const near: PropSpec[] = [{ kind: 'pillar', x: 0.4, z: -0.3 } as PropSpec];
  resolvePlacement(near, [room]);
  assert.equal((near[0] as { x: number; z: number }).x, 0);
  assert.equal((near[0] as { x: number; z: number }).z, 0);
  // A clearly off-centre pillar is NOT moved (it's meant to be there).
  const off: PropSpec[] = [{ kind: 'pillar', x: 3, z: 0 } as PropSpec];
  resolvePlacement(off, [room]);
  assert.equal((off[0] as { x: number }).x, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
