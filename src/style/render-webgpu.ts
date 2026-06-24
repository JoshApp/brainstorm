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
import { pass, vec2, vec3, vec4, float, screenUV, floor, fract, sin, dot, smoothstep, mix } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

let pipeline: RenderPipeline | null = null;
let scenePass: ReturnType<typeof pass> | null = null;
let resScale = 0.5;   // PSX-style low-res scene render; 1.0 = native
// Bloom tuned subtle + high-threshold so only bright sources (flames, glows,
// emissive runes) bloom — DELVE's dread atmosphere, not a glow-fest. Replaces
// the hand-rolled bright-extract + separable-blur ping-pong in render-target.ts.
const BLOOM_STRENGTH = 0.45, BLOOM_RADIUS = 0.6, BLOOM_THRESHOLD = 0.85;
const QUANT_LEVELS = 32;   // PSX colour steps per channel (matches the GLSL blit)
// DEPTH CRUSH — fade to near-black with camera distance (DELVE's "darkness is
// the baseline" rule; the original did this in HORROR_BLIT_FRAG from linearized
// depth). Metres from camera. Tune on the dev server.
const CRUSH_START_M = 5, CRUSH_END_M = 28, CRUSH_FLOOR = 0.12;
// FOG INSCATTER — the air glows the lights' colour, thicker with distance. The
// original reused the BLOOM texture (the blurred bright pass) as the haze colour
// × a depth weight, so it's coloured by whatever lights are near. We do the same.
const INSCATTER_STRENGTH = 0.5, INSCATTER_START_M = 6, INSCATTER_END_M = 30;

/** Set the scene-render resolution scale (the PSX downscale). 0.5 = half-res. */
export function setWebGPUResolutionScale(s: number): void {
  resScale = s;
  scenePass?.setResolutionScale(s);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function ensurePipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  if (pipeline) return;
  scenePass = pass(scene, camera);
  scenePass.setResolutionScale(resScale);

  // Scene + native bloom, additive, in LINEAR space.
  const bloomPass = bloom(scenePass, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  let lit: any = (scenePass as any).add(bloomPass);

  // DEPTH CRUSH — multiply colour toward CRUSH_FLOOR with camera distance, in
  // linear space (a darkening multiply). getViewZNode() is camera-space Z
  // (negative); negate → metres from camera.
  const distM = (scenePass as any).getViewZNode().negate();
  const crush = (mix as any)(float(1.0), float(CRUSH_FLOOR), (smoothstep as any)(CRUSH_START_M, CRUSH_END_M, distM));
  lit = lit.mul(crush);

  // FOG INSCATTER — add the bloom colour as glowing air, weighted by distance.
  // Added AFTER crush so the haze isn't darkened by it (surfaces fade, air glows).
  const fogW = (smoothstep as any)(INSCATTER_START_M, INSCATTER_END_M, distM).mul(INSCATTER_STRENGTH);
  lit = lit.add((bloomPass as any).mul(fogW));

  // Tone-map + sRGB to DISPLAY space ourselves (so the PSX crunch below lands on
  // the final colour — quantizing in linear would get smeared by the tonemap).
  const display = (lit as any).renderOutput(THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);

  // ── PSX colour grade (ported from render-target.ts HORROR_BLIT_FRAG) ──
  // TSL ops as loosely-typed aliases — the node DSL's strict overloads fight
  // generic composition, and the values are validated at shader-build time anyway.
  const _vec2 = vec2 as any, _vec3 = vec3 as any, _vec4 = vec4 as any, _float = float as any;
  const _floor = floor as any, _fract = fract as any, _sin = sin as any, _dot = dot as any;
  const _uv = screenUV as any;

  let col: any = (display as any).rgb;
  // AMBER TINT — push the whole image warm (matches vec3(1.025,1.0,0.96)).
  col = col.mul(_vec3(1.025, 1.0, 0.96));
  // VIGNETTE — mild edge darkening from screen-centre distance.
  const d = _uv.sub(0.5);
  const vig = _float(1.0).sub(_dot(d, d).mul(0.55));
  col = col.mul(vig);
  // DITHER + QUANTIZE — hash dither breaks the bands, then floor to ~32
  // levels/channel for the hard PSX colour steps.
  const grid = _uv.mul(_vec2(960, 540));
  const dither = _fract(_sin(_dot(_floor(grid), _vec2(12.9898, 78.233))).mul(43758.5453));
  col = _floor(col.mul(QUANT_LEVELS).add(dither)).div(QUANT_LEVELS);
  const outputNode = _vec4(col, 1.0);

  pipeline = new RenderPipeline(renderer as unknown as ConstructorParameters<typeof RenderPipeline>[0]);
  // We applied tone-map + sRGB ourselves above — disable the pipeline's default.
  (pipeline as any).outputColorTransform = false;
  pipeline.outputNode = outputNode as RenderPipeline['outputNode'];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Render one frame through the native WebGPU pipeline. Fire-and-forget per
 *  frame (renderAsync awaits backend init internally). */
export function renderWebGPU(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  ensurePipeline(renderer, scene, camera);
  void (pipeline as unknown as { renderAsync: () => Promise<void> }).renderAsync();
}
