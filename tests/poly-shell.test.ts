// THE POLYGON SHELL — does the room actually close?
//
// Three real defects shipped in the first version of this shell and all three
// were invisible in a screenshot and obvious on a phone. Each has a test here,
// because "I looked at it and it seemed fine" is how all three got out:
//
//   1. Geometry with no `color` attribute, against materials that run
//      vertexColors:true — the shader reads unbound memory and multiplies
//      garbage into the albedo. Driver-dependent, so it can look correct in one
//      browser and paint black holes in another.
//   2. A ceiling mirrored in Z, because re-rotating the floor's shape by +π/2
//      flips it front-to-back rather than face-down. A rectangle is symmetric so
//      the rect path never noticed; an apse is not, and the room was open to the
//      void over its whole back end.
//   3. Walls as independent slabs stretched past their ends "so they overlap" —
//      seals a right angle, roughly seals a chamfer, has no answer at a reflex
//      corner or beside a doorway.
//
// The ring tests are pure arithmetic and assert closure directly. The Three
// tests build the REAL shell and raycast it.
//
//   npm test

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPolyRoomShell } from '../src/level/poly-room-shell';
import {
  offsetRing, planWallRing, signedArea, edgeNormal, type Ring,
} from '../src/level/poly-shell-plan';
import { ARCHETYPES, generateRoomShape, pointInPoly, polyArea, type Poly } from '../src/level/room-shape';
import { STARTER_POLY } from '../src/level/starter-chamber';

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

/** Every archetype at a few sizes — the shell has to close for all of them, not
 *  just for the one room that currently ships. */
function* shapes(): Generator<{ kind: string; poly: Poly }> {
  for (const kind of ARCHETYPES) {
    for (let s = 0; s < 12; s++) {
      const rand = mulberry(s * 7919 + 13);
      yield { kind, poly: generateRoomShape(kind, { w: 8 + rand() * 8, d: 6 + rand() * 7, rand }) };
    }
  }
}

const T = 0.25;

// ── the ring is closed by construction, so prove the construction ────────────

test('the outward normal really points outward', () => {
  // Everything else depends on this, and getting it backwards builds the ring
  // INTO the room — where it would still look like a wall, from inside.
  for (const { kind, poly } of shapes()) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const n = edgeNormal(poly, i);
      assert.ok(!pointInPoly(poly, mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05),
        `${kind}: edge ${i} normal points INTO the room`);
      assert.ok(pointInPoly(poly, mid[0] - n[0] * 0.05, mid[1] - n[1] * 0.05),
        `${kind}: edge ${i} inward side is not inside the room`);
    }
  }
});

test('the offset ring encloses the room and never crosses into it', () => {
  for (const { kind, poly } of shapes()) {
    const ring = offsetRing(poly, T);
    assert.equal(ring.length, poly.length, `${kind}: ring lost vertices`);
    assert.ok(Math.abs(signedArea(ring)) > polyArea(poly),
      `${kind}: the outer ring is not bigger than the room`);
    for (const [x, z] of ring) {
      assert.ok(!pointInPoly(poly, x, z), `${kind}: an outer ring point landed inside the room`);
      assert.ok(Number.isFinite(x) && Number.isFinite(z), `${kind}: non-finite ring vertex`);
    }
  }
});

test('WITH NO OPENINGS, THE SPANS FORM ONE CLOSED LOOP', () => {
  // The whole claim of the ring construction: adjacent spans share their end
  // vertices EXACTLY, so a gap is unrepresentable rather than unlikely.
  for (const { kind, poly } of shapes()) {
    const spans = planWallRing(poly, T);
    assert.equal(spans.length, poly.length, `${kind}: expected one span per edge`);
    for (let i = 0; i < spans.length; i++) {
      const cur = spans[i], next = spans[(i + 1) % spans.length];
      assert.deepEqual(cur.b, next.a, `${kind}: inner face breaks between span ${i} and ${i + 1}`);
      assert.deepEqual(cur.ob, next.oa, `${kind}: outer face breaks between span ${i} and ${i + 1}`);
      assert.ok(!cur.jambA && !cur.jambB, `${kind}: span ${i} claims a jamb with no opening to cut it`);
    }
  }
});

test('NO RAY ESCAPES THE ROOM EXCEPT THROUGH A DOORWAY', () => {
  // The property a player would find by walking into a corner. Fire rays from
  // interior points in every direction; each must cross a span's inner face.
  for (const { kind, poly } of shapes()) {
    const spans = planWallRing(poly, T);
    const segs = spans.map((s) => [s.a, s.b] as const);
    for (let p = 0; p < 24; p++) {
      const rand = mulberry(p * 31 + 5);
      let ox = 0, oz = 0;
      for (let tries = 0; tries < 200; tries++) {
        const b = poly.reduce((acc, v) => ({
          x0: Math.min(acc.x0, v[0]), x1: Math.max(acc.x1, v[0]),
          z0: Math.min(acc.z0, v[1]), z1: Math.max(acc.z1, v[1]),
        }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
        ox = b.x0 + rand() * (b.x1 - b.x0);
        oz = b.z0 + rand() * (b.z1 - b.z0);
        if (pointInPoly(poly, ox, oz)) break;
      }
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        let hits = 0;
        for (const [s0, s1] of segs) if (raySegHit(ox, oz, dx, dz, s0, s1)) hits++;
        assert.ok(hits % 2 === 1,
          `${kind}: ray from (${ox.toFixed(2)}, ${oz.toFixed(2)}) at ${a} crossed ${hits} walls — even means it escaped`);
      }
    }
  }
});

test('a doorway cuts the ring and leaves jambs, not stubs hanging in the gap', () => {
  const poly: Poly = [[-5, -4], [5, -4], [5, 4], [-5, 4]];
  const door = { x: 5, z: 0, w: 2, d: 1.6 };            // straddles the east wall
  const spans = planWallRing(poly, T, [door]);
  const east = spans.filter((s) => s.edge === 1);
  assert.equal(east.length, 2, `expected the east wall split in two, got ${east.length}`);
  // Exactly the two ends facing the doorway are jambs; the corner ends are not.
  assert.ok(east[0].jambB && !east[0].jambA, 'first east piece has the wrong end capped');
  assert.ok(east[1].jambA && !east[1].jambB, 'second east piece has the wrong end capped');
  const gap = Math.abs(east[0].b[1] - east[1].a[1]);
  // THE HOLE IS THE OPENING'S OWN WIDTH — no wider.
  //
  // This used to assert `gap > door.d`, which was only ever satisfiable because
  // the ring inflated every cut by the wall thickness: a 1.6m opening produced a
  // 2.1m hole. That surplus is the see-through slot at each jamb — measured at
  // 0.50m on 1203 real portals — so the assertion was pinning the bug. The cut
  // is now exact, and "exact" is what a doorway should be.
  assert.ok(Math.abs(gap - door.d) < 0.02,
    `doorway is ${gap.toFixed(2)}m for a ${door.d.toFixed(2)}m opening — the two no longer agree`);
  // And the rest of the ring is untouched.
  assert.equal(spans.filter((s) => s.edge !== 1).length, 3, 'the doorway cut walls it should not have');
});

test('a doorway that misses every wall changes nothing', () => {
  const poly: Poly = [[-5, -4], [5, -4], [5, 4], [-5, 4]];
  assert.deepEqual(
    planWallRing(poly, T, [{ x: 0, z: 0, w: 1, d: 1 }]),
    planWallRing(poly, T),
    'a rect floating in the middle of the room cut the walls',
  );
});

// ── the built geometry ───────────────────────────────────────────────────────

function buildShell(poly: Poly, height = 4) {
  const root = new THREE.Object3D();
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const segs: Array<{ ax: number; az: number; bx: number; bz: number }> = [];
  buildPolyRoomShell(
    root,
    { id: 't', rect: rectOf(poly), height, poly } as never,
    { floor: mat, ceiling: mat, wall: mat } as never,
    segs as never,
    [],
  );
  root.updateMatrixWorld(true);
  return { root, segs, height };
}

function rectOf(poly: Poly) {
  const b = poly.reduce((acc, v) => ({
    x0: Math.min(acc.x0, v[0]), x1: Math.max(acc.x1, v[0]),
    z0: Math.min(acc.z0, v[1]), z1: Math.max(acc.z1, v[1]),
  }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0 };
}

test('EVERY GEOMETRY CARRIES VERTEX COLOURS', () => {
  // The floor/wall/ceiling materials all run vertexColors:true. A geometry
  // without the attribute leaves the slot unbound and the driver multiplies
  // undefined memory into the albedo. This is the bug that painted black holes.
  const { root } = buildShell(STARTER_POLY, 5.5);
  let meshes = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const c = m.geometry.getAttribute('color');
    assert.ok(c, `${m.name} has no colour attribute`);
    assert.equal(c.count, m.geometry.getAttribute('position').count,
      `${m.name} colour attribute does not cover every vertex`);
  });
  assert.ok(meshes >= 3, `expected floor, ceiling and walls, got ${meshes} meshes`);
});

test('THE CEILING IS OVER THE FLOOR, NOT MIRRORED ACROSS IT', () => {
  // Sample the whole bounding box. Floor and ceiling coverage must both agree
  // with the polygon — which a Z-mirrored ceiling cannot do on a shape that
  // isn't symmetric front to back.
  const { root, height } = buildShell(STARTER_POLY, 5.5);
  const floor = root.getObjectByName('polyfloor:t') as THREE.Mesh;
  const ceil = root.getObjectByName('polyceil:t') as THREE.Mesh;
  assert.ok(floor && ceil, 'shell did not build both plates');
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let checked = 0;
  for (let x = -3.6; x <= 3.6; x += 0.4) {
    for (let z = -6.6; z <= 6.6; z += 0.4) {
      // Skip points near the outline, where a sample can land either side.
      if (!marginClear(STARTER_POLY, x, z, 0.3)) continue;
      checked++;
      const inside = pointInPoly(STARTER_POLY, x, z);
      ray.set(new THREE.Vector3(x, height + 2, z), down);
      const hitCeil = ray.intersectObject(ceil, false).length > 0;
      const hitFloor = ray.intersectObject(floor, false).length > 0;
      assert.equal(hitFloor, inside, `floor coverage wrong at (${x.toFixed(1)}, ${z.toFixed(1)})`);
      assert.equal(hitCeil, inside, `CEILING coverage wrong at (${x.toFixed(1)}, ${z.toFixed(1)}) — mirrored?`);
    }
  }
  assert.ok(checked > 200, `only ${checked} sample points — the sweep is not covering the room`);
});

test('the plates face each other', () => {
  const { root } = buildShell(STARTER_POLY, 5.5);
  for (const [name, wantY] of [['polyfloor:t', 1], ['polyceil:t', -1]] as const) {
    const m = root.getObjectByName(name) as THREE.Mesh;
    const n = m.geometry.getAttribute('normal');
    const v = new THREE.Vector3(n.getX(0), n.getY(0), n.getZ(0))
      .applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(Math.sign(v.y) === wantY && Math.abs(v.y) > 0.9,
      `${name} normal is ${v.y.toFixed(2)} in world Y, wanted ${wantY}`);
  }
});

test('the walls are one mesh, and there is a wall segment per span', () => {
  const { root, segs } = buildShell(STARTER_POLY, 5.5);
  const walls = root.getObjectByName('polywalls:t') as THREE.Mesh;
  assert.ok(walls, 'walls did not merge into a single mesh');
  assert.equal(segs.length, STARTER_POLY.length,
    'collision segments do not match the number of wall spans');
});

/** Inside the polygon with `pad` metres of clearance in every direction. */
function marginClear(poly: Ring, x: number, z: number, pad: number): boolean {
  const inside = pointInPoly(poly, x, z);
  for (let a = 0; a < Math.PI * 2 - 1e-6; a += Math.PI / 8) {
    if (pointInPoly(poly, x + Math.cos(a) * pad, z + Math.sin(a) * pad) !== inside) return false;
  }
  return true;
}

/** Does the ray from (ox,oz) along (dx,dz) hit segment s0→s1 at t > 0? */
function raySegHit(
  ox: number, oz: number, dx: number, dz: number,
  s0: readonly [number, number], s1: readonly [number, number],
): boolean {
  const ex = s1[0] - s0[0], ez = s1[1] - s0[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((s0[0] - ox) * ez - (s0[1] - oz) * ex) / den;
  const u = ((s0[0] - ox) * dz - (s0[1] - oz) * dx) / den;
  return t > 1e-9 && u >= 0 && u < 1;      // half-open so a shared corner counts once
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
