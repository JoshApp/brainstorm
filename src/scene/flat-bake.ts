import * as THREE from 'three';

// ── FLAT SHADING, BAKED INTO GEOMETRY ────────────────────────────────────────
//
// `material.flatShading = true` is a SHADER: three compiles a derivative-based
// normal path into the fragment program, so a flat prop and a smooth prop are
// two programs of the same lit shader — and every family that mixed them paid
// twice (28 clutter definitions, five palette materials, a dozen hand-built
// props). What the derivative path computes is the face normal, and a face
// normal can be stored: make the geometry non-indexed and compute vertex
// normals, and the SMOOTH shader draws the identical facets.
//
// So flat shading is now a property of GEOMETRY, and the material flag is
// retired. A material that asks for it (`flatShading: true` in a ModelSpec
// MaterialDef, a `stdMat({ flatShading: true })` call) is created smooth and
// marked `userData.flatBaked`; the mesh that pairs it with a geometry swaps in
// the flat clone from `flatGeometry()`. Model parts do that in build-model's
// makeMesh; level geometry gets one `bakeFlatShading(root)` pass before the
// static batcher (which then merges flat and smooth parts into one batch,
// because they are one material). Runtime effects that build their own meshes
// call `flatGeometry()` directly.
//
// Flat clones are cached per source geometry and owned by this module: pooled
// primitives stay pooled (one flat box for every flat box), and nothing here is
// ever disposed by a teardown.

const flatCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** The flat-shaded twin of a geometry: non-indexed with face normals. Cached
 *  per source; the result is pooled (never dispose it). Idempotent on a
 *  geometry that is already baked. */
export function flatGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.userData.flatBaked) return geo;
  let flat = flatCache.get(geo);
  if (!flat) {
    flat = geo.index ? geo.toNonIndexed() : geo.clone();
    flat.computeVertexNormals();
    flat.userData.flatBaked = true;
    flat.userData.pooled = true;
    flat.name = geo.name;
    flatCache.set(geo, flat);
  }
  return flat;
}

/** Does this material want its geometry flat-baked? Reads the marker the
 *  material factories set; also catches a raw `flatShading: true` material
 *  that bypassed them, retiring the flag in place (needsUpdate) so it never
 *  reaches the shader. */
export function wantsFlatBake(mat: THREE.Material | THREE.Material[] | undefined): boolean {
  if (!mat) return false;
  const mats = Array.isArray(mat) ? mat : [mat];
  let wants = false;
  for (const m of mats) {
    const f = m as THREE.Material & { flatShading?: boolean };
    if (f.flatShading === true) {
      f.flatShading = false;
      f.needsUpdate = true;
      m.userData.flatBaked = true;
    }
    if (m.userData.flatBaked === true) wants = true;
  }
  return wants;
}

/** Swap every mesh under `root` whose material wants flat shading onto the
 *  flat twin of its geometry. Returns how many meshes were baked. */
export function bakeFlatShading(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!wantsFlatBake(mesh.material)) return;
    if (mesh.geometry.userData.flatBaked) return;
    mesh.geometry = flatGeometry(mesh.geometry);
    n++;
  });
  return n;
}
