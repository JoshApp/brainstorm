import * as THREE from 'three';
import { CONFIG } from '../config';

// Flickering point light. The flicker is the soul of the atmosphere.
// It uses layered noise so it feels organic, not periodic.

export interface Torch {
  light: THREE.PointLight;
  baseIntensity: number;
  time: number;
  // Pre-computed noise offsets for layered flicker
  n1: number;
  n2: number;
  n3: number;
}

export function createTorchlight(scene: THREE.Scene, position: THREE.Vector3): Torch {
  const light = new THREE.PointLight(
    CONFIG.TORCH_COLOR,
    CONFIG.TORCH_INTENSITY,
    CONFIG.TORCH_DISTANCE,
    CONFIG.TORCH_DECAY
  );
  light.position.copy(position);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.005;
  scene.add(light);

  return {
    light,
    baseIntensity: CONFIG.TORCH_INTENSITY,
    time: 0,
    n1: Math.random() * 1000,
    n2: Math.random() * 1000,
    n3: Math.random() * 1000,
  };
}

export function updateTorchlight(torch: Torch, dt: number) {
  torch.time += dt;

  // Three layers of sin with different frequencies = organic-feeling flicker.
  // Plus occasional deeper dimming for that "wind through the corridor" feel.
  const t = torch.time;
  const fast = Math.sin((t + torch.n1) * 11) * 0.3;
  const med = Math.sin((t + torch.n2) * 4.3) * 0.4;
  const slow = Math.sin((t + torch.n3) * 1.7) * 0.3;

  // Occasional dramatic dim — feels like a draft hitting the flame
  const dramatic = Math.max(0, Math.sin((t + torch.n1) * 0.7) - 0.8) * 4;

  const flicker = (fast + med + slow) / 3;
  const intensity = torch.baseIntensity * (1 + flicker * CONFIG.TORCH_FLICKER_AMOUNT - dramatic * 0.4);

  torch.light.intensity = Math.max(0.1, intensity);
}
