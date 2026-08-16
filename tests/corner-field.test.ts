// ── THE CORNER FIELD ────────────────────────────────────────────────────────
//
// scene/corner-field.ts writes a world-space scalar the wall shader reads to
// find corners. Everything that can go wrong with it is silent: a field that
// builds but is all zero, a field whose corners land in the wrong place, or a
// field that stamps a quoin halfway down a flat wall. None of those throw, and
// all of them look like a shading decision.
//
// The module touches THREE for its DataTexture, so this drives it through the
// real entry point and reads the result back out of `cornerFieldInfo`, rather
// than re-implementing the corner walk here. A test that re-derives the maths is
// a test that can agree with itself while the shipped code is wrong —
// docs/DESIGN-METHOD.md, "every audit tool imports the real function".

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCornerField, clearCornerField, cornerFieldInfo } from '../src/scene/corner-field';

type Poly = ReadonlyArray<readonly [number, number]>;

const square = (s: number): Poly =>
  [[0, 0], [s, 0], [s, s], [0, s]];

test('a square room has four corners, and the field peaks at them', () => {
  buildCornerField({ polys: [square(10)] });
  const info = cornerFieldInfo();
  assert.equal(info.corners, 4, 'a square is four corners');
  assert.ok(info.on, 'field did not switch on');
  // THE ONE THAT ACTUALLY MATTERS. A field of the right SIZE that is entirely
  // zero renders identically to no field at all, so "it built" is not evidence.
  // > 0.9, and this bound is doing real work rather than being a formality: at
  // the original TEXEL_M of 0.35 a corner on this very square measured 0.80,
  // because the falloff spanned two texels and the corner missed their centres.
  // The bound is what said so. Anything that coarsens the field again fails here
  // before it can ship a quoin whose strength depends on the world grid.
  assert.ok(info.peak > 0.9, `field peaks at ${info.peak} — under-resolved or unstamped`);
  assert.ok(info.w > 1 && info.h > 1, 'field is degenerate');
});

test('a nearly-straight vertex is NOT a corner', () => {
  // Poly outlines carry near-collinear vertices from clipping. Stamping one
  // would put an unexplained smooth pier in the middle of a flat wall — which is
  // exactly the artefact this whole feature exists to avoid creating.
  const almostStraight: Poly = [[0, 0], [5, 0], [10, 0.02], [10, 10], [0, 10]];
  buildCornerField({ polys: [almostStraight] });
  assert.equal(cornerFieldInfo().corners, 4,
    'the collinear vertex was counted as a corner');
});

test('a chamfered corner counts as two, and they do not double-brighten', () => {
  // room-shape.ts chamfers convex corners at 45 degrees, so a chamfer is two
  // vertices about a metre apart. Both are real corners and both should stamp —
  // but the field takes a MAX rather than a sum, so the overlap between them
  // must not push past a single corner's peak. A sum would make every chamfer
  // in the dungeon brighter than every square corner, for no reason anyone
  // chose.
  const chamfered: Poly = [[0, 0], [9, 0], [10, 1], [10, 10], [0, 10]];
  buildCornerField({ polys: [chamfered] });
  const info = cornerFieldInfo();
  assert.equal(info.corners, 5, 'chamfer did not produce two corners');
  assert.ok(info.peak <= 1.0 + 1e-6, `peak ${info.peak} exceeded one corner's worth`);
});

test('no polygons means no field, not a broken one', () => {
  // Rect-only levels (tutorial, most debug scenarios) have no outlines. The term
  // must go inert rather than sample a stale field from the previous floor —
  // which would put last floor's corners onto this floor's walls.
  buildCornerField({ polys: [square(10)] });
  assert.ok(cornerFieldInfo().on);
  clearCornerField();
  const info = cornerFieldInfo();
  assert.equal(info.on, false, 'field stayed on with nothing in it');
  assert.equal(info.corners, 0);
});

test('degenerate outlines are refused rather than crashing', () => {
  buildCornerField({ polys: [[[0, 0], [1, 1]]] as Poly[] });         // 2 points
  assert.equal(cornerFieldInfo().on, false, 'a line built a field');
  buildCornerField({ polys: [[[0, 0], [0, 0], [0, 0]]] as Poly[] }); // zero-length edges
  assert.equal(cornerFieldInfo().on, false, 'a point built a field');
  clearCornerField();
});
