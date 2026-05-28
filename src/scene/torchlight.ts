import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import { WALL_TORCH } from '../content/torch';
import { registerLight, unregisterLight } from './light-pool';
import type { ModelSpec } from '../ecs/model-types';

// Wall-mounted lit fixture — torch, wall cresset, or any future
// drop-in wall-light ModelSpec. Visible flame + a logical light
// source registered with the light pool.
//
// The fixture model is passed in by the caller (default WALL_TORCH for
// backwards compat with code that hasn't migrated yet). If the model
// has a 'flame' part + 'flame' material, the per-frame tick wobbles
// them like the classic torch does. If those parts are absent (the
// wall cresset uses a sprite-stack flame instead), the per-mesh
// flicker is skipped — the model's own sprite flicker handles the
// "alive" work. Either way the light's intensity flickers, so the
// scene shading reads as torch-class.

export interface Torch {
  /** World position the pool reads each frame. Same vector as the
   *  registered source's position — never reallocated. */
  position: THREE.Vector3;
  group: THREE.Group;
  /** Present for fixtures that have a named 'flame' part (classic
   *  torch). Absent for sprite-stack fixtures (wall cresset). */
  flameMaterial?: THREE.MeshStandardMaterial;
  flameMesh?: THREE.Mesh;
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
  fixtureModel: ModelSpec = WALL_TORCH,
): Torch {
  const built = buildModel(fixtureModel);
  built.group.position.copy(position);
  built.group.rotation.y = wallYaw;
  scene.add(built.group);

  // 'flame' part + material are OPTIONAL — sprite-stack fixtures don't
  // have them. The per-frame tick checks for their presence before
  // mutating, so undefined here is fine.
  const flameMaterial = built.materials.get('flame') as THREE.MeshStandardMaterial | undefined;
  const flameMesh = built.parts.get('flame') as THREE.Mesh | undefined;
  if (!fixtureModel.light) {
    throw new Error(`${fixtureModel.id} is missing its light spec`);
  }
  const lightSpec = fixtureModel.light;
  const effectiveColor = colorTint ?? lightSpec.color;

  if (flameMaterial && colorTint !== undefined) {
    flameMaterial.emissive.setHex(colorTint);
  }

  const baseIntensity = lightSpec.intensity * intensityMul;

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
    baseEmissive: flameMaterial?.emissiveIntensity ?? 0,
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
  // Only fixtures with a named 'flame' MESH + material get the per-
  // frame emissive/scale wobble (classic torch). Sprite-stack
  // fixtures (wall cresset) skip this branch entirely — their
  // sprites flicker via the built-in ModelSpec flicker hook.
  const fFast = Math.sin((t + n1) * 23) * 0.35;
  const fXfast = Math.sin((t + n2) * 47) * 0.25;
  const fMed = Math.sin((t + n3) * 8) * 0.4;
  const flameFactor = lightFactor + (fFast + fXfast + fMed) * 0.18;
  if (torch.flameMaterial) {
    torch.flameMaterial.emissiveIntensity = Math.max(0.6, torch.baseEmissive * flameFactor);
  }

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
