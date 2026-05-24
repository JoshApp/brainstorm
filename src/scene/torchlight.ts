import * as THREE from 'three';
import { CONFIG } from '../config';

// Flickering point light + a visible torch object (iron bracket and emissive flame
// sphere) at the same position. The flame's emissive intensity is synced to the
// light's flicker so the visible flame breathes with the cast light.
//
// The torch is mounted to a wall whose inward normal is +Z (i.e. the north wall
// of the room — wall at -Z, light goes into +Z). For other walls, build the
// torch and rotate the group, or extend this with a normal parameter later.

export interface Torch {
  light: THREE.PointLight;
  group: THREE.Group;
  flameMaterial: THREE.MeshStandardMaterial;
  baseIntensity: number;
  baseEmissive: number;
  time: number;
  // Pre-computed noise offsets for layered flicker
  n1: number;
  n2: number;
  n3: number;
}

export function createTorchlight(scene: THREE.Scene, position: THREE.Vector3): Torch {
  // --- The light source ---
  const light = new THREE.PointLight(
    CONFIG.TORCH_COLOR,
    CONFIG.TORCH_INTENSITY,
    CONFIG.TORCH_DISTANCE,
    CONFIG.TORCH_DECAY,
  );
  light.position.copy(position);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.005;
  scene.add(light);

  // --- The visible torch object ---
  // A small iron bracket extending from the wall, with a glowing sphere as the
  // flame at its tip. The whole group is placed at the light's position; the
  // bracket extends back toward -Z (the wall it's mounted on).
  const group = new THREE.Group();
  group.position.copy(position);

  // Bracket — a short dark cylinder from wall to flame
  const bracketMat = new THREE.MeshStandardMaterial({
    color: 0x14110d,
    roughness: 0.85,
    metalness: 0.5,
  });
  const bracketGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6);
  const bracket = new THREE.Mesh(bracketGeo, bracketMat);
  bracket.rotation.x = Math.PI / 2; // align cylinder height with Z axis
  bracket.position.z = -0.15;        // sits between flame (at z=0) and wall (z≈-0.3)
  bracket.castShadow = false;        // don't muddy the shadow with bracket
  group.add(bracket);

  // Flame — emissive sphere. Color matches the light. EmissiveIntensity is
  // updated each frame in sync with the flicker so the flame "breathes."
  const baseEmissive = 3.0;
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffcc88,
    emissive: 0xff8844,
    emissiveIntensity: baseEmissive,
    roughness: 0.4,
    metalness: 0.0,
  });
  const flameGeo = new THREE.SphereGeometry(0.09, 12, 10);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.z = 0;
  flame.castShadow = false;
  group.add(flame);

  scene.add(group);

  return {
    light,
    group,
    flameMaterial: flameMat,
    baseIntensity: CONFIG.TORCH_INTENSITY,
    baseEmissive,
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
  const factor = 1 + flicker * CONFIG.TORCH_FLICKER_AMOUNT - dramatic * 0.4;

  torch.light.intensity = Math.max(0.1, torch.baseIntensity * factor);
  // Visible flame breathes with the light — clamped so it never goes fully dark.
  torch.flameMaterial.emissiveIntensity = Math.max(0.4, torch.baseEmissive * factor);
}
