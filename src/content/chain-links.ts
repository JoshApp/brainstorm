import * as THREE from 'three';

// Chain runs built from actual LINKS — interlocking low-poly tori
// along a sagging curve — replacing the straight-box "chains" that
// read as girders. One shared geometry instance for every link, so a
// 30-link run costs one allocation; the material is the caller's (it
// usually wants the chain in its fade-out rig).

const LINK_GEO = new THREE.TorusGeometry(0.055, 0.016, 6, 10);

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
    const link = new THREE.Mesh(LINK_GEO, material);
    link.position.copy(cur);
    // The torus lies in its local XY plane; map local +X (a long axis
    // of the ring) onto the tangent so the chain RUNS THROUGH each
    // link, then alternate a 90° roll about the tangent (local X) so
    // consecutive links interlock the way real chain does. Mapping +Z
    // instead threads the links ON the chain like beads — donuts on a
    // rope, the wrong read.
    link.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    link.rotateX(i % 2 === 0 ? 0 : Math.PI / 2);
    link.scale.set(1.35, 0.95, 1);   // stretch each ring into a link oval
    link.castShadow = true;
    group.add(link);
    prev.copy(cur);
  }
  return group;
}
