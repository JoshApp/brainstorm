// A HOLE THAT ISN'T THERE LOOKS EXACTLY LIKE SOLID FLOOR.
//
// THREE's earcut silently DROPS a hole whose vertex touches (or, by float
// error, crosses) the outer contour — no throw, no warning, just a solid plate.
// So "I passed the holes in" proves nothing, and the only honest check is to
// shoot a ray down through where the hole should be and see nothing.
//
// The bug this was written for: buildPolyRoomShell never took holes at all, so
// on a polygon floor the stairwell shaft was built and then PAVED OVER. The way
// down was a solid slab you could stand on. Nothing errored.
//
//   npm test

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPolyRoomShell } from '../src/level/poly-room-shell';
import { generateRoomShape, pointInPoly, type Poly } from '../src/level/room-shape';
import { STAIRWELL_HALF_WIDTH, STAIRWELL_TOTAL_DEPTH } from '../src/interactables/stairs';
import type { StyleMaterials } from '../src/style/materials';
import type { RoomSpec } from '../src/level/types';
import type { WallSegment } from '../src/level/walkable';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function fixedRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mat = () => new THREE.MeshBasicMaterial({ vertexColors: true });
const materials = {
  floor: mat(), wall: mat(), ceiling: mat(), dressed: mat(), trim: mat(),
} as unknown as StyleMaterials;

/** Build a room and return the floor mesh. */
function buildFloor(
  poly: Poly, holes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): THREE.Mesh {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const rect = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
    w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs),
  };
  const room = { id: 'hole-test', rect, height: 3.4, poly } as RoomSpec & { poly: Poly };
  const root = new THREE.Object3D();
  const segs: WallSegment[] = [];
  buildPolyRoomShell(root, room, materials, segs, [], holes);
  root.updateMatrixWorld(true);
  const floor = root.getObjectByName('polyfloor:hole-test') as THREE.Mesh;
  assert.ok(floor, 'the shell built no floor at all');
  return floor;
}

/** Straight down from 5m up. True = there is floor here. */
function hitsFloor(floor: THREE.Mesh, x: number, z: number): boolean {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0), 0, 20);
  return ray.intersectObject(floor, true).length > 0;
}

/** World coords of a stairwell footprint, exactly as builder.ts derives it. */
function stairQuad(x: number, z: number, rotY: number): Array<[number, number]> {
  const halfW = STAIRWELL_HALF_WIDTH + 0.04, back = STAIRWELL_TOTAL_DEPTH + 0.04, front = -0.04;
  const ca = Math.cos(rotY), sa = Math.sin(rotY);
  return ([[-halfW, front], [halfW, front], [halfW, back], [-halfW, back]] as const)
    .map(([lx, lz]) => [x + ca * lx + sa * lz, z - sa * lx + ca * lz] as [number, number]);
}

const toShape = (
  q: ReadonlyArray<readonly [number, number]>, rx: number, rz: number,
): Array<[number, number]> => q.map(([x, z]) => [x - rx, -(z - rz)] as [number, number]);

test('A STAIRWELL LEAVES A REAL HOLE IN THE FLOOR', () => {
  const poly: Poly = [[-7, -6], [7, -6], [7, 6], [-7, 6]];
  const quad = stairQuad(0, 2.0, 0);
  const floor = buildFloor(poly, [toShape(quad, 0, 0)]);
  // Centre of the shaft: must be open sky.
  const cx = quad.reduce((t, c) => t + c[0], 0) / 4;
  const cz = quad.reduce((t, c) => t + c[1], 0) / 4;
  assert.equal(hitsFloor(floor, cx, cz), false, 'the stairwell was paved over');
  // And the rest of the room is still a floor — a "hole" that ate the plate is
  // the other way to pass a naive check.
  assert.equal(hitsFloor(floor, -5, -4), true, 'the floor vanished outside the hole');
  assert.equal(hitsFloor(floor, 5.5, 4.5), true, 'the floor vanished outside the hole');
});

test('a hole in a SHAPED room, on a diagonal', () => {
  // The case the bounding-box hole could not do: a stair facing a chamfer. Its
  // AABB is 3.19m square where the footprint is 1.95×2.56, so it straddled the
  // outline and got dropped — 12.5% of stairwells lost their shaft.
  const poly = generateRoomShape('apse', { w: 16, d: 14, rand: fixedRand(11) });
  const quad = stairQuad(0, 0, Math.PI / 4);
  assert.ok(quad.every(([x, z]) => pointInPoly(poly, x, z)), 'fixture is wrong: quad not inside');
  const b = { x: 0, z: 0 };
  const floor = buildFloor(poly, [toShape(quad, b.x, b.z)]);
  const cx = quad.reduce((t, c) => t + c[0], 0) / 4;
  const cz = quad.reduce((t, c) => t + c[1], 0) / 4;
  assert.equal(hitsFloor(floor, cx, cz), false, 'a rotated shaft was paved over');
});

test('AN OUT-OF-BOUNDS HOLE IS REFUSED, NOT GAMBLED ON', () => {
  // The control, and the reason the shell filters rather than trusting: a hole
  // crossing the contour makes earcut drop it AND can corrupt the plate. The
  // shell must reject it and still produce a complete floor.
  const poly: Poly = [[-7, -6], [7, -6], [7, 6], [-7, 6]];
  const outside: Array<[number, number]> = [[6, -1], [10, -1], [10, 1], [6, 1]];
  const floor = buildFloor(poly, [toShape(outside, 0, 0)]);
  assert.equal(hitsFloor(floor, 0, 0), true, 'a bad hole destroyed the floor');
  assert.equal(hitsFloor(floor, -6, -5), true, 'a bad hole destroyed the floor');
});

test('no holes still builds a solid floor', () => {
  const poly = generateRoomShape('cross', { w: 15, d: 13, rand: fixedRand(3) });
  const floor = buildFloor(poly, []);
  let hits = 0, tried = 0;
  for (let x = -6; x <= 6; x += 1.5) for (let z = -5; z <= 5; z += 1.5) {
    if (!pointInPoly(poly, x, z)) continue;
    tried++;
    if (hitsFloor(floor, x, z)) hits++;
  }
  assert.ok(tried > 10, 'fixture sampled nothing');
  assert.equal(hits, tried, `${tried - hits} of ${tried} interior points have no floor under them`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
