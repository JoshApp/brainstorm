import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { WALL_TORCH } from '../content/torch';
import { registerLight, unregisterLight } from './light-pool';

// Wall-mounted torch — visible flame + a logical light source registered
// with the light pool. The pool decides whether this torch is one of the
// N nearest sources and gets a real slot; if not, the flame still renders
// (visual cue), the light just doesn't contribute to fragment shading.
//
// Per-instance state: flicker time, base intensity, flame mesh/material/
// wisp. updateTorchlight() drives the flicker each frame; the pool reads
// torch.currentIntensity via the source's getIntensity callback.

export interface Torch {
  /** World position the pool reads each frame. Same vector as the
   *  registered source's position — never reallocated. */
  position: THREE.Vector3;
  group: THREE.Group;
  flameMaterial: THREE.MeshStandardMaterial;
  flameMesh: THREE.Mesh;
  wispSprite?: THREE.Sprite;
  wispBaseColor?: THREE.Color;
  wispBaseScale?: THREE.Vector3;
  baseIntensity: number;
  baseEmissive: number;
  /** Computed each frame by updateTorchlight; read by the pool via the
   *  source's getIntensity. */
  currentIntensity: number;
  /** Source id for unregistering (level teardown). */
  sourceId: string;
  time: number;
  n1: number;
  n2: number;
  n3: number;
}

let torchSerial = 0;

export function createTorchlight(
  scene: THREE.Object3D,
  position: THREE.Vector3,
  wallYaw: number = 0,
  colorTint?: number,
  intensityMul: number = 1,
): Torch {
  const built = buildModel(WALL_TORCH);
  built.group.position.copy(position);
  built.group.rotation.y = wallYaw;
  scene.add(built.group);

  const flameMaterial = built.materials.get('flame') as THREE.MeshStandardMaterial;
  const flameMesh = built.parts.get('flame') as THREE.Mesh;
  if (!WALL_TORCH.light) {
    throw new Error('WALL_TORCH model is missing its light spec');
  }
  const lightSpec = WALL_TORCH.light;
  const effectiveColor = colorTint ?? lightSpec.color;

  if (colorTint !== undefined) {
    flameMaterial.emissive.setHex(colorTint);
  }

  const baseIntensity = CONFIG.TORCH_INTENSITY * intensityMul;

  const wispSprite = built.parts.get('wisp') as THREE.Sprite | undefined;
  if (wispSprite && colorTint !== undefined) {
    (wispSprite.material as THREE.SpriteMaterial).color.setHex(colorTint);
  }
  const wispBaseColor = wispSprite ? (wispSprite.material as THREE.SpriteMaterial).color.clone() : undefined;
  const wispBaseScale = wispSprite ? wispSprite.scale.clone() : undefined;

  // World position of the actual light: model group position + light's
  // local offset (the torch's flame sits a bit above the bracket). The
  // group's transform is applied here; if the group ever moves (it
  // doesn't), we'd need a per-frame sync.
  const lightLocalPos = new THREE.Vector3();
  if (lightSpec.pos) lightLocalPos.fromArray(lightSpec.pos);
  const worldPos = new THREE.Vector3()
    .copy(position)
    .add(lightLocalPos.applyEuler(new THREE.Euler(0, wallYaw, 0)));

  const torchSourceId = `torch-${torchSerial++}`;

  const torch: Torch = {
    position: worldPos,
    group: built.group,
    flameMaterial,
    flameMesh,
    wispSprite,
    wispBaseColor,
    wispBaseScale,
    baseIntensity,
    baseEmissive: flameMaterial.emissiveIntensity,
    currentIntensity: baseIntensity,
    sourceId: torchSourceId,
    time: 0,
    n1: Math.random() * 1000,
    n2: Math.random() * 1000,
    n3: Math.random() * 1000,
  };

  // Register with the light pool. The pool reads currentIntensity each
  // frame when this torch is one of the N nearest sources.
  registerLight({
    id: torchSourceId,
    category: 'environment',
    position: worldPos,
    color: effectiveColor,
    intensity: baseIntensity,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    getIntensity: () => torch.currentIntensity,
  });

  return torch;
}

/** Tear down — unregister from the light pool. Called by the level
 *  builder's teardown via clearLightPool(). Explicit per-torch
 *  unregister is also available for surgical removes. */
export function destroyTorch(torch: Torch) {
  unregisterLight(torch.sourceId);
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
  const dramatic = Math.max(0, Math.sin((t + n1) * 0.45) - 0.92) * 12;
  const lightFactor = 1 + lFlicker * 0.45 - dramatic * 0.20;
  torch.currentIntensity = Math.max(
    torch.baseIntensity * 0.5,
    torch.baseIntensity * lightFactor,
  );

  // --- VISIBLE FLAME ---
  const fFast = Math.sin((t + n1) * 23) * 0.35;
  const fXfast = Math.sin((t + n2) * 47) * 0.25;
  const fMed = Math.sin((t + n3) * 8) * 0.4;
  const flameFactor = lightFactor + (fFast + fXfast + fMed) * 0.18;
  torch.flameMaterial.emissiveIntensity = Math.max(0.6, torch.baseEmissive * flameFactor);

  let scaleJitter = 1;
  if (torch.flameMesh) {
    scaleJitter = 1 + Math.sin((t + n2) * 14) * 0.08 + Math.sin((t + n3) * 23) * 0.05;
    torch.flameMesh.scale.set(scaleJitter, 1.4 * scaleJitter * (0.9 + Math.sin((t + n1) * 9) * 0.12), scaleJitter);
    torch.flameMesh.position.y = Math.sin((t + n3) * 7) * 0.02 + Math.abs(Math.sin((t + n1) * 11)) * 0.015;
  }

  // --- WISP SPRITE ---
  if (torch.wispSprite && torch.wispBaseColor && torch.wispBaseScale) {
    const wispMat = torch.wispSprite.material as THREE.SpriteMaterial;
    const wispBrightness = Math.max(0.5, Math.min(1.4, flameFactor));
    wispMat.color.copy(torch.wispBaseColor).multiplyScalar(wispBrightness);

    const wispJitter = 1 + (scaleJitter - 1) * 1.6;
    torch.wispSprite.scale.set(
      torch.wispBaseScale.x * wispJitter,
      torch.wispBaseScale.y * wispJitter * (0.95 + Math.sin((t + n1) * 5) * 0.08),
      1,
    );
  }
}
