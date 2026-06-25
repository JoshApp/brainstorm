import * as THREE from 'three';
import { CONFIG } from '../config';
import { getLampIntensity, getLampWorldPos } from './handheld-lamp';

// LAMP SPOT-SHADOW (?lampspot=1) — the lamp's shadow is the dearest thing in the
// frame: a PointLight casts a CUBE shadow, so the scene renders 6× per frame to
// build it. Split the lamp: a dim omni PointLight (light-pool, shadowless fill)
// + a forward SpotLight that carries the rest AND casts the shadow as a single
// 2D map — 6 passes → 1.
//
// The spot lives in world space (not parented to the camera, which may not be in
// the scene graph): each frame it's placed at the lantern's world position and
// aimed where the player looks (slightly down, to rake the floor + walls ahead).

const LAMP_COLOR = 0xffc488;     // warm oil-lamp tone (matches handheld-lamp)
const SPOT_SHARE = 1.25;         // the spot carries the dominant forward light
const SPOT_ANGLE = 1.15;         // ~66° half-angle — a wide held-lantern cone
const SPOT_PENUMBRA = 0.6;       // soft cone edge
const AIM_AHEAD = 3.0;           // metres ahead the cone is aimed
const AIM_DROP = 1.2;            // metres the aim point sits below eye line

let spot: THREE.SpotLight | null = null;
let target: THREE.Object3D | null = null;
const _origin = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function initLampSpot(scene: THREE.Scene): void {
  if (spot) return;
  spot = new THREE.SpotLight(LAMP_COLOR, CONFIG.LAMP_INTENSITY, CONFIG.LAMP_DISTANCE, SPOT_ANGLE, SPOT_PENUMBRA, 1.4);
  spot.castShadow = true;
  spot.shadow.mapSize.set(512, 512);
  spot.shadow.camera.near = 0.15;
  spot.shadow.camera.far = CONFIG.LAMP_DISTANCE;
  spot.shadow.bias = -0.0005;
  spot.shadow.normalBias = 0.04;
  target = new THREE.Object3D();
  spot.target = target;
  scene.add(spot);
  scene.add(target);
}

/** Place + aim the spot from the lamp + camera each frame; track the flicker. */
export function tickLampSpot(camera: THREE.Camera): void {
  if (!spot || !target) return;
  // Origin: the swinging lantern (fall back to the camera if unattached).
  const lp = getLampWorldPos(_origin) ?? camera.getWorldPosition(_origin);
  spot.position.copy(lp);
  // Aim: a point ahead of the camera, dropped so the cone rakes the floor/walls.
  camera.getWorldPosition(_camPos);
  camera.getWorldDirection(_fwd);
  target.position.copy(_camPos).addScaledVector(_fwd, AIM_AHEAD);
  target.position.y -= AIM_DROP;
  spot.intensity = getLampIntensity() * SPOT_SHARE;
}
