// LIGHT AS SIGNAL, NOT AS ILLUMINATION.
//
// The dungeon's baseline is darkness and the player's lamp is the baseline
// everywhere (CLAUDE.md). So every light the ROOM provides is a claim that
// something is there. Spend that on decoration and you have spent the only
// vocabulary the game had for "something is happening here".
//
// That makes the interesting assertions the NEGATIVE ones. A lighting pass that
// lights everything satisfies "the trove is lit" trivially; it fails the design.
// So most of what follows checks that light was WITHHELD: from an ambush, from
// a room with nothing in it, from anything that would outshine the focus.
//
//   npm test

import assert from 'node:assert/strict';
import { planRoomLight, lightPlanViolation, type Mount, type LightSubject } from '../src/level/light-plan';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Brackets around a 16×12 room. */
function ring(): Mount[] {
  const out: Mount[] = [];
  for (let x = -6; x <= 6; x += 3) {
    out.push({ x, z: -5.6, height: 2.0, wall: 'N' });
    out.push({ x, z: 5.6, height: 2.0, wall: 'S' });
  }
  for (let z = -3; z <= 3; z += 3) {
    out.push({ x: -7.6, z, height: 2.0, wall: 'W' });
    out.push({ x: 7.6, z, height: 2.0, wall: 'E' });
  }
  return out;
}

const base = (over: Partial<LightSubject> = {}): LightSubject =>
  ({ mounts: ring(), area: 160, height: 4.2, ...over });

test('A TROVE GETS A SHAFT, AND IT IS THE BRIGHTEST THING IN THE ROOM', () => {
  const f = planRoomLight(base({ focus: { x: 0, z: 0, kind: 'offerings' } }));
  const focal = f.filter((x) => x.role === 'focal');
  assert.equal(focal.length, 1, `expected exactly one focal, got ${focal.length}`);
  assert.equal(focal[0].shape, 'shaft', `a trove got a ${focal[0].shape}`);
  assert.equal(lightPlanViolation(f), null);
  for (const other of f.filter((x) => x.role !== 'focal')) {
    assert.ok(other.intensity < focal[0].intensity,
      `a ${other.role} at ${other.intensity} matches the focal at ${focal[0].intensity}`);
  }
});

test('a LOW room gets a pool instead — a shaft needs headroom', () => {
  // Degrading is the point: the alternative is a god ray through a 2.8m ceiling,
  // which reads as a lamp on a stick and cheapens every real one.
  const f = planRoomLight(base({ focus: { x: 0, z: 0, kind: 'offerings' }, height: 2.8 }));
  const focal = f.find((x) => x.role === 'focal');
  assert.ok(focal, 'a low trove got no focal at all');
  assert.equal(focal!.shape, 'pool', `a 2.8m room grew a ${focal!.shape}`);
});

test('A ROOM WITH NOTHING IN IT GETS NO FOCAL LIGHT', () => {
  // The rule that keeps the vocabulary meaningful. If an empty room is lit the
  // same as a trove, then light means nothing anywhere.
  const f = planRoomLight(base());
  assert.equal(f.filter((x) => x.role === 'focal').length, 0,
    'an empty room was given something to look at');
  assert.ok(f.every((x) => x.role === 'wash'), 'an empty room got more than a wash');
});

test('AN AMBUSH IS NEVER LIT', () => {
  // The rule that makes this a system rather than a mood. Without it, "put light
  // where it is interesting" quietly illuminates the thing that is hiding.
  const spot = { x: 4, z: 3, r: 3.2 };
  const f = planRoomLight(base({
    focus: { x: 4.5, z: 3.2, kind: 'hazard' },   // deliberately INSIDE the shadow
    shadow: [spot],
  }));
  for (const fx of f) {
    assert.ok(Math.hypot(fx.x - spot.x, fx.z - spot.z) >= spot.r,
      `a ${fx.role} ${fx.shape} landed on the ambush at (${fx.x.toFixed(1)}, ${fx.z.toFixed(1)})`);
  }
});

test('THE WAY DOWN IS ALWAYS MARKED', () => {
  // Hunting for the stair in the dark on a phone is a chore, not tension. And
  // note it survives alongside a focal — "the thing here" and "the way out" are
  // two facts and the player needs both.
  for (const focus of [undefined, { x: 0, z: 0, kind: 'offerings' as const }]) {
    const f = planRoomLight(base({ focus, descent: { x: 6, z: 4 } }));
    const near = f.filter((x) => Math.hypot(x.x - 6, x.z - 4) < 5);
    assert.ok(near.length > 0, `the stair went unlit (focus: ${focus ? 'yes' : 'no'})`);
  }
});

test('NOBODY GETS NOTHING', () => {
  // Two real rooms come out black otherwise: a `dark` room whose only bracket
  // falls in an ambush's shadow, and a cavern with 28 short edges and no wall
  // run long enough to hang anything on. Zero light is not a dark room — it is
  // indistinguishable from the end of the world.
  const noWalls = planRoomLight(base({ mounts: [], fallback: { x: 0, z: -4 } }));
  assert.equal(noWalls.length, 1, 'a room with no brackets got no light and no fallback');
  assert.equal(noWalls[0].shape, 'brazier', 'the fallback should stand on the floor');

  const shadowed = planRoomLight(base({
    mounts: [{ x: 0, z: 5.6, height: 2, wall: 'S' }],
    shadow: [{ x: 0, z: 5.6, r: 3.2 }],
    fallback: { x: 0, z: -4 },
  }));
  assert.ok(shadowed.length > 0, 'shadow vetoed the only light and nothing replaced it');
});

test('and the fallback only fires when it is needed', () => {
  // The control. A fallback that always fires would satisfy the test above while
  // putting a brazier in every room in the game.
  const f = planRoomLight(base({ fallback: { x: 0, z: 0 } }));
  assert.equal(f.filter((x) => x.shape === 'brazier').length, 0,
    'a room that had brackets got a brazier anyway');
});

test('a focal room gets LESS wash, not the same plus a highlight', () => {
  const empty = planRoomLight(base());
  const staged = planRoomLight(base({ focus: { x: 0, z: 0, kind: 'offerings' } }));
  const wash = (a: ReturnType<typeof planRoomLight>) => a.filter((x) => x.role === 'wash').length;
  assert.ok(wash(staged) < wash(empty),
    `focal room has ${wash(staged)} wash lights vs ${wash(empty)} in an empty one — the highlight is just another lamp`);
});

test('a fire lights itself', () => {
  // A bonfire IS the light. Anything added competes with the one mercy the
  // dungeon offers.
  const f = planRoomLight(base({ focus: { x: 0, z: 0, kind: 'fire' } }));
  assert.equal(f.filter((x) => x.role === 'focal').length, 0,
    'we lit a bonfire');
});

test('the violation checker actually catches a violation', () => {
  // A validator that never fires is indistinguishable from no validator.
  assert.equal(lightPlanViolation([
    { role: 'focal', shape: 'pool', x: 0, z: 0, height: 0, intensity: 0.5, color: 0 },
    { role: 'wash', shape: 'sconce', x: 3, z: 0, height: 2, intensity: 0.9, color: 0 },
  ]), 'a wash outshines the focal');
  assert.ok(lightPlanViolation([
    { role: 'focal', shape: 'pool', x: 0, z: 0, height: 0, intensity: 0.8, color: 0 },
    { role: 'focal', shape: 'pool', x: 4, z: 0, height: 0, intensity: 0.8, color: 0 },
  ])?.includes('2 focal'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
