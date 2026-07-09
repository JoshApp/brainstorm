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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
