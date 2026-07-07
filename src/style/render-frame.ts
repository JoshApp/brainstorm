import * as THREE from 'three';
import { renderWebGPU, setWebGPUBloomEnabled, setWebGPUResolutionScale, setWebGPUDarkAdapt, setWebGPUBrightness, setWebGPUInscatterEnabled, setWebGPUDepthCrushEnabled, setSceneOnly } from './render-webgpu';
import { unbandMaterialWebGPU } from './banded-lighting-webgpu';
import type { DelveRenderer } from '../scene/create-renderer';

// WEBGPU: rate-limit render failures to one console line.
let webgpuRenderErrored = false;

// render-frame — the per-frame render entry (renderWithStyle) + the held-
// viewmodel registry + the display-setting facade (bloom/brightness/scale/…).
//
// The actual render path is the native WebGPU RenderPipeline (render-webgpu.ts):
// it owns the low-res chunky-PSX pass + bloom + colour grade + all the PSX post
// moves (dither, quantize, scanlines, chromatic aberration, brightness,
// inscatter, dark-adapt). The old classic-WebGL blit pipeline + its render
// targets that used to live in this file are gone (hence the rename from
// render-target); only the setting flags the getters/setters expose and the
// viewmodel depth helpers remain here.

// Scene-render resolution as a fraction of the canvas. Mutable so the
// adaptive-resolution scaler (scene/adaptive-resolution.ts) can nudge it down
// on a struggling phone. Forwarded to the WebGPU pass downscale.
export const PS1_SCALE_DEFAULT = 0.4;
let ps1Scale = PS1_SCALE_DEFAULT;

let rendererRef: DelveRenderer | null = null;

// Held viewmodels (weapon / lamp / offhand) registered so the draw report can
// classify their meshes as dynamic. Under WebGPU opaque parts use NORMAL depth.
const viewmodelRoots: THREE.Object3D[] = [];
/** Register a held-viewmodel root. Idempotent. */
export function registerViewmodel(root: THREE.Object3D): void {
  if (!viewmodelRoots.includes(root)) viewmodelRoots.push(root);
  // WEBGPU — the elegant path: drop the WebGL depth pre-pass + depthTest:false +
  // renderOrder juggling entirely. Opaque viewmodel parts just use NORMAL depth.
  // They sort correctly among themselves (the hand writes depth and occludes the
  // handle it wraps) and still paint over the world because they sit ~0.3m from
  // the camera while player collision keeps walls farther out. (Transparent parts
  // — glow sprites — keep their additive depthTest:false; depth-writing them
  // would break transparency sorting.)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      if (!(m as THREE.Material).transparent) {
        (m as THREE.Material).depthTest = true;
        (m as THREE.Material).depthWrite = true;
      }
      // Smooth-light the viewmodel (no cel banding): banding a close-up arm lit
      // by the flickering lamp read as flicker.
      unbandMaterialWebGPU(m);
    }
  });
}
/** Set ONE held-viewmodel mesh material's depth state for WebGPU. There is no
 *  depth pre-pass, so opaque parts must write their OWN depth to self-occlude
 *  (the lamp behind the hand, the hilt behind the fingers, arm bones against
 *  each other). Genuinely translucent parts — additive glow sprites, alpha
 *  glass — are left alone so transparency still sorts. Call from every viewmodel
 *  material loop; it re-applies on each mount/equip. */
export function applyViewmodelDepthWebGPU(m: THREE.Material): void {
  const mm = m as THREE.Material & { blending?: number; opacity?: number };
  // additive glow OR real alpha (opacity < 1) → keep transparent + non-writing.
  if (mm.blending === THREE.AdditiveBlending) return;
  if (m.transparent && (mm.opacity ?? 1) < 1) return;
  m.depthTest = true;
  m.depthWrite = true;
  m.transparent = false;
  m.needsUpdate = true;
}

/** Drop a viewmodel root (teardown). */
export function unregisterViewmodel(root: THREE.Object3D): void {
  const i = viewmodelRoots.indexOf(root);
  if (i >= 0) viewmodelRoots.splice(i, 1);
}
/** The registered held-viewmodel roots — for the draw report to classify hand/
 *  weapon/lamp meshes as dynamic (they animate) rather than static decor. */
export function getViewmodelRoots(): readonly THREE.Object3D[] {
  return viewmodelRoots;
}

// PSX post (dither/quantize/scanlines/chromatic/depth-crush/inscatter/bloom)
// lives in the node pipeline (render-webgpu.ts) and is always on in play.
// These setters forward to REAL pipeline toggles so the GPU-attribution
// sweep prices what it claims to (a rebuild each way — probe-grade, cheap).
let bloomEnabled = true;
let depthCrushEnabled = true;
let inscatterEnabled = true;

export function setInscatterEnabled(on: boolean): void {
  inscatterEnabled = on;
  setWebGPUInscatterEnabled(on);
}

export function setDepthCrushEnabled(on: boolean): void {
  depthCrushEnabled = on;
  setWebGPUDepthCrushEnabled(on);
}

/** Toggle bloom (so the look can be A/B'd / disabled on weak devices). */
export function setBloomEnabled(on: boolean): void {
  bloomEnabled = on;
  setWebGPUBloomEnabled(on);
}

// Current-state getters — so a temporary A/B probe (GPU attribution) can capture
// the real setting and restore to IT, not to a hardcoded default.
export function getBloomEnabled(): boolean { return bloomEnabled; }
export function getInscatterEnabled(): boolean { return inscatterEnabled; }
export function getDepthCrushEnabled(): boolean { return depthCrushEnabled; }

/** Set the scene-render resolution fraction (clamped sane). Driven by the
 *  adaptive-resolution scaler; forwarded to the WebGPU pass downscale. */
export function setPS1Scale(scale: number): void {
  // Ceiling raised 0.6 → 1.0 so the RENDER SCALE slider can reach near-native
  // on desktop and strong phones; the adaptive scaler still floors it on weak
  // devices.
  ps1Scale = Math.min(1.0, Math.max(0.2, scale));
  setWebGPUResolutionScale(ps1Scale);
}

export function getPS1Scale(): number { return ps1Scale; }

/** The renderer's EFFECTIVE pixel ratio = min(device DPR, the PIXEL DENSITY
 *  cap). The true fill multiplier — for the perf recorder's meta snapshot.
 *  0 before renderWithStyle has run once (which captures the live renderer). */
export function getRenderPixelRatio(): number { return rendererRef ? rendererRef.getPixelRatio() : 0; }

/** Master output brightness (1 = authored exposure) — the GRAPHICS BRIGHTNESS
 *  slider. Forwarded to the WebGPU grade's expose multiplier. */
export function setMasterBrightness(v: number): void {
  setWebGPUBrightness(v);
}

export function setDarkAdapt(amount: number): void {
  setWebGPUDarkAdapt(amount);   // drive the WebGPU grade's dark-adapt lift
}

/** Bypass every PSX post-effect. For inspection snaps where the gameplay
 *  crunchifiers fight a clean material read. Forwards to the node pipeline's
 *  scene-only output (bare scene sample — no expose/crush/grade), which is
 *  exactly the clean read; this was a silent no-op after the WebGL removal,
 *  so inspect mode was still rendering through the full grimdark grade. */
export function setInspectBypass(on: boolean): void {
  setSceneOnly(on);
}


export function renderWithStyle(
  renderer: DelveRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  // Capture the live renderer every frame so getRenderPixelRatio works without
  // the removed initRenderPipeline.
  rendererRef = renderer;
  // The one render path: the native WebGPU RenderPipeline (render-webgpu.ts) owns
  // the low-res PSX pass + bloom + grade. Boot top-level-awaits renderer init
  // (scene/create-renderer.ts), so the backend is structurally ready before any
  // frame can run. try/catch so an unported material can't kill the loop —
  // rate-limited to one log line.
  try {
    renderWebGPU(renderer, scene, camera);
  } catch (err) {
    // A per-frame render throw leaves the 3D scene un-presented (black) while the
    // DOM HUD keeps drawing — a silent, permanent black-out. Log the STACK on the
    // first one so a recurrence points at the exact faulting material/pipeline
    // (this is how the wand black-screen would surface). The usual cause is an
    // unwarmed pipeline variant compiling live — see spawn-warmups.ts.
    if (!webgpuRenderErrored) {
      webgpuRenderErrored = true;
      console.error('[webgpu] render failed (first only):', err, (err as Error)?.stack);
    }
  }
}
