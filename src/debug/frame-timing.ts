// Shared per-frame timing core. ONE place owns the GPU timer + the per-system
// CPU probe; the live HUD (profiler-hud.ts) and the session recorder
// (perf-recorder.ts) are both just LISTENERS on it. That matters because the
// engine loop only has a single systemProbe slot — if the HUD and the recorder
// each tried to install their own, they'd clobber each other. Here they
// coexist: the probe is installed whenever there's at least one listener (or
// DevTools marks are on) and removed when the last one leaves, so normal play
// still takes runSystems' zero-overhead fast path.
//
// DEV-only — pulled in exclusively behind `import.meta.env.DEV` in main.ts.

import { pipelineCount, type DelveRenderer } from '../scene/create-renderer';
import { tickWebGPUTimestamps, webgpuGpuMs, webgpuGpuPhases, webgpuTimingSupported } from './gpu-timer-webgpu';
import { setSystemProbe, setMarksEnabled } from '../engine/loop';
import { getGeometryPoolSize } from '../scene/geometry-pool';
import { getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';
import { setProfSpans } from './prof-span';

export interface FrameSample {
  /** ms since the previous frame's end — the true frame interval (≈ 1000/fps). */
  dt: number;
  /** Wall-clock ms of the system pass (script + draw-call submission). */
  cpuMs: number;
  /** GPU execution ms (timer query), or null when unsupported / not ready. */
  gpuMs: number | null;
  draws: number;
  tris: number;
  programs: number;
  /** Shader-TYPE heads of programs that compiled THIS frame (e.g. 'physical',
   *  'distanceRGBA' = point-shadow caster, 'sprite'). Names what froze a frame. */
  newProgKinds: string[];
  geometries: number;
  textures: number;
  geometryPool: number;
  lightsActive: number;
  lightsRegistered: number;
  heapMB: number | null;
  /** MB allocated since last frame (0 on a GC frame). */
  allocMB: number;
  /** True if the heap shrank this frame — a GC collection happened. */
  gc: boolean;
  /** Per-system ms THIS frame. TRANSIENT — the same Map is reused every frame;
   *  a listener that retains data must copy out, not hold the reference. */
  systems: Map<string, number>;
  /** Per-render-pass GPU ms (prepass/scene/bloom/blit) when per-pass GPU
   *  timing is armed, else null. TRANSIENT — same Map reused; copy out. */
  gpuPhases: Map<string, number> | null;
}

/** Per-frame draw-call count, renderer-agnostic. On WebGPU `info.render.calls`
 *  counts render-pass BEGINS since boot (cumulative — it survives info.reset()),
 *  NOT draws; `drawCalls` is the real per-frame count. WebGL has only `calls`
 *  (correct there). Reading the wrong one made phone recordings report "40k
 *  draws" that were just uptime — every draws consumer must go through this. */
export function perFrameDraws(
  info: { render: { calls: number; drawCalls?: number } } | null | undefined,
): number {
  if (!info) return 0;
  return info.render.drawCalls ?? info.render.calls;
}

interface PerfMemory { usedJSHeapSize: number }
function heapBytes(): number | null {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m ? m.usedJSHeapSize : null;
}

let renderer: DelveRenderer | null = null;

const frameMs = new Map<string, number>();
let frameStart = 0;
let lastEnd = 0;
let lastHeap: number | null = null;
let marks = false;

type FrameListener = (s: FrameSample) => void;
const listeners = new Set<FrameListener>();

// Names the shader programs that compile DURING a recording. THREE's program
// cacheKey starts with the shader TYPE ('physical'=lit standard, 'distanceRGBA'
// =point-light shadow caster, 'sprite', 'basic'). On the first profiled frame we
// SEED the set with everything already warm (no tags); after that any new key is
// a compile that wasn't pre-warmed → its type lands in the spike's `ev`, so we
// know WHAT froze instead of guessing.
const _seenProg = new Set<string>();
const _compiledKeys: string[] = [];   // FULL keys of post-seed compiles (for diffing)
let _progSeeded = false;
let _warmupDone = false;
/** Called once after runWarmupPass finishes. From here, any NEW program compile
 *  is an UNWARMED material — the self-policing guard warns (DEV) naming its type,
 *  so a missing warmable is caught the instant it's hit, not weeks later. */
export function markWarmupComplete(): void { _warmupDone = true; }
function diffNewPrograms(info: { programs?: ReadonlyArray<{ cacheKey?: string }> | null } | null | undefined): string[] {
  if (!info?.programs) return [];
  if (!_progSeeded) { for (const p of info.programs) _seenProg.add(p.cacheKey ?? ''); _progSeeded = true; return []; }
  const out: string[] = [];
  for (const p of info.programs) {
    const k = p.cacheKey ?? '';
    if (k && !_seenProg.has(k)) {
      _seenProg.add(k); out.push(k.split(',')[0] || '?'); if (_compiledKeys.length < 80) _compiledKeys.push(k);
      if (_warmupDone && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[warmup-guard] UNWARMED shader compiled in-play: '${k.split(',')[0]}' (…${k.slice(-40)}). Register a warmable (content/warmup-registry.ts).`);
      }
    }
  }
  return out;
}
/** FULL cacheKeys of every program that compiled after the first profiled frame —
 *  saved into a recording's meta so we can diff a combat compile against the
 *  warmed set and see WHICH define flipped (the exact un-warmed variant). */
export function getCompiledProgramKeys(): readonly string[] { return _compiledKeys; }

// One reused sample object — avoids per-frame allocation (which would itself
// pollute the GC numbers we're trying to measure).
const sample: FrameSample = {
  dt: 0, cpuMs: 0, gpuMs: null, draws: 0, tris: 0, programs: 0, newProgKinds: [], geometries: 0,
  textures: 0, geometryPool: 0, lightsActive: 0, lightsRegistered: 0,
  heapMB: null, allocMB: 0, gc: false, systems: frameMs, gpuPhases: null,
};

export function initFrameTiming(r: DelveRenderer): void {
  if (renderer) return;
  renderer = r;
}

/** The most recent frame's GPU ms (WebGPU native timestamp queries) — whatever
 *  frameEnd last computed. Null until a timed frame lands. Used by the
 *  differential gpu-breakdown. Requires the frame loop to be running (a
 *  profiler flag on). The per-pass render/compute split rides along in
 *  sample.gpuPhases — always on, no arming needed. */
export function currentGpuMs(): number | null { return sample.gpuMs; }

export function gpuSupported(): boolean {
  return webgpuTimingSupported();
}
/** GPU numbers are AVAILABLE once a timestamp query has resolved — the
 *  HUD/recorder use this to decide "n/a" vs a value. */
export function gpuActive(): boolean {
  return webgpuTimingSupported();
}

function onSystem(name: string, ms: number): void {
  frameMs.set(name, (frameMs.get(name) ?? 0) + ms);
}

function ensureHooks(): void {
  const want = listeners.size > 0 || marks;
  setSystemProbe(want ? onSystem : null);
  setMarksEnabled(marks);
}

export function addFrameListener(l: FrameListener): void { listeners.add(l); ensureHooks(); }
export function removeFrameListener(l: FrameListener): void { listeners.delete(l); ensureHooks(); }

/** Toggle Chrome-DevTools User Timing marks (per-system performance.measure).
 *  Also arms the in-system nested spans (prof-span) and the render sub-phase
 *  marks, so the native flame chart gets depth, not just a flat system row. */
export function setMarks(on: boolean): void { marks = on; setProfSpans(on); ensureHooks(); }
export function marksOn(): boolean { return marks; }

/** Call immediately BEFORE runSystems(). */
export function frameBegin(): void {
  if (listeners.size === 0 && !marks) return;
  if (marks) performance.clearMeasures();   // bound the User Timing buffer
  frameMs.clear();
  frameStart = performance.now();
}

/** Call immediately AFTER runSystems(). Fans the assembled sample out to
 *  every listener. */
export function frameEnd(): void {
  if (listeners.size === 0) return;
  const now = performance.now();

  const heap = heapBytes();
  let allocMB = 0;
  let gc = false;
  if (heap !== null && lastHeap !== null) {
    const d = heap - lastHeap;
    if (d < 0) gc = true; else allocMB = d / (1024 * 1024);
  }
  lastHeap = heap;

  const info = renderer?.info;
  sample.dt = lastEnd ? now - lastEnd : 0;
  sample.cpuMs = now - frameStart;
  // WebGPU: native timestamp queries give the real render + compute GPU ms.
  // Kick the async resolve (caches), then read the latest values.
  tickWebGPUTimestamps(renderer);
  sample.gpuMs = webgpuGpuMs();
  sample.gpuPhases = webgpuGpuPhases();
  sample.draws = perFrameDraws(info);
  sample.tris = info ? info.render.triangles : 0;
  sample.programs = renderer ? pipelineCount(renderer) : 0;   // compiled pipelines (WebGPU)
  sample.newProgKinds = diffNewPrograms(info as unknown as { programs?: ReadonlyArray<{ cacheKey?: string }> | null });
  sample.geometries = info ? info.memory.geometries : 0;
  sample.textures = info ? info.memory.textures : 0;
  sample.geometryPool = getGeometryPoolSize();
  sample.lightsActive = getActiveSourceCount();
  sample.lightsRegistered = getRegisteredSourceCount();
  sample.heapMB = heap !== null ? heap / (1024 * 1024) : null;
  sample.allocMB = allocMB;
  sample.gc = gc;
  // sample.systems already aliases frameMs.

  lastEnd = now;
  for (const l of listeners) l(sample);
}
