import * as THREE from 'three';
import { CONFIG } from '../config';
import type { StyleMaterials } from '../style/materials';

// Flickering point light + a visible torch object (iron bracket and emissive
// flame sphere) at the same position. The flame's emissive intensity is synced
// to the light's flicker so the visible flame breathes with the cast light.
//
// Materials come from the style library so the bracket can be re-skinned per
// art style without duplicating logic.

export interface Torch {
  light: THREE.PointLight;
  group: THREE.Group;
  flameMaterial: THREE.MeshStandardMaterial;
  baseIntensity: number;
  baseEmissive: number;
  time: number;
  n1: number;
  n2: number;
  n3: number;
}

export function createTorchlight(
  scene: THREE.Scene,
  position: THREE.Vector3,
  materials: StyleMaterials,
): Torch {
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

  const group = new THREE.Group();
  group.position.copy(position);

  const bracketGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6);
  const bracket = new THREE.Mesh(bracketGeo, materials.torchBracket);
  bracket.rotation.x = Math.PI / 2;
  bracket.position.z = -0.15;
  bracket.castShadow = false;
  group.add(bracket);

  const flameMat = materials.torchFlame;
  const baseEmissive = flameMat.emissiveIntensity;
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

  const t = torch.time;
  const fast = Math.sin((t + torch.n1) * 11) * 0.3;
  const med = Math.sin((t + torch.n2) * 4.3) * 0.4;
  const slow = Math.sin((t + torch.n3) * 1.7) * 0.3;

  const dramatic = Math.max(0, Math.sin((t + torch.n1) * 0.7) - 0.8) * 4;

  const flicker = (fast + med + slow) / 3;
  const factor = 1 + flicker * CONFIG.TORCH_FLICKER_AMOUNT - dramatic * 0.4;

  torch.light.intensity = Math.max(0.1, torch.baseIntensity * factor);
  torch.flameMaterial.emissiveIntensity = Math.max(0.4, torch.baseEmissive * factor);
}
