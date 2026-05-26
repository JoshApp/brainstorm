import * as THREE from 'three';

// Handheld lamp — a small lantern model parented to the player camera
// at the LEFT-hand mirror of the sword's right-hand position. Holds a
// warm flickering PointLight inside its cage so the lamp visibly is
// the source of the light.
//
// Why this exists: even with torches placed along walls, corners and
// corridors between torches felt pitch-black. Rather than crank global
// ambient (which flattens the warm/cool mood), the player CARRIES a
// small reliable light source. The visible lantern model on top of
// the light sells the "you're a delver with a lantern" read — it's
// not nightvision, it's a thing you brought.

import { CONFIG } from '../config';

interface LampState {
  light: THREE.PointLight;
  flame: THREE.Mesh;          // small bright sphere; flicker also modulates this
  flameMat: THREE.MeshBasicMaterial;
  baseIntensity: number;
  flickerT: number;
}

let lamp: LampState | null = null;

// Position mirrors the sword's bottom-RIGHT viewmodel offset. The
// lantern hangs at the bottom-LEFT of the player's view, swinging
// loosely (no animation yet — could add a sway later).
const LAMP_LOCAL = new THREE.Vector3(-0.35, -0.32, -0.55);
const LAMP_COLOR = 0xffc488;  // warm oil-lamp tone

export function attachLamp(camera: THREE.Camera) {
  if (lamp) return;

  // ── Lantern geometry ──────────────────────────────────────────────
  const group = new THREE.Group();
  group.position.copy(LAMP_LOCAL);

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
    group.add(bar);
  }

  // Top + bottom plates connecting the cage.
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.045, 0.015, 8),
    ironMat,
  );
  top.position.y = barH / 2 + 0.005;
  group.add(top);

  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.052, 0.015, 8),
    ironMat,
  );
  bottom.position.y = -barH / 2 - 0.005;
  group.add(bottom);

  // Small upright post + ring for the handle.
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6),
    ironMat,
  );
  post.position.y = barH / 2 + 0.035;
  group.add(post);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.018, 0.005, 4, 8),
    ironMat,
  );
  ring.position.y = barH / 2 + 0.058;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

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
  group.add(flame);

  // ── Viewmodel rendering ───────────────────────────────────────────
  // depthTest off + high renderOrder so the lantern always paints over
  // world geometry — matches how the sword viewmodel handles it (no
  // close walls clip through the lantern).
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m.depthTest = false;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
      mesh.renderOrder = 998;  // just under the sword (999)
    }
  });

  camera.add(group);

  // ── The actual PointLight ─────────────────────────────────────────
  // Lives INSIDE the lantern cage so the flame mesh appears to be the
  // source. Light is what reaches the world (the viewmodel-only flame
  // mesh doesn't, since depthTest=false makes it an overlay).
  const light = new THREE.PointLight(
    LAMP_COLOR,
    CONFIG.LAMP_INTENSITY,
    CONFIG.LAMP_DISTANCE,
    1.4,
  );
  // Anchor to the lantern's world position by parenting under group.
  light.position.set(0, -0.005, 0);  // inside the cage, at flame center
  group.add(light);

  lamp = { light, flame, flameMat, baseIntensity: CONFIG.LAMP_INTENSITY, flickerT: 0 };
}

/** Per-frame tick. Layered-sine flicker on intensity + flame brightness. */
export function tickLamp(dt: number) {
  if (!lamp) return;
  lamp.flickerT += dt;
  const f = lamp.flickerT;
  // Three layered sines — never repeats, never feels mechanical.
  const flicker =
      Math.sin(f * 7.3) * 0.06 +
      Math.sin(f * 13.1) * 0.03 +
      Math.sin(f * 23.7) * 0.02;
  lamp.light.intensity = lamp.baseIntensity * (1 + flicker);
  // Mirror the flicker in the flame's visible color so eye + light agree.
  const tone = 1 + flicker * 0.5;
  lamp.flameMat.color.setRGB(
    1.0 * tone,
    0.77 * tone,
    0.53 * tone,
  );
}
