import { WebGPURenderer } from 'three/webgpu';
import { DelveTiledLighting } from './tiled-lighting';
import { getSettings } from '../settings/settings';
import { isDesktopLike } from '../controls/platform';
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
  // Force the WebGL2 backend when WebGPU can't work: the ?webgpu=0 escape hatch,
  // or navigator.gpu missing outright (insecure http origin, older browser,
  // headless). Without the up-front force, THREE's failed 'webgpu' getContext
  // attempt can poison the canvas and the auto-fallback then gets a NULL webgl2
  // context — init rejects and boot dies where a graceful WebGL2 boot was possible.
  const forceWebGL = new URLSearchParams(window.location.search).get('webgpu') === '0'
    || !('gpu' in navigator);
  // trackTimestamp: native GPU timestamp queries for the profiler + adaptive res
  // (frame-timing / gore read resolveTimestampsAsync). No-op if the adapter lacks
  // it. NOT free when on: Three allocates a query set + resolve buffers PER PASS
  // PER FRAME (the top steady-state allocation site once everything else was
  // pooled — measured via the alloc-profile attach mode). So only track where
  // something actually consumes the timestamps: DEV (perf tooling), mobile
  // (adaptive resolution's GPU-load signal), or the shipped profiler suite
  // (constructor-time flag, so flipping PROFILER TOOLS on needs a reload —
  // the suite's session URL flags always relaunch anyway).
  const profilerWanted = getSettings().profilerTools ||
    ['profiler', 'profile', 'record', 'marks', 'stream']
      .some((k) => new URLSearchParams(window.location.search).get(k) === '1');
  const trackTimestamp = import.meta.env.DEV || !isDesktopLike() || profilerWanted;
  const renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp, forceWebGL });

  // DEFAULT: tiled (Forward+-lite) lighting (scene/tiled-lighting.ts). CPU-bins
  // the pooled point lights into screen tiles (uniform arrays, nearest-first on
  // overflow) so each fragment shades at most ~8 lights regardless of total
  // count. Measured flat in light count (~14.9ms GPU at n=14/30/56 vs lean
  // 15.5/18.6/22.9 on the perf-lights bench) — torches can climb without the
  // per-fragment wall. Escape hatches for A/B: ?tiled=0 = the lean rolled loop
  // (scene/lean-lights.ts), ?unrolled=1 = stock per-light node lighting.
  // (The lighting classes extend `Lighting as any` — TSL's node classes aren't
  // cleanly subclassable in TS — so the assignments need a cast.)
  const lightingFlags = new URLSearchParams(window.location.search);
  if (lightingFlags.get('unrolled') === '1') {
    if (import.meta.env.DEV) console.log('[webgpu] stock unrolled lights (A/B)');
  } else if (lightingFlags.get('tiled') === '0') {
    renderer.lighting = new DelveLeanLighting() as unknown as WebGPURenderer['lighting'];
    if (import.meta.env.DEV) console.log('[webgpu] lean lights (A/B)');
  } else {
    renderer.lighting = new DelveTiledLighting() as unknown as WebGPURenderer['lighting'];
    if (import.meta.env.DEV) console.log('[webgpu] tiled lighting (default)');
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
