// LIGHTING A ROOM BY ASKING ITS WALLS.
//
// The origin bug: `{ x: -3.95, z: -3.5, wall: 'W' }` sat in the starter chamber
// for months. The room became an apse, the west wall stopped existing at that Z,
// and the sconce hung in the void. A hand-measured coordinate plus a compass
// letter contains no claim that can be checked, so nothing could catch it.
//
// These are the claims that replace it.
//
//   npm test

import assert from 'node:assert/strict';
import { sconcesOn } from '../src/level/wall-sconces';
import { describeWalls } from '../src/level/wall-surfaces';
import { ARCHETYPES, generateRoomShape, pointInPoly, type Poly } from '../src/level/room-shape';
import { buildStarterChamber } from '../src/level/starter-chamber';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* shapes(): Generator<{ kind: string; poly: Poly }> {
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < 10; s++) {
      const rand = mulberry(s * 7919 + 13);
      yield { kind, poly: generateRoomShape(kind, { w: 8 + rand() * 8, d: 6 + rand() * 7, rand }) };
    }
  }
}

const LIGHT_EVERYTHING = [{ pick: () => true, spacing: [3, 5] as [number, number], height: 2 }];

test('NO SCONCE EVER HANGS IN THE VOID', () => {
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: 4 });
    for (const t of sconcesOn(walls, LIGHT_EVERYTHING)) {
      assert.ok(pointInPoly(poly, t.x, t.z), `${kind}: sconce at (${t.x}, ${t.z}) is outside the room`);
    }
  }
});

test('and every one has stone behind it', () => {
  // "In the room" isn't enough — a sconce floating in open floor is just as
  // wrong as one outside. Step BACKWARD along its own facing: that must leave.
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: 4 });
    for (const t of sconcesOn(walls, LIGHT_EVERYTHING)) {
      const fx = Math.sin(t.rotY!), fz = Math.cos(t.rotY!);
      assert.ok(!pointInPoly(poly, t.x - fx * 0.4, t.z - fz * 0.4),
        `${kind}: sconce at (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) has open floor behind it`);
    }
  }
});

test('THE BRACKET FACES INTO THE ROOM, AT AN EXACT ANGLE', () => {
  for (const { kind, poly } of shapes()) {
    const walls = describeWalls({ poly, height: 4 });
    for (const t of sconcesOn(walls, LIGHT_EVERYTHING)) {
      assert.ok(typeof t.rotY === 'number', `${kind}: sconce carries no exact facing`);
      assert.ok(pointInPoly(poly, t.x + Math.sin(t.rotY!) * 0.4, t.z + Math.cos(t.rotY!) * 0.4),
        `${kind}: sconce faces out of the room`);
    }
  }
});

test('a wall is claimed by exactly one plan', () => {
  // Plans are ordered and first-match-wins, so a wall matching two plans must
  // not be lit twice. Two overlapping palettes on one wall is a colour clash
  // nobody authored.
  // 14x10, so the long walls are 14m and the short ones 10m. The predicate has
  // to separate those two — `> 9` matches BOTH, which is how the first version
  // of this test failed: it asserted a split its own rule never made.
  const poly: Poly = [[-7, -5], [7, -5], [7, 5], [-7, 5]];
  const walls = describeWalls({ poly, height: 4 });
  const out = sconcesOn(walls, [
    { pick: (s) => s.length > 12, spacing: [4, 6], height: 2, tint: 0xff0000 },
    { pick: () => true, spacing: [4, 6], height: 2, tint: 0x0000ff },
  ]);
  for (const t of out) {
    const onLongWall = Math.abs(t.z) > 4.5;
    assert.equal(t.colorTint, onLongWall ? 0xff0000 : 0x0000ff,
      `sconce at (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) took the wrong plan's palette`);
  }
});

test('an unclaimed wall gets nothing', () => {
  const poly: Poly = [[-7, -5], [7, -5], [7, 5], [-7, 5]];
  assert.deepEqual(sconcesOn(describeWalls({ poly, height: 4 }), [{ pick: () => false, spacing: [3, 5], height: 2 }]), []);
});

test('THE STARTER CHAMBER LIGHTS ITS OWN APSE', () => {
  // The room this all came from, checked as content rather than as a unit: the
  // sanctuary must be lit cold, the entrance warm, and — the thing the compass
  // letter could never do — at least one sconce must sit on a DIAGONAL wall.
  const t = buildStarterChamber('depth-1', 7)!.torches!;
  assert.ok(t.length >= 6, `only ${t.length} sconces in the starter chamber`);
  const apse = t.filter((s) => s.z < -3);
  const entry = t.filter((s) => s.z > 3);
  assert.ok(apse.length >= 2, 'the sanctuary is unlit');
  assert.ok(entry.length >= 2, 'the entrance is unlit');
  assert.ok(apse.every((s) => s.colorTint === 0x88aaff), 'the sanctuary is not lit cold');
  assert.ok(entry.every((s) => s.colorTint === 0xffaa55), 'the entrance is not lit warm');
  const cardinal = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
  const diagonal = t.filter((s) => !cardinal.some((c) => Math.abs((s.rotY ?? 0) - c) < 1e-6));
  assert.ok(diagonal.length >= 2,
    `no sconce sits on a diagonal wall — the compass-letter path could have produced this`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
