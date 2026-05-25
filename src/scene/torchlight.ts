import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { WALL_TORCH } from '../content/torch';

// Wall-mounted torch: a point light + a visible bracket + flame mesh, built
// from the WALL_TORCH model spec. Per-instance flicker state (intensity +
// emissive intensity + flame mesh scale/position) is animated each frame by
// updateTorchlight.
//
// Each torch builds its OWN materials (via buildModel) so flames flicker
// independently — different noise offsets per torch produce different fires.

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
  wallYaw: number = 0,  // 0 = north wall (default), Math.PI = south, ±PI/2 = west/east
): Torch {
  const built = buildModel(WALL_TORCH);
  built.group.position.copy(position);
  built.group.rotation.y = wallYaw;
  scene.add(built.group);

  const flameMaterial = built.materials.get('flame') as THREE.MeshStandardMaterial;
  const flameMesh = built.parts.get('flame') as THREE.Mesh;
  if (!built.light) {
    throw new Error('WALL_TORCH model is missing its light spec');
  }

  return {
    light: built.light,
    group: built.group,
    flameMaterial,
    flameMesh,
    baseIntensity: CONFIG.TORCH_INTENSITY,
    baseEmissive: flameMaterial.emissiveIntensity,
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
