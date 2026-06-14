import * as THREE from 'three';

// Chain runs built from actual LINKS — interlocking low-poly tori
// along a sagging curve — replacing the straight-box "chains" that
// read as girders. The whole run is ONE InstancedMesh: a 30-link chain
// is a single draw call, not 30. The material is the caller's (it
// usually wants the chain in its fade-out rig).
//
// PERF history: this used to emit one Mesh per link, each castShadow=true.
// In the marrow-sovereign hall that meant ~74 separate draws AND ~74
// cube-map shadow redraws (the lamp's hero shadow re-renders every caster),
// which tanked the frame to ~6fps whenever the chains were in view and
// recovered the instant they culled. Instancing + dropping the shadow cast
// (a thin link's shadow is invisible anyway) is the fix.

const LINK_GEO = new THREE.TorusGeometry(0.055, 0.016, 6, 10);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1.35, 0.95, 1);   // stretch each ring into a link oval
const _xAxis = new THREE.Vector3(1, 0, 0);
const _rollX = new THREE.Quaternion().setFromAxisAngle(_xAxis, Math.PI / 2);

export interface ChainRunOpts {
  /** Vertical sag at the midpoint, metres. Default 0.12. */
  sag?: number;
  /** Spacing between link centres. Default 0.085 (links overlap). */
  spacing?: number;
}

/** Build a chain of interlocked links from `from` to `to` (local
 *  coordinates of the group the caller adds it to), sagging like a
 *  real chain. Links alternate 90° roll so they interlock. */
export function chainRun(
  from: THREE.Vector3,
  to: THREE.Vector3,
  material: THREE.Material,
  opts: ChainRunOpts = {},
): THREE.Group {
  const sag = opts.sag ?? 0.12;
  const spacing = opts.spacing ?? 0.085;
  const group = new THREE.Group();

  const length = from.distanceTo(to);
  const count = Math.max(3, Math.round(length / spacing));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y -= sag;   // quadratic-bezier control point below the midpoint

  // One InstancedMesh for the whole run — every link shares LINK_GEO +
  // material, so the chain is a single draw. castShadow stays OFF: a thin
  // link adds nothing readable to the shadow but a cube-map redraw each.
  const mesh = new THREE.InstancedMesh(LINK_GEO, material, count);
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const prev = new THREE.Vector3();
  const cur = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    // Quadratic bezier: (1-t)²·a + 2(1-t)t·c + t²·b — close enough to a
    // catenary at this scale, and cheap.
    const u = 1 - t;
    cur.set(
      u * u * from.x + 2 * u * t * mid.x + t * t * to.x,
      u * u * from.y + 2 * u * t * mid.y + t * t * to.y,
      u * u * from.z + 2 * u * t * mid.z + t * t * to.z,
    );
    // Tangent from the previous sample (first link uses from→cur).
    tangent.subVectors(cur, i === 0 ? from : prev).normalize();
    // The torus lies in its local XY plane; map local +X (a long axis of the
    // ring) onto the tangent so the chain RUNS THROUGH each link, then
    // alternate a 90° roll about the tangent (local X) so consecutive links
    // interlock the way real chain does.
    _q.setFromUnitVectors(_xAxis, tangent);
    if (i % 2 === 1) _q.multiply(_rollX);
    _m.compose(cur, _q, _s);
    mesh.setMatrixAt(i, _m);
    prev.copy(cur);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();   // so frustum culling uses the real extent
  group.add(mesh);
  return group;
}
