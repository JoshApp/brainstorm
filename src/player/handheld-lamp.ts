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
import { getTexture } from '../style/procedural-textures';

interface FlameSprite {
  sprite: THREE.Sprite;
  baseW: number;
  baseH: number;
  baseY: number;
  speed: number;
  scaleAmp: number;
  bobAmp: number;
  phase: number;
}

interface LampState {
  /** World position vector — mutated each frame from the lantern body's
   *  scene-graph transform. Same vector the light pool reads. */
  worldPos: THREE.Vector3;
  /** Hinge group, child of the camera. Its rotation.z is the swing. */
  hinge: THREE.Group;
  /** Body group, child of hinge. Holds all visible geometry. */
  body: THREE.Group;
  /** Flame-stack sprites — bonfire-style but scaled to lantern size.
   *  Each sprite carries its own flicker schedule so the layers don't
   *  sync. Materials are shared via flameMats so the colour-tone tick
   *  only touches a small set. */
  flameSprites: FlameSprite[];
  flameMats: THREE.SpriteMaterial[];
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

  // ── Flame stack ───────────────────────────────────────────────────
  // Same pattern as the bonfire / candle flame stacks but scaled to
  // lantern-cage size: white-hot core → yellow body → orange tongue
  // → soft warmth haze. All additive sprites on the 'fire-wisp'
  // texture; each layer carries its own flicker rate + phase so they
  // don't pulse together. Sized to fit inside the cage (radius 0.045,
  // bar height 0.10) without clipping through the bars.
  const flameSprites: FlameSprite[] = [];
  const flameMats: THREE.SpriteMaterial[] = [];
  const FLAME_LAYERS: Array<{
    pos: [number, number, number];
    size: [number, number];
    color: number;
    opacity: number;
    flicker: { scale: number; bob: number; speed: number };
  }> = [
    // White-hot core — bright, small, fastest flicker.
    { pos: [0, -0.012, 0], size: [0.032, 0.034], color: 0xffe8b0, opacity: 0.95,
      flicker: { scale: 0.18, bob: 0.004, speed: 3.4 } },
    // Yellow body — slightly taller, slower.
    { pos: [0,  0.000, 0], size: [0.038, 0.052], color: 0xffd070, opacity: 0.85,
      flicker: { scale: 0.22, bob: 0.006, speed: 2.6 } },
    // Orange tongue — tallest layer, lazy bob.
    { pos: [0,  0.012, 0], size: [0.046, 0.068], color: 0xff9040, opacity: 0.65,
      flicker: { scale: 0.26, bob: 0.008, speed: 1.9 } },
    // Outer warmth haze — wide + dim, very slow. Sells "glow filling
    // the cage" without putting bright pixels outside the bars.
    { pos: [0,  0.000, 0], size: [0.090, 0.080], color: 0xc8642a, opacity: 0.40,
      flicker: { scale: 0.10, bob: 0.003, speed: 0.9 } },
  ];
  for (const layer of FLAME_LAYERS) {
    const mat = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      // Match the rest of the viewmodel: paint over world geometry
      // (depthTest off + write off) and sort into the transparent
      // phase so renderOrder beats world-space sprites. The hinge
      // traverse below only handles meshes, so set this here.
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(layer.pos[0], layer.pos[1], layer.pos[2]);
    sprite.scale.set(layer.size[0], layer.size[1], 1);
    sprite.renderOrder = 998;
    body.add(sprite);
    flameMats.push(mat);
    flameSprites.push({
      sprite,
      baseW: layer.size[0],
      baseH: layer.size[1],
      baseY: layer.pos[1],
      speed: layer.flicker.speed,
      scaleAmp: layer.flicker.scale,
      bobAmp: layer.flicker.bob,
      phase: Math.random() * 100,
    });
  }

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
        // WRITE depth (but don't TEST) so the depth-keyed post passes treat
        // the lantern body as foreground, not see-through glass. The flame
        // SPRITES stay depthWrite:false (additive) — the traverse only hits
        // meshes. See the long note in viewmodel.ts.
        m.depthWrite = true;
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
    flameSprites,
    flameMats,
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
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
      mesh.geometry.dispose();
    }
  });
  // Sprite materials aren't caught by the mesh traverse above.
  for (const m of lamp.flameMats) m.dispose();
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

  // Per-sprite flicker — bonfire pattern: two superimposed sines at
  // slightly different rates so each layer wobbles on its own clock,
  // never resyncing. Drives both scale (the flame breathes) and Y bob
  // (the tongue rises + falls slightly inside the cage).
  for (const s of lamp.flameSprites) {
    const omega = (Math.PI * 2) * s.speed;
    const t = lamp.flickerT + s.phase;
    const a = Math.sin(omega * t);
    const b = Math.sin(omega * 1.7 * t + 1.3);
    const wobble = (a * 0.6 + b * 0.4);
    const scale = 1 + wobble * s.scaleAmp;
    s.sprite.scale.set(s.baseW * scale, s.baseH * scale, 1);
    s.sprite.position.y = s.baseY + wobble * s.bobAmp;
  }
}
