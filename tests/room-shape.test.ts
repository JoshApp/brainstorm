// ROOM SHAPE v2 — the polygon floor, pinned.
//
// This is the first piece of the generator replacing the ASCII vaults
// (docs/LEVEL-ARCHITECTURE.md §8). It's load-bearing new geometry, and geometry
// fails silently: a self-intersecting or inside-out polygon still renders, still
// has an area, and only shows up later as a wall you can walk through.
//
// So these are mostly STRUCTURAL invariants rather than taste. Taste is judged
// from `npx tsx scripts/shape-sheet.ts`, which is the point of that script.
//
//   npm test

import assert from 'node:assert/strict';
import {
  ARCHETYPES, chamfer, combineRects, generateRoomShape, pointInPoly, polyArea, polyBounds,
  type Poly,
} from '../src/level/room-shape';

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

/** Do two segments properly cross (not merely touch at a shared endpoint)? */
function segmentsCross(
  a: readonly [number, number], b: readonly [number, number],
  c: readonly [number, number], e: readonly [number, number],
): boolean {
  const d = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(a, b, c), d2 = d(a, b, e), d3 = d(c, e, a), d4 = d(c, e, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
         ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function selfIntersects(poly: Poly): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;   // adjacent through the closing edge
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[k], poly[(k + 1) % n])) return true;
    }
  }
  return false;
}

const SAMPLES = 120;
function* everyShape(): Generator<{ kind: string; poly: Poly; w: number; d: number }> {
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < SAMPLES; s++) {
      const rand = mulberry(s * 7919 + 13);
      const w = 8 + rand() * 8, d = 6 + rand() * 7;
      yield { kind, w, d, poly: generateRoomShape(kind, { w, d, rand, chamfer: 1.1 }) };
    }
  }
}

test('every archetype produces a real polygon', () => {
  for (const { kind, poly } of everyShape()) {
    assert.ok(poly.length >= 3, `${kind}: degenerate polygon with ${poly.length} points`);
    assert.ok(polyArea(poly) > 4, `${kind}: area ${polyArea(poly).toFixed(1)}m² — that's not a room`);
    for (const [x, z] of poly) {
      assert.ok(Number.isFinite(x) && Number.isFinite(z), `${kind}: non-finite vertex`);
    }
  }
});

test('NO SHAPE SELF-INTERSECTS', () => {
  // The failure that renders fine and then produces a wall you can walk through.
  for (const { kind, poly } of everyShape()) {
    assert.ok(!selfIntersects(poly), `${kind}: self-intersecting outline (${poly.length} vertices)`);
  }
});

test('a shape never exceeds the size the floor plan gave it', () => {
  // The whole point over a tilemap is that the shape RESPONDS to its budget.
  // A shape that overflows would overlap its neighbours.
  for (const { kind, poly, w, d } of everyShape()) {
    const b = polyBounds(poly);
    assert.ok(b.maxX - b.minX <= w + 0.01,
      `${kind}: ${(b.maxX - b.minX).toFixed(1)}m wide in a ${w.toFixed(1)}m budget`);
    assert.ok(b.maxZ - b.minZ <= d + 0.01,
      `${kind}: ${(b.maxZ - b.minZ).toFixed(1)}m deep in a ${d.toFixed(1)}m budget`);
  }
});

test('shapes are actually shaped — not rectangles wearing a costume', () => {
  // If the grammar collapses to a box, everything above still passes and we've
  // rebuilt the vaults. A rectangle has 4 vertices and fills its bbox exactly.
  for (const kind of ARCHETYPES) {
    let boxy = 0;
    for (let s = 0; s < SAMPLES; s++) {
      const rand = mulberry(s * 7919 + 13);
      const w = 8 + rand() * 8, d = 6 + rand() * 7;
      const poly = generateRoomShape(kind, { w, d, rand, chamfer: 1.1 });
      const b = polyBounds(poly);
      const fill = polyArea(poly) / Math.max(1e-6, (b.maxX - b.minX) * (b.maxZ - b.minZ));
      if (poly.length <= 4 && fill > 0.98) boxy++;
    }
    assert.ok(boxy / SAMPLES < 0.1,
      `${kind}: ${((boxy / SAMPLES) * 100).toFixed(0)}% of samples are plain rectangles`);
  }
});

test('the interior test agrees with the outline', () => {
  // pointInPoly is THE walkability predicate for a v2 room, so it had better
  // match the polygon it's asked about. Centroid-ish points inside, points well
  // outside the bbox outside.
  for (const { kind, poly } of everyShape()) {
    const b = polyBounds(poly);
    assert.ok(!pointInPoly(poly, b.minX - 5, b.minZ - 5), `${kind}: a point outside the bbox reads as inside`);
    assert.ok(!pointInPoly(poly, b.maxX + 5, b.maxZ + 5), `${kind}: a point outside the bbox reads as inside`);
    // Monte-carlo the bbox: the hit fraction must roughly match the area ratio.
    const rand = mulberry(99);
    let hits = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      if (pointInPoly(poly, b.minX + rand() * (b.maxX - b.minX), b.minZ + rand() * (b.maxZ - b.minZ))) hits++;
    }
    const expect = polyArea(poly) / ((b.maxX - b.minX) * (b.maxZ - b.minZ));
    assert.ok(Math.abs(hits / N - expect) < 0.12,
      `${kind}: interior test says ${((hits / N) * 100).toFixed(0)}% but the area says ${(expect * 100).toFixed(0)}%`);
  }
});

test('generation is deterministic for a seed', () => {
  // Floors are seeded; a shape that varies per call would desync a run from its
  // own replay and make every audit meaningless.
  for (const kind of ARCHETYPES) {
    const a = generateRoomShape(kind, { w: 12, d: 9, rand: mulberry(4242), chamfer: 1 });
    const b = generateRoomShape(kind, { w: 12, d: 9, rand: mulberry(4242), chamfer: 1 });
    assert.deepEqual(a, b, `${kind}: same seed produced a different shape`);
  }
});

test('a bite that severs the room keeps only the larger piece', () => {
  // A room is ONE space. Two rects joined by nothing must not yield an outline
  // that wanders between them.
  const poly = combineRects(
    [{ x: -6, z: 0, w: 6, d: 6 }, { x: 6, z: 0, w: 4, d: 4 }],
  );
  assert.ok(polyArea(poly) > 30 && polyArea(poly) < 40,
    `expected only the 36m² piece, got ${polyArea(poly).toFixed(1)}m²`);
});

test('chamfer cuts convex corners and leaves concave ones', () => {
  // An L: cutting its inner corner would read as damage, not architecture.
  const ell = combineRects([{ x: 0, z: 0, w: 4, d: 12 }, { x: 0, z: 4, w: 12, d: 4 }]);
  const before = ell.length;
  const cut = chamfer(ell, 1);
  assert.ok(cut.length > before, 'chamfer added no vertices at all');
  assert.ok(polyArea(cut) < polyArea(ell), 'chamfer did not remove area — it cut the wrong corners');
  // Every original concave corner must survive untouched.
  assert.ok(polyArea(ell) - polyArea(cut) < 6,
    'chamfer removed too much — it is cutting concave corners as well');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
