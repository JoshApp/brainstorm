// ── THE WALL FACE, FLAT AND NOT ─────────────────────────────────────────────
//
// level/wall-courses.ts builds every polygon room's wall. It had no test, which
// is how it kept displacing courses through a strip that was specifically trying
// to stop the walls doing anything — three separate systems were each giving a
// wall relief (profile bands, shell trim, and this) and only the two with a name
// anybody remembered got switched off.
//
// What is pinned here is the SHAPE of the output, in the one term that matters:
// how far the face departs from its own plane. That is the whole disagreement
// between a clean wall and a coursed one, it is a single number, and it does not
// care how the geometry is tessellated.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCoursedWall } from '../src/level/wall-courses';
import { DRESSING } from '../src/level/dressing';

/** A deterministic stand-in for the floor's seeded stream. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Peak-to-peak departure from the wall plane, in metres. */
function depthRange(geo: { attributes: { position: { count: number; getZ(i: number): number } } }): number {
  const p = geo.attributes.position;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return hi - lo;
}

const build = (wear: number) =>
  makeCoursedWall(6, 3.4, { wear, rand: rng(12345), baseY: 0 });

test('with coursing ON the face has real depth in it', () => {
  // The control. Without this, "the clean wall is flat" would pass just as well
  // against a builder that had quietly stopped emitting anything at all.
  DRESSING['shell-coursing'].on = true;
  const g = build(0.6);
  const d = depthRange(g);
  assert.ok(d > 0.04, `coursed wall is only ${d.toFixed(3)}m deep — nothing is displacing`);
  assert.ok(g.attributes.position.count > 0, 'coursed wall built no geometry');
});

test('with coursing OFF the face is FLAT', () => {
  DRESSING['shell-coursing'].on = false;
  const g = build(0.6);
  const d = depthRange(g);
  // Not "small" — zero. The wall face, the course steps and the proud blocks all
  // sit on one plane, and the masonry shader supplies every bit of relief.
  assert.ok(d < 1e-6, `clean wall still departs ${d.toFixed(4)}m from its plane`);
});

test('a clean wall is CHEAPER than a coursed one, not merely different', () => {
  // The steps and the proud blocks stop being emitted rather than collapsing to
  // zero-area quads. A degenerate triangle is not free: it is still rasterised,
  // and computeVertexNormals still averages a garbage normal out of it.
  DRESSING['shell-coursing'].on = true;
  const coursed = build(0.6).attributes.position.count;
  DRESSING['shell-coursing'].on = false;
  const clean = build(0.6).attributes.position.count;
  assert.ok(clean < coursed,
    `clean wall has ${clean} verts against coursed ${coursed} — degenerates are being kept`);
});

test('the builder is deterministic and draws ONLY from the rand it is given', () => {
  // THIS ASSERTION REPLACED A WRONG ONE, and the wrong one is worth recording.
  //
  // It asserted that both paths consume the SAME NUMBER of randoms, on the
  // reasoning that a wall-shading switch must not shift a seeded stream and
  // reroll the floor. It failed, correctly — a flat wall has fewer vertices and
  // the per-vertex grime pass draws once per vertex — and the fix looked like
  // making the builder spend randoms it had no use for.
  //
  // The premise was false. poly-room-shell passes `wearStream(room.id)`: a
  // stream seeded from the room's own id, used for nothing but wall wear, and
  // entirely separate from the floor's build RNG. A shift there cannot reach
  // layout, spawns or loot; it changes one room's grime.
  //
  // What actually protects determinism is that this function has NO hidden
  // source of randomness — same injected stream in, same geometry out. That is
  // what is pinned now, in both modes.
  for (const on of [true, false]) {
    DRESSING['shell-coursing'].on = on;
    const a = makeCoursedWall(6, 3.4, { wear: 0.6, rand: rng(4242), baseY: 0 });
    const b = makeCoursedWall(6, 3.4, { wear: 0.6, rand: rng(4242), baseY: 0 });
    const pa = a.attributes.position, pb = b.attributes.position;
    assert.equal(pa.count, pb.count, `coursed=${on}: same seed gave different vertex counts`);
    for (let i = 0; i < pa.count; i++) {
      assert.ok(
        Math.abs(pa.getX(i) - pb.getX(i)) < 1e-9
        && Math.abs(pa.getY(i) - pb.getY(i)) < 1e-9
        && Math.abs(pa.getZ(i) - pb.getZ(i)) < 1e-9,
        `coursed=${on}: vertex ${i} differs between two identically-seeded builds`,
      );
    }
  }
});
