// PROP FACING IN A POLYGON ROOM.
//
// `wall-away` used to mean "one of four compass directions from the containing
// RECT". That is exactly right for a rectangle and silently wrong the moment a
// wall is chamfered or diagonal: a chest with its back to a 45° wall came out
// 45° off, which reads as somebody placing it badly rather than as the model
// being unable to express the wall.
//
// The failure mode matters more than the angle. Nothing crashes, nothing looks
// broken in a screenshot of a dark room, and the fix is a number somebody would
// otherwise nudge by hand forever. So: assert the RELATION (does the front face
// the room?) rather than the number.
//
//   npm test

import assert from 'node:assert/strict';
import { resolveAllFacings } from '../src/level/facing';
import { describeWalls, nearestSurface } from '../src/level/wall-surfaces';
import { pointInPoly, type Poly } from '../src/level/room-shape';
import type { LevelSpec, PropSpec } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** An octagon — every diagonal face is one a compass letter cannot name. */
const OCTAGON: Poly = [
  [-2, -5], [2, -5], [5, -2], [5, 2], [2, 5], [-2, 5], [-5, 2], [-5, -2],
];

function specWith(poly: Poly | undefined, props: PropSpec[]): LevelSpec {
  return {
    id: 't', depth: 1,
    startPos: { x: 0, z: 0, yaw: 0 },
    rooms: [{ id: 'r', rect: { x: 0, z: 0, w: 10, d: 10 }, height: 4, ...(poly ? { poly } : {}) }],
    corridors: [],
    props,
    torches: [], spawns: [], doors: [], stairs: [],
  } as unknown as LevelSpec;
}

/** A prop pushed `d` metres in from the midpoint of one octagon face. */
function besideFace(i: number, d = 0.5) {
  const walls = describeWalls({ poly: OCTAGON, height: 4 });
  const s = walls[i];
  return {
    x: s.mid[0] + s.inward[0] * d,
    z: s.mid[1] + s.inward[1] * d,
    surface: s,
  };
}

test('WALL-AWAY PUTS THE BACK ON THE STONE, ON EVERY FACE', () => {
  const walls = describeWalls({ poly: OCTAGON, height: 4 });
  for (let i = 0; i < walls.length; i++) {
    const at = besideFace(i);
    const prop = { kind: 'model', x: at.x, z: at.z, facing: { kind: 'wall-away' } } as unknown as PropSpec;
    resolveAllFacings(specWith(OCTAGON, [prop]));
    const rotY = (prop as unknown as { rotY: number }).rotY;
    // A prop's front is local +Z, which rotY sends to (sin, cos).
    const fx = Math.sin(rotY), fz = Math.cos(rotY);
    const s = at.surface;
    assert.ok(fx * s.inward[0] + fz * s.inward[1] > 0.99,
      `face ${i}: front points away from the room (rotY ${rotY.toFixed(2)}, wall inward ` +
      `${s.inward[0].toFixed(2)},${s.inward[1].toFixed(2)})`);
    // And a step BEHIND the prop must leave the room — that's what "against the
    // wall" means, as opposed to "somewhere in the room facing that way".
    assert.ok(!pointInPoly(OCTAGON, at.x - fx * 0.9, at.z - fz * 0.9),
      `face ${i}: there is open floor behind the prop`);
  }
});

test('wall-toward is exactly the opposite, on every face', () => {
  const walls = describeWalls({ poly: OCTAGON, height: 4 });
  for (let i = 0; i < walls.length; i++) {
    const at = besideFace(i);
    const away = { kind: 'model', x: at.x, z: at.z, facing: { kind: 'wall-away' } } as unknown as PropSpec;
    const toward = { kind: 'model', x: at.x, z: at.z, facing: { kind: 'wall-toward' } } as unknown as PropSpec;
    resolveAllFacings(specWith(OCTAGON, [away, toward]));
    const a = (away as unknown as { rotY: number }).rotY;
    const t = (toward as unknown as { rotY: number }).rotY;
    const d = Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t)));
    assert.ok(Math.abs(d - Math.PI) < 1e-6,
      `face ${i}: toward and away differ by ${d.toFixed(3)} rad, expected π`);
  }
});

test('A DIAGONAL WALL GETS A DIAGONAL ANGLE', () => {
  // The whole point. The rect resolver can only ever return 0, ±π/2 or π, so an
  // octagon's slanted faces prove the polygon path is the one running.
  const angles = new Set<number>();
  const walls = describeWalls({ poly: OCTAGON, height: 4 });
  for (let i = 0; i < walls.length; i++) {
    const at = besideFace(i);
    const prop = { kind: 'model', x: at.x, z: at.z, facing: { kind: 'wall-away' } } as unknown as PropSpec;
    resolveAllFacings(specWith(OCTAGON, [prop]));
    angles.add(Math.round((prop as unknown as { rotY: number }).rotY * 1000) / 1000);
  }
  const cardinal = [0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI]
    .map((a) => Math.round(a * 1000) / 1000);
  const offAxis = [...angles].filter((a) => !cardinal.includes(a));
  assert.ok(offAxis.length >= 4,
    `only ${offAxis.length} off-axis facings — the rect path is still resolving these`);
});

test('a rect room resolves exactly as it always did', () => {
  // The polygon path must be ADDITIVE. Every existing floor is rects, and a
  // regression here would silently spin every chest, corpse and bookshelf in
  // the game.
  const cases: Array<[number, number, number]> = [
    [0, -4.5, 0],              // near north wall  → front south
    [0, 4.5, Math.PI],         // near south wall  → front north
    [-4.5, 0, Math.PI / 2],    // near west wall   → front east
    [4.5, 0, -Math.PI / 2],    // near east wall   → front west
  ];
  for (const [x, z, want] of cases) {
    const prop = { kind: 'model', x, z, facing: { kind: 'wall-away' } } as unknown as PropSpec;
    resolveAllFacings(specWith(undefined, [prop]));
    assert.equal((prop as unknown as { rotY: number }).rotY, want,
      `rect room at (${x}, ${z}) resolved to ${(prop as unknown as { rotY: number }).rotY}, wanted ${want}`);
  }
});

test('the nearest face is the nearest face', () => {
  // nearestSurface underpins the whole thing; if it picks the wrong wall the
  // prop faces confidently in the wrong direction.
  const walls = describeWalls({ poly: OCTAGON, height: 4 });
  for (let i = 0; i < walls.length; i++) {
    const at = besideFace(i, 0.3);
    const got = nearestSurface(walls, at.x, at.z);
    assert.equal(got?.edge, walls[i].edge,
      `a point 0.3m off face ${i} resolved to face ${got?.edge}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
