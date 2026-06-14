import * as THREE from 'three';
import { groundYAt } from '../level/elevation';

// Ground telegraph for a telegraphed AoE attack (see the 'aoe' ability
// effect). A flat ring marker on the floor at the target spot that
// FILLS toward the centre as the windup completes — when the fill
// reaches the rim, the slam lands. Reads at a glance as "get off this
// spot." Additive + hot red so it cuts through the dark, fog-exempt so
// distance doesn't wash it out.
//
// Lifecycle is owned by the enemy: spawn at windup start, setProgress()
// each windup frame, dispose() at strike (or on death/teardown).

export interface AoeTelegraph {
  setProgress(t: number): void;   // t: 0..1 over the windup
  dispose(): void;
}

const RING_COLOR = 0xff2a14;

// Shared GPU resources — created ONCE, never disposed. Every telegraph reuses
// the same UNIT geometry (scaled by radius per spawn) and CLONES the template
// materials. Clones share the template's compiled program (identical config →
// same program-cache key), and the never-disposed template pins that program,
// so no per-windup geometry/program churn (the leak that climbed over a fight).
let _geo: { ring: THREE.RingGeometry; disc: THREE.CircleGeometry } | null = null;
let _mat: { ring: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial } | null = null;
function shared() {
  if (!_geo) _geo = {
    ring: new THREE.RingGeometry(0.9, 1, 40),   // unit ring: inner 0.9, outer 1 — scale by radius
    disc: new THREE.CircleGeometry(1, 40),       // unit disc — scale by radius·progress
  };
  if (!_mat) {
    const base = {
      color: RING_COLOR, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    } as const;
    _mat = {
      ring: new THREE.MeshBasicMaterial({ ...base, opacity: 0.5 }),
      fill: new THREE.MeshBasicMaterial({ ...base, opacity: 0.0 }),
    };
  }
  return { geo: _geo, mat: _mat };
}

export function spawnAoeTelegraph(
  scene: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
): AoeTelegraph {
  const { geo, mat } = shared();
  const group = new THREE.Group();
  group.position.set(x, groundYAt(x, z) + 0.03, z);   // just above the floor to avoid z-fight
  group.rotation.x = -Math.PI / 2;

  // Per-instance material clones (opacity animates independently per telegraph);
  // they share the template's program, so cloning is a cheap JS object, no compile.
  const ringMat = mat.ring.clone();
  const fillMat = mat.fill.clone();

  // Outer rim — constant outline marking the danger radius. Unit geometry scaled.
  const ring = new THREE.Mesh(geo.ring, ringMat);
  ring.scale.set(radius, radius, 1);
  group.add(ring);

  // Inner fill — a disc that grows from the centre toward the rim as the
  // windup progresses. At full it's the whole radius → impact imminent.
  const fill = new THREE.Mesh(geo.disc, fillMat);
  fill.scale.set(0.001, 0.001, 1);
  group.add(fill);

  scene.add(group);

  let disposed = false;

  return {
    setProgress(t: number) {
      if (disposed) return;
      const c = Math.max(0, Math.min(1, t));
      // Fill grows toward the danger radius + brightens.
      fill.scale.set(c * radius, c * radius, 1);
      fillMat.opacity = 0.10 + 0.30 * c;
      // Rim pulses faster + brighter as impact nears.
      ringMat.opacity = 0.4 + 0.4 * c;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      // Dispose only the CLONED materials — shared geometry + template stay
      // (the template keeps the program alive, so the next spawn won't recompile).
      ringMat.dispose();
      fillMat.dispose();
    },
  };
}
