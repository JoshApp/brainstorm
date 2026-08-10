import { WebGPURenderer } from 'three/webgpu';
import { DelveTiledLighting } from './tiled-lighting';
import { getSettings } from '../settings/settings';
import { isDesktopLike } from '../controls/platform';
import { DelveClusteredLighting } from './clustered-lighting';
import { installWebGPUCompileGuard } from '../debug/webgpu-compile-guard';
import { installBundlePassOrderFix } from './bundle-pass-order';

/** The one renderer DELVE runs on. WebGPURenderer auto-selects a WebGL2
 *  backend on devices without WebGPU — same node materials, one code path.
 *  Everything that takes a renderer takes THIS type; the old
 *  `as unknown as THREE.WebGLRenderer` cast is gone. */
export type DelveRenderer = WebGPURenderer;

let activeBackend: 'webgpu' | 'webgl2' | 'unknown' = 'unknown';

/** The backend the renderer actually came up on — 'unknown' before boot
 *  finishes. Set once, in createRenderer. */
export function activeGraphicsBackend(): 'webgpu' | 'webgl2' | 'unknown' { return activeBackend; }

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
  // …or because the player asked for it in SETTINGS. That exists alongside the
  // URL flag because an installed PWA launches at its own start_url with no
  // address bar — there is nowhere to type `?webgpu=0` on the device where you
  // most want to try the other backend.
  const forceWebGL = new URLSearchParams(window.location.search).get('webgpu') === '0'
    || getSettings().graphicsBackend === 'webgl2'
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
  // ?timestamps=0 — A/B the timestamp-query tax (2026-07-05): on mobile,
  // trackTimestamp is on to feed adaptive resolution's GPU-load signal, but
  // with adaptive res OFF the per-pass-per-frame query sets + resolve-buffer
  // mapping feed NOBODY. Costs to price: allocation churn, mapAsync round
  // trips, native overhead. With 0, recordings lose their gpu-ms column
  // (dt/cpu stay — those are the trustworthy ones anyway).
  const tsOverride = new URLSearchParams(window.location.search).get('timestamps');
  const trackTimestamp = (import.meta.env.DEV || !isDesktopLike() || profilerWanted)
    && tsOverride !== '0';
  const renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp, forceWebGL });

  // DEFAULT: three's OFFICIAL Forward+ clustered lighting (examples/jsm/tsl/
  // lighting/ClusteredLightsNode) — the upstream-maintained version of the
  // tiled system we hand-rolled: 3D clusters (screen tiles × exponential depth
  // slices), light-culling on GPU COMPUTE (our tiled node binned on the CPU
  // every frame), 16 lights per cluster vs our 8-per-tile cap that measurably
  // DROPPED far torch bins in busy rooms. Same routing policy as ours: point
  // lights cluster, shadow casters (the lamp) keep the per-light material path
  // — and its getLights() returns the FULL list, so it round-trips r185's
  // Lighting save/restore correctly out of the box (the bug our subclasses
  // needed patching for). Params sized for DELVE: ≤32 pooled lights, 32px
  // tiles, 12 depth slices across our ~13m far plane, 16 per cluster.
  //
  // TWO light loops, no more: clustered (default) and tiled (the WebGL2
  // fallback — clustered needs compute — doubling as the ?clustered=0 escape
  // hatch). The lean rolled-loop (?tiled=0) and stock unrolled (?unrolled=1)
  // A/B paths were deleted 2026-07-05 after the clustered promotion proved
  // out on-device: every extra path was warm-coverage surface and a
  // silently-rots-on-three-bumps liability (the r185 getLights contract
  // change broke a subclass exactly that way).
  // (The custom lighting classes extend `Lighting as any` — TSL's node classes
  // aren't cleanly subclassable in TS — so those assignments need a cast.)
  if (forceWebGL || new URLSearchParams(window.location.search).get('clustered') === '0') {
    renderer.lighting = new DelveTiledLighting() as unknown as WebGPURenderer['lighting'];
    if (import.meta.env.DEV) console.log('[webgpu] tiled lighting (WebGL2 fallback / A-B)');
  } else {
    renderer.lighting = new DelveClusteredLighting() as unknown as WebGPURenderer['lighting'];
    if (import.meta.env.DEV) console.log('[webgpu] clustered lighting (official Forward+, default)');
  }

  await renderer.init();
  // What the device ACTUALLY gave us, for the settings screen to report. 'auto'
  // is a request, not an outcome — a phone with no WebGPU silently lands on
  // WebGL2 — and a backend picker that can't tell you which one you're running
  // is a switch with no lamp.
  activeBackend = (renderer.backend as { isWebGPUBackend?: boolean })?.isWebGPUBackend ? 'webgpu' : 'webgl2';

  // r185 executes render bundles AFTER transparents (end of pass), letting
  // bundled opaque walls paint over additive flames — this reorders the flush
  // to after-opaques/before-transparents. See bundle-pass-order.ts.
  installBundlePassOrderFix(renderer);

  // DEV: detect pipeline compiles (renderer.info has no .programs on WebGPU) so
  // post-warmup compiles (warm gaps) are visible. window.__compileStats().
  // The literal-false DEV gate lets the whole guard module dead-code-eliminate
  // from the prod bundle (the guard also self-gates, belt-and-suspenders).
  if (import.meta.env.DEV) installWebGPUCompileGuard((renderer.backend as unknown as { device?: unknown })?.device);
  if (import.meta.env.DEV) console.log('[webgpu] renderer initialised (backend:', renderer.backend?.constructor?.name ?? '?', ')');
  return renderer;
}
