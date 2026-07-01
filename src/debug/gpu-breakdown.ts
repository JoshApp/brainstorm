import * as THREE from 'three';
import { setGradeBypass, setSceneOnly } from '../style/render-webgpu';
import { setBloomEnabled, getBloomEnabled } from '../style/render-frame';
import { setShadowMode, getShadowMode } from '../scene/light-pool';
import { currentGpuMs } from './frame-timing';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

// PER-STAGE GPU breakdown — RENDERER-AGNOSTIC (WebGPU + WebGL). Neither API hands
// us clean per-pass timestamps for OUR multi-pass pipeline, so we price each stage
// by DIFFERENCE: toggle it off, measure the whole-frame GPU ms (the real hardware
// timer — WebGPU timestamp queries or the WebGL2 EXT_disjoint_timer_query, read
// renderer-agnostically via currentGpuMs), toggle back, subtract.
//
// This is the rigorous way to compare WebGPU vs WebGL: their pipelines are
// structurally different, so absolute "pass X" totals aren't comparable — but
// "what does LIGHTING cost" / "what does bloom cost" in each IS, because the
// differential controls for everything else. The deltas aren't perfectly additive
// (toggling one pass can shift another) but they localize the cost.
//
// Requires the frame loop running (a profiler flag, e.g. ?profiler=1) so frameEnd
// keeps currentGpuMs() fresh, and a GPU timer the adapter supports (both desktop
// Chrome backends do). Restores every toggle to where it started.

/* eslint-disable @typescript-eslint/no-explicit-any */
const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

// Median whole-frame GPU ms over `frames`, after `warm` frames to let a pipeline
// rebuild settle + (on WebGL) flush the 1–3-frame timer-query latency.
async function median(frames = 16, warm = 12): Promise<number> {
  for (let i = 0; i < warm; i++) await raf();
  const s: number[] = [];
  for (let i = 0; i < frames; i++) {
    await raf();
    const ms = currentGpuMs();
    if (typeof ms === 'number' && ms > 0) s.push(ms);
  }
  s.sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// Override materials: unlit = pure rasterization; plain-standard = geometry + PBR
// lighting (no surface-detail/banded/reveal nodes). Node materials on WebGPU.
function basicMat(): THREE.Material {
  return new (MeshBasicNodeMaterial as any)({ color: 0x808080 });
}
function stdMat(): THREE.Material {
  return new (MeshStandardNodeMaterial as any)({ color: 0x808080, roughness: 0.9 });
}

/** Run the stage sweep and return a labelled GPU-ms breakdown. ~6-10s (it warms +
 *  samples each configuration). Restores every toggle. */
export async function gpuBreakdown(renderer: any, scene?: THREE.Scene): Promise<Record<string, any>> {
  const round = (x: number): number => Math.round(x * 100) / 100;

  const full = await median();
  if (full === 0) return { error: 'no GPU timer — enable a profiler flag (?profiler=1) and check the adapter supports timestamp/timer queries' };

  const prevBloom = getBloomEnabled();
  setBloomEnabled(false); const noBloom = await median(); setBloomEnabled(prevBloom);

  const prevShadow = getShadowMode();
  setShadowMode('off'); const noShadow = await median(); setShadowMode(prevShadow);

  // Post split only exists on the WebGPU node pipeline (sceneOnly / gradeBypass).
  let sceneOnly: number | null = null, grade = 0;
  setGradeBypass(true); const noGrade = await median(); setGradeBypass(false);
  setSceneOnly(true); sceneOnly = await median();
  grade = Math.max(0, full - noGrade);

  // Scene split via material override. Measured in scene-only mode.
  let raster = 0, litPlain = 0;
  if (scene) {
    const prev = scene.overrideMaterial;
    scene.overrideMaterial = basicMat(); raster = await median();
    scene.overrideMaterial = stdMat(); litPlain = await median();
    scene.overrideMaterial = prev ?? null;
  }
  setSceneOnly(false); await median(2, 8);

  const sceneRef = sceneOnly ?? full;
  const out: Record<string, any> = {
    renderer: 'webgpu',
    fullMs: round(full),
    bloomMs: round(Math.max(0, full - noBloom)),
    shadowMs: round(Math.max(0, full - noShadow)),
  };
  if (sceneOnly != null) {
    out.sceneRenderMs = round(sceneOnly);
    out.postTotalMs = round(Math.max(0, full - sceneOnly));
    out.gradeTailMs = round(grade);
  }
  if (scene) {
    out.rasterMs = round(raster);                                  // geometry + upscale, no lighting/detail
    out.lightingMs = round(Math.max(0, litPlain - raster));        // PBR lighting cost
    out.materialShaderMs = round(Math.max(0, sceneRef - litPlain)); // surface-detail/banded/reveal nodes
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
