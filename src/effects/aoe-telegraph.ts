import * as THREE from 'three';

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

export function spawnAoeTelegraph(
  scene: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
): AoeTelegraph {
  const group = new THREE.Group();
  group.position.set(x, 0.03, z);   // just above the floor to avoid z-fight
  group.rotation.x = -Math.PI / 2;

  // Outer rim — constant outline marking the danger radius.
  const ringMat = new THREE.MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.9, radius, 40), ringMat);
  group.add(ring);

  // Inner fill — a disc that grows from the centre toward the rim as the
  // windup progresses. At full it's the whole radius → impact imminent.
  const fillMat = new THREE.MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), fillMat);
  fill.scale.set(0.001, 0.001, 0.001);
  group.add(fill);

  scene.add(group);

  let disposed = false;

  return {
    setProgress(t: number) {
      if (disposed) return;
      const c = Math.max(0, Math.min(1, t));
      // Fill grows + brightens toward the rim.
      fill.scale.set(c, c, 1);
      fillMat.opacity = 0.10 + 0.30 * c;
      // Rim pulses faster + brighter as impact nears.
      ringMat.opacity = 0.4 + 0.4 * c;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      ring.geometry.dispose();
      ringMat.dispose();
      fill.geometry.dispose();
      fillMat.dispose();
    },
  };
}
