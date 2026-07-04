import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildModel } from '../ecs/build-model';
import type { BatchedSprite } from './sprite-batch';
import { WALL_TORCH } from '../content/torch';
import { applyMoodTint } from '../level/mood-tint';
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
  /** Set instead of wispSprite when the wisp went into the instanced sprite
   *  batch (scene/sprite-batch.ts) — the flicker writes the handle's live
   *  color/scaleMul instead of a SpriteMaterial. */
  wispBatched?: BatchedSprite;
  wispBaseColor?: THREE.Color;
  wispBaseScale?: THREE.Vector3;
  /** The flame's draw-only children (emissive mesh + additive sprite stack) —
   *  toggled by distance for the fog-fade cull. NOT the static sconce (merged
   *  out) nor the group (the room-culler owns that). */
  flameVisuals?: THREE.Object3D[];
  baseIntensity: number;
  baseEmissive: number;
  /** Computed each frame by updateTorchlight; read by the pool via the
   *  source's getIntensity. */
  currentIntensity: number;
  /** External per-torch brightness multiplier, layered on top of the live
   *  flicker (the source's getIntensity returns currentIntensity * envBoost).
   *  1 = untouched. The arena light-arc drives this to dim → surge → hold →
   *  exhale a room's torches around an encounter; flicker survives underneath
   *  and the global env multiplier still composes on top in the pool. */
  envBoost: number;
  /** Source id for unregistering (level teardown). */
  sourceId: string;
  /** The actual LightSource object registered with the light pool — the
   *  pool reads `.color` each frame, so mutating it from outside (e.g.
   *  the room-mood blender) recolours the live light without re-register.
   *  Same reference as what was passed to registerLight; never re-pointed. */
  source: { color: number };
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
  // batchSprites: the wisp + flame-tongue stack fold into the instanced
  // sprite batch (one draw per texture floor-wide instead of one per sprite).
  const built = buildModel(fixtureModel, { batchSprites: true });
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

  // Tint through the canonical fixture-retint (mood-tint.ts): it
  // recolours the flame-family materials AND every additive sprite in
  // the stack (swapping the warm-baked fire-wisp gradient for the
  // neutral one). The old partial retint here only touched the
  // 'flame' material + one wisp — sprite-stack fixtures (wall
  // cressets, 25% of wall rolls) kept their default ORANGE flames, so
  // pale/violet rooms showed tinted torches beside neutral cressets.
  if (colorTint !== undefined) applyMoodTint(built, colorTint);

  const baseIntensity = lightSpec.intensity * intensityMul;

  const wispPart = built.parts.get('wisp');
  const wispBatched = wispPart?.userData.batchedSprite as BatchedSprite | undefined;
  const wispSprite = !wispBatched ? (wispPart as THREE.Sprite | undefined) : undefined;
  const wispBaseColor = wispBatched ? wispBatched.color.clone()
    : wispSprite ? (wispSprite.material as THREE.SpriteMaterial).color.clone() : undefined;
  const wispBaseScale = wispSprite ? wispSprite.scale.clone() : undefined;
  // Collect the flame's draw-only children — every Sprite / batched-sprite
  // placeholder (wisp + flame-tongue stack) plus the named 'flame' mesh — for
  // the distance fog-cull. The static sconce meshes get merged out by
  // batchStaticFixtures; sprites + 'flame' are skipped by that merge, so these
  // refs stay valid. Toggling a placeholder's `visible` hides its batch
  // instance (the batch walks the parent chain).
  const flameVisuals: THREE.Object3D[] = [];
  built.group.traverse((o) => {
    const isSprite = (o as unknown as { isSprite?: boolean }).isSprite === true;
    if (isSprite || o.name === 'flame' || o.userData.batchedSprite) flameVisuals.push(o);
  });

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
    wispBatched,
    wispBaseColor,
    wispBaseScale,
    flameVisuals,
    baseIntensity,
    baseEmissive: flameMaterial?.emissiveIntensity ?? 0,
    currentIntensity: baseIntensity,
    envBoost: 1,
    sourceId: torchSourceId,
    source: { color: 0 },   // re-pointed below right after registerLight()
    time: 0,
    n1: Math.random() * 1000,
    n2: Math.random() * 1000,
    n3: Math.random() * 1000,
  };

  // Register with the light pool. The pool reads currentIntensity each
  // frame when this torch is one of the N nearest sources. Source is held
  // by reference so room-mood can mutate `.color` to re-tint the torch live.
  const source = {
    id: torchSourceId,
    category: 'environment' as const,
    position: worldPos,
    color: effectiveColor,
    intensity: baseIntensity,
    distance: CONFIG.TORCH_DISTANCE,
    decay: CONFIG.TORCH_DECAY,
    getIntensity: () => torch.currentIntensity * torch.envBoost,
  };
  registerLight(source);
  torch.source = source;

  return torch;
}

/** Tear down — unregister from the light pool. Called by the level
 *  builder's teardown via clearLightPool(). Explicit per-torch
 *  unregister is also available for surgical removes. */
export function destroyTorch(torch: Torch) {
  unregisterLight(torch.sourceId);
}

// Distance past which a torch's VISIBLE flame (the emissive mesh + its additive
// sprite stack) stops drawing. The flame sprites set fog:false so they glow AS
// the torch — but that means past the fog wall they shine through solid black:
// a visual bug AND wasted additive fill/draws for revealed-but-fogged rooms
// down a corridor. By ~11m the fog (opaque at FOG_FAR=9) is ~99% black, so
// dropping the flame there is imperceptible. We toggle the flame CHILDREN (mesh
// + sprites), not group.visible — the room-culler owns the group's visibility
// (per-room), so the two compose: a torch shows only if its room is in view AND
// it's within range. The torch's LIGHT is a separate pool slot, unaffected.
const FLAME_CULL_DIST = (CONFIG.FOG_FAR + CONFIG.CAMERA_FAR) / 2;   // ~11m, deep in the fog

export function updateTorchlight(torch: Torch, dt: number, camDist?: number) {
  // Flame visibility by distance (composes with the room-culler's group toggle).
  if (camDist !== undefined && torch.flameVisuals) {
    const show = camDist < FLAME_CULL_DIST;
    for (const v of torch.flameVisuals) if (v.visible !== show) v.visible = show;
  }
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
  if (torch.wispBatched && torch.wispBaseColor) {
    // Batched wisp: same flicker, written to the instance handle instead of a
    // SpriteMaterial — the batch uploads it with everyone else's this frame.
    const wispBrightness = Math.max(0.5, Math.min(1.4, flameFactor));
    torch.wispBatched.color.copy(torch.wispBaseColor).multiplyScalar(wispBrightness);
    const wispJitter = 1 + (scaleJitter - 1) * 1.6;
    torch.wispBatched.scaleMul.set(
      wispJitter,
      wispJitter * (0.95 + Math.sin((t + n1) * 5) * 0.08),
    );
  } else if (torch.wispSprite && torch.wispBaseColor && torch.wispBaseScale) {
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
