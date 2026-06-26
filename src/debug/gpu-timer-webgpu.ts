import { isWebGPU } from '../scene/renderer-mode';

// Native WebGPU GPU timing via timestamp queries — the WebGPU replacement for the
// WebGL2 EXT_disjoint_timer_query path (gpu-timer.ts). The renderer is created
// with `trackTimestamp: true`, which makes Three write GPU timestamps around the
// render + compute passes. Each frame we resolve those queries (an async readback,
// no pipeline stall) and cache the latest milliseconds, split render vs compute.
//
// resolveTimestampsAsync(type) returns the elapsed GPU ms for that pass directly
// (Three converts ns → ms internally). Falls back silently to "unsupported" if the
// adapter lacks the 'timestamp-query' feature — gpuMs then reads null (HUD "n/a").

let renderMs: number | null = null;
let computeMs: number | null = null;
let supported = false;
let inFlight = false;

/** Kick a non-blocking resolve of the last frame's GPU timestamps; caches the
 *  latest ms. Call once per frame AFTER the render is submitted. Self-throttles
 *  (skips if a previous resolve is still in flight). */
export function tickWebGPUTimestamps(renderer: unknown): void {
  if (!isWebGPU() || inFlight) return;
  const r = renderer as { resolveTimestampsAsync?: (type: string) => Promise<number> };
  if (typeof r?.resolveTimestampsAsync !== 'function') return;
  inFlight = true;
  Promise.all([
    r.resolveTimestampsAsync('render').catch(() => null),
    r.resolveTimestampsAsync('compute').catch(() => null),
  ]).then(([rm, cm]) => {
    if (typeof rm === 'number' && Number.isFinite(rm)) { renderMs = rm; supported = true; }
    if (typeof cm === 'number' && Number.isFinite(cm)) computeMs = cm;
    inFlight = false;
  }, () => { inFlight = false; });
}

/** True once at least one timestamp has resolved (adapter supports the feature). */
export function webgpuTimingSupported(): boolean { return supported; }

/** Total GPU ms this frame (render + compute), or null if unavailable. */
export function webgpuGpuMs(): number | null {
  if (!supported) return null;
  return (renderMs ?? 0) + (computeMs ?? 0);
}

/** Per-pass breakdown (render / compute) for the HUD, or null. */
export function webgpuGpuPhases(): Map<string, number> | null {
  if (!supported) return null;
  const m = new Map<string, number>();
  if (renderMs != null) m.set('render', renderMs);
  if (computeMs != null && computeMs > 0) m.set('compute', computeMs);
  return m;
}
