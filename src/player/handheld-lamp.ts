import * as THREE from 'three';

// Handheld lamp — a small lantern model parented to the player camera
// at the LEFT-hand mirror of the sword's right-hand position. Holds a
// warm flickering PointLight inside its cage so the lamp visibly is
// the source of the light.
//
// Scene-graph shape (matters for the pendulum):
//
//   camera
//     └ hinge      ← positioned at the lantern's HANDLE.
//                    rotation.z is the pendulum angle.
//        └ body    ← offset DOWN from hinge by ~the cage height
//                    so the lantern visibly hangs below the pivot.
//                    All cage + flame meshes live here.
//
// When the hinge rotates, the body swings around the handle in a real
// pendulum arc — no manual parametric-arc math needed in the tick.

import { CONFIG } from '../config';
import { registerLight, unregisterLight } from '../scene/light-pool';
import { getLanternSwing } from './viewmodel-bob';

interface LampState {
  /** World position vector — mutated each frame from the lantern body's
   *  scene-graph transform. Same vector the light pool reads. */
  worldPos: THREE.Vector3;
  /** Hinge group, child of the camera. Its rotation.z is the swing. */
  hinge: THREE.Group;
  /** Body group, child of hinge. Holds all visible geometry. */
  body: THREE.Group;
  flameMat: THREE.MeshBasicMaterial;
  baseIntensity: number;
  /** Computed each frame by tickLamp; pool reads via getIntensity. */
  currentIntensity: number;
  flickerT: number;
}

let lamp: LampState | null = null;

// HINGE position — where the pendulum's pivot sits. Higher up than the
// old single-group origin so the lantern hangs visibly BELOW it.
const HINGE_LOCAL = new THREE.Vector3(-0.34, -0.066, -0.55);
// Body offset DOWN from the hinge (in scaled body local). Tuned so the
// visible centre of the lantern lands roughly where the old single
// group sat (~y = -0.26 worldspace at scale 1.8).
const BODY_OFFSET_Y = -0.108;
const LAMP_COLOR = 0xffc488;  // warm oil-lamp tone

export function attachLamp(camera: THREE.Camera) {
  if (lamp) return;

  // ── Hinge + body groups ───────────────────────────────────────────
  // Hinge owns the position + scale; rotation drives the pendulum.
  // Body is the visible lantern, hanging below the hinge.
  const hinge = new THREE.Group();
  hinge.position.copy(HINGE_LOCAL);
  hinge.scale.setScalar(1.8);
  camera.add(hinge);

  const body = new THREE.Group();
  body.position.y = BODY_OFFSET_Y;
  hinge.add(body);

  // Iron parts — dark metal with a slight emissive baseline so the
  // lantern reads even in pitch-black areas.
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1a1410,
    metalness: 0.7,
    roughness: 0.45,
    emissive: 0x2a1a08,
    emissiveIntensity: 0.5,
    fog: false,
    flatShading: true,
  });

  // 4 vertical bars forming a cage so the flame inside shines through.
  const barH = 0.10;
  const cageRadius = 0.045;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, barH, 0.01),
      ironMat,
    );
    bar.position.set(Math.cos(a) * cageRadius, 0, Math.sin(a) * cageRadius);
    body.add(bar);
  }

  // Top + bottom plates connecting the cage.
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.045, 0.015, 8),
    ironMat,
  );
  top.position.y = barH / 2 + 0.005;
  body.add(top);

  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.052, 0.015, 8),
    ironMat,
  );
  bottom.position.y = -barH / 2 - 0.005;
  body.add(bottom);

  // Small upright post + ring for the handle. Sits at the body's top —
  // visually right under the hinge so the pendulum looks chained to it.
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6),
    ironMat,
  );
  post.position.y = barH / 2 + 0.035;
  body.add(post);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.018, 0.005, 4, 8),
    ironMat,
  );
  ring.position.y = barH / 2 + 0.058;
  ring.rotation.x = Math.PI / 2;
  body.add(ring);

  // ── Flame ─────────────────────────────────────────────────────────
  // Small bright sphere inside the cage. MeshBasic so it ignores
  // lighting (it IS the light source, doesn't need to be lit by torches).
  const flameMat = new THREE.MeshBasicMaterial({
    color: LAMP_COLOR,
    fog: false,
  });
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 10, 8),
    flameMat,
  );
  flame.position.y = -0.005;
  body.add(flame);

  // ── Viewmodel rendering ───────────────────────────────────────────
  // depthTest off + high renderOrder so the lantern always paints over
  // world geometry — matches how the sword viewmodel handles it (no
  // close walls clip through the lantern). Traverse from the hinge so
  // every child gets the same treatment.
  hinge.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m.depthTest = false;
        m.depthWrite = false;
        // Sort into the transparent phase so renderOrder 998 actually
        // wins against world-space transparent sprites — see the same
        // pattern in sword.ts for the long version of why.
        m.transparent = true;
        m.needsUpdate = true;
      }
      mesh.renderOrder = 998;  // just under the sword (999)
    }
  });

  // ── Logical light source via the pool ──────────────────────────────
  // The lantern doesn't own a THREE.PointLight directly — every
  // PointLight in the scene is owned by src/scene/light-pool.ts. We
  // expose a position vector + dynamic intensity, and the pool decides
  // each frame whether to bind us to one of its slots. Persistent=true
  // so we survive level swaps (camera-attached, no level scope).
  //
  // The worldPos is read from the BODY's matrixWorld so the light
  // tracks the swinging lantern, not the static hinge.
  const worldPos = new THREE.Vector3();
  const state: LampState = {
    worldPos,
    hinge,
    body,
    flameMat,
    baseIntensity: CONFIG.LAMP_INTENSITY,
    currentIntensity: CONFIG.LAMP_INTENSITY,
    flickerT: 0,
  };
  lamp = state;

  registerLight({
    id: 'player-lamp',
    category: 'lamp',  // own dedicated slot — never crowded out
    position: worldPos,
    color: LAMP_COLOR,
    intensity: CONFIG.LAMP_INTENSITY,
    distance: CONFIG.LAMP_DISTANCE,
    decay: 1.4,
    getIntensity: () => state.currentIntensity,
    persistent: true,
  });
}

/** Remove the lamp viewmodel + unregister its light. Idempotent. */
export function detachLamp() {
  if (!lamp) return;
  lamp.hinge.parent?.remove(lamp.hinge);
  unregisterLight('player-lamp');
  // Dispose so we don't leak GPU memory when the player swaps offhand
  // back and forth between lamp and shield.
  lamp.hinge.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
    mesh.geometry.dispose();
  });
  lamp = null;
}

/** Per-frame tick. Layered-sine flicker on intensity + flame brightness,
 *  plus pendulum swing on the hinge. */
export function tickLamp(dt: number) {
  if (!lamp) return;
  lamp.flickerT += dt;
  const f = lamp.flickerT;
  // Three layered sines — never repeats, never feels mechanical.
  const flicker =
      Math.sin(f * 7.3) * 0.06 +
      Math.sin(f * 13.1) * 0.03 +
      Math.sin(f * 23.7) * 0.02;
  lamp.currentIntensity = lamp.baseIntensity * (1 + flicker);

  // Pendulum swing — rotation on the hinge. Body is a child offset
  // downward, so rotating the hinge automatically swings the body
  // around the handle in a true pendulum arc.
  lamp.hinge.rotation.z = getLanternSwing();

  // Update the light's world position from the BODY's transform — the
  // light should track the visibly-swinging lantern, not the static
  // hinge. updateMatrixWorld(true) flushes the camera-parented chain
  // since it may not have updated yet this frame.
  lamp.body.updateMatrixWorld(true);
  lamp.worldPos.setFromMatrixPosition(lamp.body.matrixWorld);

  // Mirror the flicker in the flame's visible color so eye + light agree.
  const tone = 1 + flicker * 0.5;
  lamp.flameMat.color.setRGB(
    1.0 * tone,
    0.77 * tone,
    0.53 * tone,
  );
}
