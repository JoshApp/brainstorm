// ── A WALL'S NORMAL IS ITS TEXTURE COORDINATE ───────────────────────────────
//
// Josh, reporting from inside a corridor: *"the corridor two faces inside dont
// use the pom raymarch there or they do but its broken, also their texture is
// distorted."*
//
// Not a shader bug — the shader being handed a surface it cannot map. The stone
// derives its projection frame PER FRAGMENT from the interpolated normal: the
// along-wall direction is cross(up, N), and the texture coordinate is the world
// position dotted with it (style/surface-detail.ts). That is exact on a flat
// face at any angle, which is what it was built for.
//
// Displace the face and the projection AXIS swings across it, so the coordinate
// stops being a linear function of position and the texture warps. POM marches
// in the same frame and swings with it. The corridor's wave put 0.045m of
// displacement on scales of 0.55-1.2m. I estimated ~27 degrees of tilt from the
// amplitude and wavelength; this test measures the real tessellated geometry and
// reports 6.2. Recording that gap is the point of writing the measurement down —
// six degrees is a third of a stone's width of coordinate error on a 4m wall,
// real but not dramatic, and it is why the corridor report stayed open after
// this was fixed rather than closing with it.
//
// So flatness is not a taste setting here, it is a PRECONDITION of the mapping.
// This measures it, in the one unit that decides: how far a wall's normals tilt
// away from its plane.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeJitteredPlane } from '../src/level/geometry-prims';
import { DRESSING } from '../src/level/dressing';

/** Worst normal tilt off the plane, in degrees. */
function worstTilt(geo: THREE.BufferGeometry): number {
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  let worst = 0;
  for (let i = 0; i < n.count; i++) {
    // The plane is built facing +Z, so any deviation shows up as x/y.
    const nz = Math.abs(n.getZ(i));
    const off = Math.hypot(n.getX(i), n.getY(i));
    worst = Math.max(worst, Math.atan2(off, Math.max(1e-6, nz)) * 180 / Math.PI);
  }
  return worst;
}

/**
 * How far the frame may swing before the mapping visibly warps.
 *
 * The along-wall axis IS cross(up, N), so a tilt of T degrees swings the texture
 * axis by up to T degrees. A few degrees is invisible; the wave's ~27 was not.
 */
const MAX_TILT_DEG = 6;

test('a wall built for the stone shader is flat enough to map', () => {
  DRESSING['shell-coursing'].on = false;
  for (const [w, h] of [[3, 3.4], [6, 4.2], [1.8, 2.6], [12, 5]]) {
    const tilt = worstTilt(makeJitteredPlane(w, h, { wavy: true }));
    assert.ok(tilt <= MAX_TILT_DEG,
      `a ${w}x${h}m wall tilts ${tilt.toFixed(1)}deg off its plane — the projection `
      + `axis swings with it and the texture warps (see the file header)`);
  }
});

test('...and the check discriminates — the wave really did tilt them', () => {
  // The bound is only worth having if the thing it was written for fails it.
  // This is the corridor wall Josh photographed, with the wave back on.
  DRESSING['shell-coursing'].on = true;
  const tilt = worstTilt(makeJitteredPlane(6, 4.2, { wavy: true }));
  DRESSING['shell-coursing'].on = false;
  assert.ok(tilt > MAX_TILT_DEG,
    `with the wave ON a wall only tilts ${tilt.toFixed(1)}deg — if the displacement `
    + 'changed, re-derive MAX_TILT_DEG rather than deleting this');
});

test('the wall AO bake survives the wave being off', () => {
  // `wavy` used to mean two things — displace the face, AND bake the wall's
  // floor/ceiling/corner occlusion. Only the first is switched. If the split
  // were wrong, every wall in the game would silently lose its contact
  // shading, which is a far worse regression than the one being fixed and
  // would look like "the rooms got flatter" rather than like a bug.
  DRESSING['shell-coursing'].on = false;
  const geo = makeJitteredPlane(6, 4.2, { wavy: true });
  const col = geo.attributes.color;
  assert.ok(col, 'wall lost its vertex colours entirely');
  let lo = 1, hi = 0;
  for (let i = 0; i < col.count; i++) { const v = col.getX(i); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(hi - lo > 0.15,
    `wall AO spans only ${(hi - lo).toFixed(3)} — the occlusion bake went with the wave`);
});
