import { setGradeBypass, setSceneOnly } from '../style/render-webgpu';
import { setBloomEnabled, getBloomEnabled } from '../style/render-target';
import { setShadowMode, getShadowMode } from '../scene/light-pool';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type * as THREE from 'three';

// PER-STAGE GPU breakdown (WebGPU). Three doesn't expose per-pass timestamps, so
// we price each stage by DIFFERENCE: toggle it off, measure the whole-frame GPU ms
// (native timestamp query — the real number), toggle back, subtract. Each toggle
// that lives in the node pipeline (bloom, grade) rebuilds it, so we warm a handful
// of frames before sampling. The deltas aren't perfectly additive (toggling one
// pass can shift another), but they localize the cost — "bloom is 3ms, grade 2ms,
// the rest is scene+lighting" — which is what we need to pick the optimization.

/* eslint-disable @typescript-eslint/no-explicit-any */
const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function median(renderer: any, frames = 16, warm = 8): Promise<number> {
  for (let i = 0; i < warm; i++) await raf();   // let a pipeline rebuild settle + warm the shaders
  const s: number[] = [];
  for (let i = 0; i < frames; i++) {
    await raf();
    const ms = await renderer.resolveTimestampsAsync('render').catch(() => null);
    if (typeof ms === 'number' && ms > 0) s.push(ms);
  }
  s.sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Run the stage sweep and return a labelled GPU-ms breakdown. ~5s (it warms +
 *  samples each configuration). Restores every toggle to where it started. */
export async function gpuBreakdown(renderer: any, scene?: THREE.Scene): Promise<Record<string, number>> {
  if (!renderer?.resolveTimestampsAsync) return { error: -1 };
  const round = (x: number): number => Math.round(x * 100) / 100;

  const full = await median(renderer);

  const prevBloom = getBloomEnabled();
  setBloomEnabled(false); const noBloom = await median(renderer); setBloomEnabled(prevBloom);

  const prevShadow = getShadowMode();
  setShadowMode('off'); const noShadow = await median(renderer); setShadowMode(prevShadow);

  setGradeBypass(true); const noGrade = await median(renderer); setGradeBypass(false);
  setSceneOnly(true); const sceneOnly = await median(renderer);

  // Split the SCENE RENDER (measured in scene-only mode) by overriding every
  // mesh's material: unlit basic = pure rasterization; plain standard = geometry
  // + PBR lighting (no surface-detail/banded/reveal nodes). The deltas isolate
  // rasterization / lighting / material-shader complexity.
  let raster = 0, litPlain = 0;
  if (scene) {
    const prev = scene.overrideMaterial;
    scene.overrideMaterial = new (MeshBasicNodeMaterial as any)({ color: 0x808080 });
    raster = await median(renderer);
    scene.overrideMaterial = new (MeshStandardNodeMaterial as any)({ color: 0x808080, roughness: 0.9 });
    litPlain = await median(renderer);
    scene.overrideMaterial = prev ?? null;
  }
  setSceneOnly(false);
  await median(renderer, 2, 8);   // settle back to the full pipeline

  const bloom = Math.max(0, full - noBloom);
  const shadow = Math.max(0, full - noShadow);
  const grade = Math.max(0, full - noGrade);
  const post = Math.max(0, full - sceneOnly);
  const out: Record<string, number> = {
    fullMs: round(full),
    sceneRenderMs: round(sceneOnly),
    postTotalMs: round(post),
    bloomMs: round(bloom),
    gradeTailMs: round(grade),
    shadowMs: round(shadow),
  };
  if (scene) {
    out.rasterMs = round(raster);                        // geometry + upscale, no lighting/detail
    out.lightingMs = round(Math.max(0, litPlain - raster));   // PBR lighting cost
    out.materialShaderMs = round(Math.max(0, sceneOnly - litPlain)); // surface-detail/banded/reveal nodes
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
