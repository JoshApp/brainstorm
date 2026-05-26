import * as THREE from 'three';

// Handheld lamp — a warm PointLight parented to the player camera and
// offset to the lower-left as if held in the player's left hand.
//
// Why it exists: even with torches placed along the walls, the corners
// and corridors between torches felt pitch-black. Rather than crank
// global ambient (which flattens the warm/cool mood), the player now
// CARRIES a small reliable light source. This:
//
//   - gives the immediate vicinity consistent visibility everywhere,
//   - reads as "you're a delver with a lantern" not "you have nightvision",
//   - shifts the SHAPE of darkness — distant areas stay murky, close
//     things are always visible, perfect for the mood we want,
//   - flickers subtly so it never feels like a static spot.
//
// Implementation: PointLight attached to the camera as a child. The
// camera is already added to the scene, so its children render. We
// also drift the intensity ±10% on a slow noise so the lamp feels alive.

import { CONFIG } from '../config';

interface LampState {
  light: THREE.PointLight;
  baseIntensity: number;
  flickerT: number;
}

let lamp: LampState | null = null;

export function attachLamp(camera: THREE.Camera) {
  if (lamp) return;
  const light = new THREE.PointLight(
    0xffc488,  // warmer than the orange torch — more "oil lamp", less "bonfire"
    CONFIG.LAMP_INTENSITY,
    CONFIG.LAMP_DISTANCE,
    1.4,       // gentle decay so the lamp lights the immediate floor + walls
  );
  // Offset down and slightly forward + LEFT of the eye, as if held low
  // in the off-hand. The position is in camera-local space so it follows
  // wherever the player looks.
  light.position.set(-0.35, -0.45, -0.3);
  camera.add(light);
  lamp = { light, baseIntensity: CONFIG.LAMP_INTENSITY, flickerT: 0 };
}

/** Per-frame tick. Adds gentle flicker. dt in seconds. */
export function tickLamp(dt: number) {
  if (!lamp) return;
  lamp.flickerT += dt;
  // Three layered sines for organic flicker — never repeats perfectly.
  const f = lamp.flickerT;
  const flicker =
      Math.sin(f * 7.3) * 0.06 +
      Math.sin(f * 13.1) * 0.03 +
      Math.sin(f * 23.7) * 0.02;
  lamp.light.intensity = lamp.baseIntensity * (1 + flicker);
}
