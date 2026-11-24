// THE BAKED MASONRY COORDINATES — walls round their room, stairs down their flight.
//
// Both exist because the fragment cannot know them, and both were wrong in ways a
// screenshot shows only from the right angle:
//
//   1. WALLS. Each wall laid its stone from its own origin, so every vertical joint
//      jumped at every corner (Josh: "the texture is still misaligned over corners").
//      The ring coordinate has to arrive at a corner on one wall with the value it
//      leaves on the next, and come all the way round to a whole number of tiles.
//   2. STAIRS. The shader marches POM and tilts the relief along fixed world axes on a
//      tread and along the normal's axes on a riser. The bake has to INCREASE along
//      exactly those, for both run axes and both directions of fall — the first bake
//      had U and V swapped on X-running flights and folded back on itself on a flight
//      falling toward −axis.

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { unwrapRing, ringU, tagWallFace } from '../src/level/wall-unwrap';
import { makeSteppedRampGeometry, bakeStairUnwrapUV } from '../src/level/geometry-prims';
import { layAsFlagstones } from '../src/level/poly-room-shell';
import { MASONRY_UV_TAG, WALL_TILE } from '../src/style/stone-grid';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const P = WALL_TILE[0];
/** Distance between two texture coordinates on the repeating tile. */
const phaseGap = (a: number, b: number) => {
  const d = (((a - b) % P) + P) % P;
  return Math.min(d, P - d);
};

// A chamfered room, positively wound — the shape room-shape.ts generates.
const ROOM: Array<[number, number]> = [
  [-3.75, -3.92], [-2.42, -5.25], [1.92, -5.25], [3.25, -3.92], [3.25, -1.25], [5.75, -1.25],
  [5.75, 3.57], [4.07, 5.25], [-4.07, 5.25], [-5.75, 3.57], [-5.75, -0.58], [-5.08, -1.25], [-3.75, -1.25],
];
const edgeLen = (i: number) => {
  const a = ROOM[i], b = ROOM[(i + 1) % ROOM.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};

test('the ring coordinate arrives at every corner with the value it leaves it', () => {
  const u = unwrapRing(ROOM);
  for (let i = 0; i < ROOM.length; i++) {
    const L = edgeLen(i);
    const arriving = ringU(u, i, L, L / 2);
    const leaving = ringU(u, (i + 1) % ROOM.length, 0, edgeLen((i + 1) % ROOM.length) / 2);
    assert.ok(phaseGap(arriving, leaving) < 1e-6,
      `corner ${i + 1}: the stone jumps by ${phaseGap(arriving, leaving).toFixed(3)}m`);
  }
});

test('a closed ring holds a whole number of tiles, and no stone is stretched much', () => {
  const u = unwrapRing(ROOM);
  const laps = (u.perimeter * u.stretch) / P;
  assert.ok(Math.abs(laps - Math.round(laps)) < 1e-9, `the ring closes on ${laps} tiles`);
  assert.ok(Math.abs(u.stretch - 1) <= P / 2 / u.perimeter + 1e-9, `stretch ${u.stretch}`);
});

test('a ring with an open gap closes there instead, unstretched', () => {
  const u = unwrapRing(ROOM, 3.0);
  assert.equal(u.stretch, 1);
  // Just past the gap the coordinate starts again from zero.
  assert.ok(Math.abs(ringU(u, 0, 3.0 + 1e-3)) < 1e-2);
});

test('a face measured on one lap never wraps inside itself', () => {
  const u = unwrapRing(ROOM);
  const last = ROOM.length - 1;
  const L = edgeLen(last);
  // The last edge ends exactly where the ring started: its far end must read the
  // ring's full length, not snap back to zero halfway across the face.
  const a = ringU(u, last, 0, L / 2), b = ringU(u, last, L, L / 2);
  assert.ok(b > a && Math.abs((b - a) - L * u.stretch) < 1e-9, `face spans ${a}..${b}`);
});

test('tagWallFace bakes the room-side face and leaves every other face alone', () => {
  const u = unwrapRing(ROOM);
  // Two walls meeting at corner 2 (between edges 1 and 2), built the way the shell
  // builds them: a plane rotated so +Z faces into the room, centred on the edge.
  const face = (i: number) => {
    const a = ROOM[i], b = ROOM[(i + 1) % ROOM.length];
    const L = edgeLen(i);
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L] as const;
    const inward = [-dir[1], dir[0]] as const;
    const g = new THREE.PlaneGeometry(L, 3, 4, 2);
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(inward[0], inward[1]));
    m.setPosition((a[0] + b[0]) / 2, 1.5, (a[1] + b[1]) / 2);
    g.applyMatrix4(m);
    tagWallFace(g, u, i, a, dir, inward);
    return g;
  };
  const g1 = face(1), g2 = face(2);
  const corner = ROOM[2];
  const at = (g: THREE.BufferGeometry, y: number) => {
    const p = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let k = 0; k < p.count; k++) {
      if (Math.hypot(p.getX(k) - corner[0], p.getZ(k) - corner[1]) < 1e-4 && Math.abs(p.getY(k) - y) < 1e-4) {
        assert.ok(uv.getY(k) > MASONRY_UV_TAG / 2, 'the face was not tagged');
        assert.ok(Math.abs(uv.getY(k) - MASONRY_UV_TAG - y) < 1e-3, 'V must be the world height');
        return uv.getX(k);
      }
    }
    throw new Error('no vertex at the corner');
  };
  for (const y of [0, 1.5, 3]) {
    assert.ok(phaseGap(at(g1, y), at(g2, y)) < 1e-4, `corner seam at y=${y}`);
  }
  // A face pointing some other way (a jamb) keeps its own uv.
  const jamb = new THREE.PlaneGeometry(0.25, 3);
  jamb.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(corner[0], 1.5, corner[1]));
  const before = Array.from(jamb.getAttribute('uv').array as Float32Array);
  tagWallFace(jamb, u, 2, ROOM[2], [1, 0], [0, 1]);
  assert.deepEqual(Array.from(jamb.getAttribute('uv').array as Float32Array), before);
});

// ── the stair unwrap ────────────────────────────────────────────────────────

/** Gradient of the baked (u, v) across one triangle, in the face's two horizontal-or-
 *  vertical world axes. Returns d/d(axis) for the three world axes (0 where flat). */
function triGradient(
  p: THREE.BufferAttribute, f: (k: number) => number, i0: number, i1: number, i2: number,
): [number, number, number] {
  const P0 = new THREE.Vector3().fromBufferAttribute(p, i0);
  const e1 = new THREE.Vector3().fromBufferAttribute(p, i1).sub(P0);
  const e2 = new THREE.Vector3().fromBufferAttribute(p, i2).sub(P0);
  const n = new THREE.Vector3().crossVectors(e1, e2);
  const df1 = f(i1) - f(i0), df2 = f(i2) - f(i0);
  // grad = (df1 (e2 × n) + df2 (n × e1)) / |n|²  — the in-plane gradient.
  const g = new THREE.Vector3().crossVectors(e2, n).multiplyScalar(df1)
    .add(new THREE.Vector3().crossVectors(n, e1).multiplyScalar(df2))
    .divideScalar(n.lengthSq());
  return [g.x, g.y, g.z];
}

function bakedFlight(alongX: boolean, fallsTowardPlus: boolean) {
  const rect = { x: 2, z: -3, w: alongX ? 6 : 1.6, d: alongX ? 1.6 : 6 };
  const lo = (alongX ? rect.x : rect.z) - 3;
  const g = (x: number, z: number) => {
    const t = ((alongX ? x : z) - lo) / 6;
    const s = Math.max(0, Math.min(1, fallsTowardPlus ? t : 1 - t));
    return -1.2 * s;
  };
  const geo = makeSteppedRampGeometry(rect, g, 0.18, alongX, { t0: 0.1, t1: 0.9, steps: 6 })!;
  layAsFlagstones(geo, { wear: 0.4, key: 't', axes: 'xz', toWorld: (sx, sy) => [sx, sy] });
  bakeStairUnwrapUV(geo, alongX);
  return geo;
}

for (const alongX of [true, false]) {
  for (const plus of [true, false]) {
    const label = `${alongX ? 'X' : 'Z'}-running, falling toward ${plus ? '+' : '−'}`;
    test(`stair (${label}): treads run U on +X and V on +Z; risers run the unwrap down the face`, () => {
      const geo = bakedFlight(alongX, plus);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      const n = geo.getAttribute('normal') as THREE.BufferAttribute;
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      const U = (k: number) => uv.getX(k);
      const V = (k: number) => uv.getY(k);
      for (let k = 0; k < uv.count; k++) assert.ok(uv.getY(k) > MASONRY_UV_TAG / 2, 'untagged vertex');
      let treads = 0, risers = 0;
      for (let t = 0; t < p.count; t += 3) {
        const nx = n.getX(t), ny = n.getY(t), nz = n.getZ(t);
        const gu = triGradient(p, U, t, t + 1, t + 2);
        const gv = triGradient(p, V, t, t + 1, t + 2);
        if (ny > 0.9) {
          treads++;
          // The shader's tread frame: U along +X, V along +Z, unit rate (to float32 at the
          // tag offset, which resolves 0.06mm over a step a few cm across).
          assert.ok(Math.abs(gu[0] - 1) < 2e-3 && Math.abs(gu[2]) < 2e-3, `tread U gradient ${gu}`);
          assert.ok(Math.abs(gv[2] - 1) < 2e-3 && Math.abs(gv[0]) < 2e-3, `tread V gradient ${gv}`);
        }
        // The VISIBLE riser faces downhill. Its run-axis component is the unwrap.
        const runN = alongX ? nx : nz;
        if (Math.abs(runN) > 0.9 && (runN > 0) === plus) {
          risers++;
          const along = alongX ? gu : gv;
          // shader: riser along-axis = (0, −sign(n_run), 0)
          assert.ok(Math.abs(along[1] - (-Math.sign(runN))) < 2e-3, `riser unwrap gradient ${along}`);
        }
      }
      assert.ok(treads > 0 && risers > 0, `found ${treads} tread and ${risers} riser triangles`);
    });
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
