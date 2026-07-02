import { WebGPURenderer } from 'three/webgpu';
import { DelveTiledLighting } from './tiled-lighting';
import { DelveLeanLighting } from './lean-lights';
import { installWebGPUCompileGuard } from '../debug/webgpu-compile-guard';

/** The one renderer DELVE runs on. WebGPURenderer auto-selects a WebGL2
 *  backend on devices without WebGPU — same node materials, one code path.
 *  Everything that takes a renderer takes THIS type; the old
 *  `as unknown as THREE.WebGLRenderer` cast is gone. */
export type DelveRenderer = WebGPURenderer;

/** Compiled render-pipeline count — the WebGPU analogue of the old WebGL
 *  `info.programs.length` (which the node renderer never populates). Reads the
 *  private pipeline cache; profiler/report plumbing only. */
export function pipelineCount(renderer: DelveRenderer): number {
  const caches = (renderer as unknown as { _pipelines?: { caches?: Map<string, unknown> } })._pipelines?.caches;
  return caches?.size ?? 0;
}

// ── Async boot, phase 1: the renderer ─────────────────────────────────────────
// WebGPURenderer.init() is async (adapter/device request). main.ts TOP-LEVEL
// AWAITS this, so everything below the await — scene build, materials, warmup,
// the frame loop — runs against a READY backend. That's the whole ready-gate
// story now; the old isWebGPUReady() flag threaded through the render path is
// gone (nothing that renders can even exist before this resolves).

/** Construct + initialise the renderer (and its lighting node). Resolves when
 *  the backend device is ready; REJECTS if no backend is available at all
 *  (no WebGPU and no WebGL2) — the boot guard turns that into the recovery
 *  screen rather than a silent black canvas. */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<DelveRenderer> {
  // ?webgpu=0 forces the WebGL2 backend — the manual escape hatch / fallback test.
  const forceWebGL = new URLSearchParams(window.location.search).get('webgpu') === '0';
  // trackTimestamp: native GPU timestamp queries for the profiler + adaptive res
  // (frame-timing / gore read resolveTimestampsAsync). No-op if the adapter lacks it.
  const renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true, forceWebGL });

  // Tiled (Forward+) lighting prototype (?tiled=1). Bins point lights into screen
  // tiles via a compute pass so each fragment shades at most ~8 lights regardless
  // of total count — lets the torch count climb without the per-fragment wall.
  // A/B behind the flag until proven against the custom pipeline + banded model.
  // (The lighting classes extend `Lighting as any` — TSL's node classes aren't
  // cleanly subclassable in TS — so the assignments need a cast.)
  if (new URLSearchParams(window.location.search).get('tiled') === '1') {
    renderer.lighting = new DelveTiledLighting() as unknown as WebGPURenderer['lighting'];
    if (import.meta.env.DEV) console.log('[webgpu] tiled lighting ON');
  } else if (new URLSearchParams(window.location.search).get('unrolled') !== '1') {
    // DEFAULT: custom rolled-loop lights node (scene/lean-lights.ts). Evaluates the
    // pooled point lights in ONE loop instead of N unrolled per-light nodes, with two
    // byte-identical wins: parked pool slots (intensity 0) aren't packed, and a per-
    // fragment distance cull skips lights past their cutoff (Three's attenuation is
    // exactly 0 there). ?unrolled=1 reverts to stock node lighting for A/B; ?tiled=1
    // selects the Forward+ compute path.
    renderer.lighting = new DelveLeanLighting() as unknown as WebGPURenderer['lighting'];
    if (import.meta.env.DEV) console.log('[webgpu] lean lights (default)');
  }

  await renderer.init();

  // DEV: detect pipeline compiles (renderer.info has no .programs on WebGPU) so
  // post-warmup compiles (warm gaps) are visible. window.__compileStats().
  // The literal-false DEV gate lets the whole guard module dead-code-eliminate
  // from the prod bundle (the guard also self-gates, belt-and-suspenders).
  if (import.meta.env.DEV) installWebGPUCompileGuard((renderer.backend as unknown as { device?: unknown })?.device);
  if (import.meta.env.DEV) console.log('[webgpu] renderer initialised (backend:', renderer.backend?.constructor?.name ?? '?', ')');
  return renderer;
}
