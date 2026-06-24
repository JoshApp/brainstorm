// Native WebGPU/TSL render path (the `webgpu` branch port).
//
// Replaces the stopgap direct renderer.render() in render-target.ts's WebGPU
// branch with Three's node-based RenderPipeline (formerly PostProcessing): the
// scene renders through a PassNode at the PSX low-res scale, then composites to
// the screen. This restores the low-res fill win the classic pipeline got from
// its 0.4× lowResTarget — without it the WebGPU path was rendering full-res.
//
// The PSX look (palette / dither / depth-crush / bloom / inscatter) gets chained
// onto outputNode as TSL effect nodes incrementally — see WEBGPU-MIGRATION.md.
// For now outputNode is the raw scene pass (so it renders correctly, just
// without the post look yet).

import * as THREE from 'three';
import { RenderPipeline } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

let pipeline: RenderPipeline | null = null;
let scenePass: ReturnType<typeof pass> | null = null;
let resScale = 0.5;   // PSX-style low-res scene render; 1.0 = native
// Bloom tuned subtle + high-threshold so only bright sources (flames, glows,
// emissive runes) bloom — DELVE's dread atmosphere, not a glow-fest. Replaces
// the hand-rolled bright-extract + separable-blur ping-pong in render-target.ts.
const BLOOM_STRENGTH = 0.45, BLOOM_RADIUS = 0.6, BLOOM_THRESHOLD = 0.85;

/** Set the scene-render resolution scale (the PSX downscale). 0.5 = half-res. */
export function setWebGPUResolutionScale(s: number): void {
  resScale = s;
  scenePass?.setResolutionScale(s);
}

function ensurePipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  if (pipeline) return;
  scenePass = pass(scene, camera);
  scenePass.setResolutionScale(resScale);
  // Output = scene + native bloom (additive). RenderPipeline applies the output
  // tone-map + sRGB transform after this, so we composite in linear space.
  const bloomPass = bloom(scenePass, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const outputNode = (scenePass as unknown as { add: (n: unknown) => unknown }).add(bloomPass);
  // RenderPipeline(renderer, outputNode). renderer is a WebGPURenderer here
  // (typed as WebGLRenderer across the codebase during the migration).
  pipeline = new RenderPipeline(
    renderer as unknown as ConstructorParameters<typeof RenderPipeline>[0],
    outputNode as ConstructorParameters<typeof RenderPipeline>[1],
  );
}

/** Render one frame through the native WebGPU pipeline. Fire-and-forget per
 *  frame (renderAsync awaits backend init internally). */
export function renderWebGPU(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  ensurePipeline(renderer, scene, camera);
  void (pipeline as unknown as { renderAsync: () => Promise<void> }).renderAsync();
}
