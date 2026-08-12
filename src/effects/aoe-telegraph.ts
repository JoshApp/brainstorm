import * as THREE from 'three';
import { groundYAt } from '../level/elevation';
import { acquireClone, releaseClone } from '../scene/effect-clone-pool';
import { registerWarmup } from '../content/warmup-registry';

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
  /** Re-anchor the ring mid-windup. Needed for a SELF-origin telegraph on a
   *  caster that is still moving — a bomb that walks toward you while its
   *  blast radius stays painted where it armed is a telegraph that lies, and
   *  the whole contract of this system (abilities.ts header) is that the tell
   *  and the thing it predicts can't drift apart. Static targets never call it. */
  moveTo(x: number, z: number): void;
  dispose(): void;
}

const RING_COLOR = 0xff2a14;

// Shared GPU resources — created ONCE, never disposed. Every telegraph reuses
// the same UNIT geometry (scaled by radius per spawn) and ACQUIRES its material
// clones from the effect-clone-pool (recycled, never disposed — on WebGPU a
// disposed last clone releases the pipeline + node-builder state, and the next
// cast recompiles mid-fight; see scene/effect-clone-pool.ts).
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

// Warm the telegraph's two pipelines at boot. clear() releases the clones to
// the pool (never disposes), so the boot compile stays pinned for the session
// — the first mid-fight AoE windup reuses it instead of compiling in-play.
let _warmAoe: AoeTelegraph | null = null;
registerWarmup({
  label: 'aoe-telegraph',
  spawn: (s) => { _warmAoe = spawnAoeTelegraph(s, 0, 0, 0.5); _warmAoe.setProgress(0.5); },
  clear: () => { _warmAoe?.dispose(); _warmAoe = null; },
});

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

  // Per-instance material clones (opacity animates independently per telegraph),
  // recycled through the pool. Reset the animated fields — a recycled clone
  // carries its previous windup's values.
  const ringMat = acquireClone(mat.ring);
  const fillMat = acquireClone(mat.fill);
  ringMat.opacity = 0.4;
  fillMat.opacity = 0.0;

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
    moveTo(nx: number, nz: number) {
      if (disposed) return;
      group.position.set(nx, groundYAt(nx, nz) + 0.03, nz);
    },
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
      // RELEASE the clones back to the pool — never dispose (disposing the last
      // live clone would release the pipeline; the next windup would recompile).
      releaseClone(mat.ring, ringMat);
      releaseClone(mat.fill, fillMat);
    },
  };
}
