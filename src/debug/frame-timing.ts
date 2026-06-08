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

import type * as THREE from 'three';
import { GpuTimer } from './gpu-timer';
import { setSystemProbe, setMarksEnabled } from '../engine/loop';
import { getGeometryPoolSize } from '../scene/geometry-pool';
import { getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';
import { installRenderProbe, setRenderGpuProbe, renderGpuProbeOn } from './render-probe';

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
}

interface PerfMemory { usedJSHeapSize: number }
function heapBytes(): number | null {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m ? m.usedJSHeapSize : null;
}

let renderer: THREE.WebGLRenderer | null = null;
let gpu: GpuTimer | null = null;

const frameMs = new Map<string, number>();
let frameStart = 0;
let lastEnd = 0;
let lastHeap: number | null = null;
let marks = false;
// GPU time measured by the render pipeline's gl.finish() probe this frame, if
// any. Takes precedence over the (often-unavailable) timer-query path.
let probedGpu: number | null = null;

type FrameListener = (s: FrameSample) => void;
const listeners = new Set<FrameListener>();

// One reused sample object — avoids per-frame allocation (which would itself
// pollute the GC numbers we're trying to measure).
const sample: FrameSample = {
  dt: 0, cpuMs: 0, gpuMs: null, draws: 0, tris: 0, programs: 0, geometries: 0,
  textures: 0, geometryPool: 0, lightsActive: 0, lightsRegistered: 0,
  heapMB: null, allocMB: 0, gc: false, systems: frameMs,
};

export function initFrameTiming(r: THREE.WebGLRenderer): void {
  if (renderer) return;
  renderer = r;
  gpu = new GpuTimer(r.getContext());
}

/** GPU time is recorded by the passive timer-query extension. */
export function gpuSupported(): boolean {
  return !!gpu?.supported;
}
/** GPU numbers are AVAILABLE if either the timer query works or the finish()
 *  probe is armed — the HUD/recorder use this to decide "n/a" vs a value. */
export function gpuActive(): boolean {
  return !!gpu?.supported || renderGpuProbeOn();
}

/** Arm/disarm the gl.finish() GPU probe (real GPU ms on devices without the
 *  timer-query extension; stalls the pipeline on sampled frames). */
export function setGpuProbe(on: boolean): void { setRenderGpuProbe(on); if (!on) probedGpu = null; }
export function gpuProbeOn(): boolean { return renderGpuProbeOn(); }

function onSystem(name: string, ms: number): void {
  frameMs.set(name, (frameMs.get(name) ?? 0) + ms);
}
function onGpuProbe(ms: number): void { probedGpu = ms; }

function ensureHooks(): void {
  const want = listeners.size > 0 || marks;
  setSystemProbe(want ? onSystem : null);
  setMarksEnabled(marks);
  // Render sub-phase timing + finish() GPU samples flow through the same
  // frameMs map (sub-phases) and probedGpu (GPU) while anything is listening.
  installRenderProbe(want ? onSystem : null, listeners.size > 0 ? onGpuProbe : null);
}

export function addFrameListener(l: FrameListener): void { listeners.add(l); ensureHooks(); }
export function removeFrameListener(l: FrameListener): void { listeners.delete(l); ensureHooks(); }

/** Toggle Chrome-DevTools User Timing marks (per-system performance.measure). */
export function setMarks(on: boolean): void { marks = on; ensureHooks(); }
export function marksOn(): boolean { return marks; }

/** Call immediately BEFORE runSystems(). */
export function frameBegin(): void {
  if (listeners.size === 0 && !marks) return;
  if (marks) performance.clearMeasures();   // bound the User Timing buffer
  frameMs.clear();
  frameStart = performance.now();
  gpu?.begin();
}

/** Call immediately AFTER runSystems(). Fans the assembled sample out to
 *  every listener. */
export function frameEnd(): void {
  if (listeners.size === 0) {
    // Marks-only: still balance the GPU begin/end so the query ring is sane.
    if (marks) { gpu?.end(); gpu?.poll(); }
    return;
  }
  const now = performance.now();
  gpu?.end();
  gpu?.poll();

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
  // Prefer the finish() probe (works on devices without the timer-query ext);
  // fall back to the passive timer query. probedGpu sticks between samples so a
  // probe that fires every Nth frame still reads on the frames in between.
  sample.gpuMs = probedGpu !== null ? probedGpu : (gpu?.supported ? (gpu.lastMs ?? null) : null);
  sample.draws = info ? info.render.calls : 0;
  sample.tris = info ? info.render.triangles : 0;
  sample.programs = info?.programs?.length ?? 0;
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
