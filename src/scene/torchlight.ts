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
  flameMesh: THREE.Mesh;
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
  wallYaw: number = 0,  // 0 = north wall (default), Math.PI = south, ±PI/2 = west/east
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
  group.rotation.y = wallYaw;

  const bracketGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6);
  const bracket = new THREE.Mesh(bracketGeo, materials.torchBracket);
  bracket.rotation.x = Math.PI / 2;
  bracket.position.z = -0.15;
  bracket.castShadow = false;
  group.add(bracket);

  const flameMat = materials.torchFlame;
  const baseEmissive = flameMat.emissiveIntensity;
  // Bigger, elongated flame so it reads as fire at low render resolution.
  const flameGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.scale.set(1.0, 1.4, 1.0); // teardrop, taller than wide
  flame.position.z = 0;
  flame.castShadow = false;
  group.add(flame);

  scene.add(group);

  return {
    light,
    group,
    flameMaterial: flameMat,
    flameMesh: flame,
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
  const { n1, n2, n3 } = torch;

  // --- CAST LIGHT (intensity) ---
  // Gentle layered flicker, never blacks out. Floor clamped at 50% of base
  // so the room stays readable even when the dramatic dim peaks.
  const lFast = Math.sin((t + n1) * 11) * 0.25;
  const lMed = Math.sin((t + n2) * 4.3) * 0.35;
  const lSlow = Math.sin((t + n3) * 1.7) * 0.25;
  const lFlicker = (lFast + lMed + lSlow) / 3;

  // Dramatic dim — rarer (threshold 0.92, period ~14s) and less severe.
  const dramatic = Math.max(0, Math.sin((t + n1) * 0.45) - 0.92) * 12;
  const lightFactor = 1 + lFlicker * 0.45 - dramatic * 0.20;
  torch.light.intensity = Math.max(torch.baseIntensity * 0.5, torch.baseIntensity * lightFactor);

  // --- VISIBLE FLAME ---
  // More aggressive flicker on the flame's emissive + small scale jitter +
  // tiny vertical bob, so the eye sees a *live fire* not a static dot.
  const fFast = Math.sin((t + n1) * 23) * 0.35;
  const fXfast = Math.sin((t + n2) * 47) * 0.25;
  const fMed = Math.sin((t + n3) * 8) * 0.4;
  const flameFactor = lightFactor + (fFast + fXfast + fMed) * 0.18;
  torch.flameMaterial.emissiveIntensity = Math.max(0.6, torch.baseEmissive * flameFactor);

  if (torch.flameMesh) {
    // Scale jitter — flame swells and shrinks rapidly
    const scaleJitter = 1 + Math.sin((t + n2) * 14) * 0.08 + Math.sin((t + n3) * 23) * 0.05;
    torch.flameMesh.scale.set(scaleJitter, 1.4 * scaleJitter * (0.9 + Math.sin((t + n1) * 9) * 0.12), scaleJitter);
    // Vertical bob — flame "leaps up" slightly
    torch.flameMesh.position.y = Math.sin((t + n3) * 7) * 0.02 + Math.abs(Math.sin((t + n1) * 11)) * 0.015;
  }
}
