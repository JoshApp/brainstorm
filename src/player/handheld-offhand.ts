import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import type { ModelSpec } from '../ecs/model-types';

// Generic offhand viewmodel — a model parented to the camera at the
// off-hand position (mirror of the sword). Used for shields and any
// future offhand item that just needs to BE visible.
//
// The lamp is the one exception — it's built inline in handheld-lamp.ts
// because it also owns a registered light source + flicker logic. Main
// orchestrates: when the offhand slot equips the lamp, call attachLamp;
// for anything else, call attachOffhandViewmodel here.

let group: THREE.Group | null = null;

// Mirror of the sword's bottom-right offhand position. Slightly larger
// scale + a small inward yaw so a held shield reads as "raised toward
// the world" instead of facing the camera flat-on.
const OFFHAND_LOCAL = new THREE.Vector3(-0.32, -0.28, -0.55);
const OFFHAND_SCALE = 0.85;
const OFFHAND_ROT_Y = -0.30;

/** Build the spec into a viewmodel and parent it to the camera. If
 *  another offhand viewmodel is currently attached, it's detached
 *  first — only one at a time. */
export function attachOffhandViewmodel(camera: THREE.Camera, spec: ModelSpec) {
  detachOffhandViewmodel();
  const built = buildModel(spec);
  group = built.group;
  group.position.copy(OFFHAND_LOCAL);
  group.scale.setScalar(OFFHAND_SCALE);
  group.rotation.set(0, OFFHAND_ROT_Y, 0);
  // Same depthTest-off + high-renderOrder trick the sword + lamp use so
  // the viewmodel never clips into nearby walls and always paints over
  // world geometry. See sword.ts for the long explanation.
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = true;
      m.needsUpdate = true;
    }
    mesh.renderOrder = 998;   // just under the sword (999), same as the lamp
  });
  camera.add(group);
}

/** Detach the current offhand viewmodel and dispose. Idempotent. */
export function detachOffhandViewmodel() {
  if (!group) return;
  group.parent?.remove(group);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
    mesh.geometry.dispose();
  });
  group = null;
}
