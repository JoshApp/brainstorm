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
import { tickWebGPUTimestamps, webgpuGpuMs, webgpuGpuPhases, webgpuTimingSupported } from './gpu-timer-webgpu';
import { setSystemProbe, setMarksEnabled } from '../engine/loop';
import { getGeometryPoolSize } from '../scene/geometry-pool';
import { getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';
import { installRenderProbe, setRenderGpuProbe, renderGpuProbeOn, installGpuPassHooks, type GpuPassHooks } from './render-probe';
import { setProfSpans } from './prof-span';
import { isWebGPU } from '../scene/renderer-mode';

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
// GPU time measured by the readPixels probe (see frameEnd). Takes precedence
// over the (often-unavailable, and on some drivers garbage) timer-query path.
let probedGpu: number | null = null;
let gpuProbeCount = 0;
const GPU_PROBE_EVERY = 8;
const GPU_PROBE_PIXEL = new Uint8Array(4);

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

// ── Per-pass GPU timing ──────────────────────────────────────────────
// When armed, render-target brackets each render pass (prepass / scene /
// bloom / blit) and we time each span instead of the whole frame. Two
// implementations:
//   • timer queries (free, passive) — sequential labeled spans; the whole-
//     frame query is suspended while this is on (TIME_ELAPSED can't nest).
//   • readPixels sync probe (fallback) — on sampled frames, force the GPU to
//     drain at each pass boundary and wall-clock the gaps. Stalls those
//     frames (like the whole-frame GPU probe), so it's a measurement mode.
let passTiming = false;
let passProbeFrame = false;          // fallback path: does THIS frame sample?
let passProbeCounter = 0;
let passProbeLabel = '';
let passProbeT0 = 0;
const passProbePhases = new Map<string, number>();  // sticky last measurement per pass

function syncGpu(): void {
  if (!renderer || isWebGPU()) return;   // getContext()/readPixels are WebGL-only
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, GPU_PROBE_PIXEL);
}

const passHooks: GpuPassHooks = {
  begin(label: string): void {
    if (gpu?.supported) { gpu.begin(label); return; }
    if (!passProbeFrame) return;
    syncGpu();                        // drain prior work so the span starts clean
    passProbeLabel = label;
    passProbeT0 = performance.now();
  },
  end(): void {
    if (gpu?.supported) { gpu.end(); return; }
    if (!passProbeFrame || !passProbeLabel) return;
    syncGpu();                        // wait for this pass's GPU work
    passProbePhases.set(passProbeLabel, performance.now() - passProbeT0);
    passProbeLabel = '';
  },
};

/** Arm/disarm per-pass GPU timing. Uses timer queries when supported, else
 *  the readPixels sync probe on every Nth frame. */
export function setGpuPassTiming(on: boolean): void {
  passTiming = on;
  if (!on) { passProbePhases.clear(); gpu?.lastByLabel.clear(); }
  ensureHooks();
}
export function gpuPassTimingOn(): boolean { return passTiming; }

/** Introspection for debugging the pass-timing chain (remote console). */
export function gpuPassDiag(): Record<string, unknown> {
  return {
    passTiming,
    timerSupported: !!gpu?.supported,
    listeners: listeners.size,
    labels: gpu ? [...gpu.lastByLabel.entries()].map(([k, v]) => `${k}:${v.toFixed(2)}`) : [],
    probePhases: [...passProbePhases.entries()].map(([k, v]) => `${k}:${v.toFixed(2)}`),
  };
}

export function initFrameTiming(r: THREE.WebGLRenderer): void {
  if (renderer) return;
  renderer = r;
  // WEBGPU SPIKE: GpuTimer + the readPixels probe use renderer.getContext() and
  // the WebGL2 timer-query extension — neither exists under WebGPU, and calling
  // getContext() there crashes profiler boot (?profile=1). Leave gpu null; all
  // gpu?.* calls are already null-safe, and CPU/per-system timing + renderer.info
  // counts still work. Real WebGPU GPU timing (timestamp queries) is Phase 3.
  gpu = isWebGPU() ? null : new GpuTimer(r.getContext());
}

/** GPU time is recorded by the passive timer-query extension (WebGL) or native
 *  timestamp queries (WebGPU). */
/** The most recent frame's GPU ms, renderer-agnostic (WebGPU timestamp queries
 *  or the WebGL2 timer-query) — whatever frameEnd last computed. Null until a
 *  timed frame lands. Used by the differential gpu-breakdown so it works on both
 *  renderers. Requires the frame loop to be running (a profiler flag on). */
export function currentGpuMs(): number | null { return sample.gpuMs; }

export function gpuSupported(): boolean {
  return !!gpu?.supported || webgpuTimingSupported();
}
/** GPU numbers are AVAILABLE if the timer query works, the finish() probe is
 *  armed, or per-pass timing is supplying spans — the HUD/recorder use this
 *  to decide "n/a" vs a value. */
export function gpuActive(): boolean {
  return !!gpu?.supported || renderGpuProbeOn() || passTiming || webgpuTimingSupported();
}

/** Arm/disarm the gl.finish() GPU probe (real GPU ms on devices without the
 *  timer-query extension; stalls the pipeline on sampled frames). */
export function setGpuProbe(on: boolean): void { setRenderGpuProbe(on); if (!on) probedGpu = null; }
export function gpuProbeOn(): boolean { return renderGpuProbeOn(); }

function onSystem(name: string, ms: number): void {
  frameMs.set(name, (frameMs.get(name) ?? 0) + ms);
}

function ensureHooks(): void {
  const want = listeners.size > 0 || marks;
  setSystemProbe(want ? onSystem : null);
  setMarksEnabled(marks);
  // Render sub-phase timings flow through the same frameMs map while anything
  // is listening (the GPU probe runs directly in frameEnd, not via a sink).
  installRenderProbe(want ? onSystem : null);
  // Per-pass GPU spans only while something is listening — otherwise the
  // queries would be issued but never harvested (frameEnd early-returns).
  installGpuPassHooks(passTiming && want ? passHooks : null);
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
  if (passTiming) {
    // Per-pass mode: render-target's spans replace the whole-frame query
    // (TIME_ELAPSED queries can't nest). Fallback path: pick sample frames.
    if (!gpu?.supported) passProbeFrame = (passProbeCounter++ % GPU_PROBE_EVERY) === 0;
  } else {
    gpu?.begin();
  }
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
  if (!passTiming) gpu?.end();   // per-pass mode: spans already closed in render
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
  if (isWebGPU()) {
    // WebGPU: native timestamp queries give the real render + compute GPU ms.
    // Kick the async resolve (caches), then read the latest values.
    tickWebGPUTimestamps(renderer);
    sample.gpuMs = webgpuGpuMs();
    sample.gpuPhases = webgpuGpuPhases();
  } else if (passTiming) {
    // Per-pass mode: the frame's GPU time is the sum of its pass spans (the
    // spans cover every GL command renderWithStyle issues).
    const phases = gpu?.supported ? gpu.lastByLabel : passProbePhases;
    let sum = 0;
    let any = false;
    for (const ms of phases.values()) { sum += ms; any = true; }
    sample.gpuMs = any ? sum : null;
    sample.gpuPhases = any ? phases : null;
  } else {
    sample.gpuMs = probedGpu !== null ? probedGpu : (gpu?.supported ? (gpu.lastMs ?? null) : null);
    sample.gpuPhases = null;
  }
  sample.draws = info ? info.render.calls : 0;
  sample.tris = info ? info.render.triangles : 0;
  sample.programs = info?.programs?.length ?? 0;
  sample.newProgKinds = diffNewPrograms(info);
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

  // GPU PROBE — runs HERE, after the frame's cpu/dt are already captured and
  // listeners fired, so its synchronous stall pollutes neither. On devices
  // without the WebGL2 timer-query extension (most Android Chrome) a 1×1
  // readback is the only reliable GPU read: it forces a round-trip that waits
  // for the GPU to finish the frame (gl.finish() returns early behind Chrome's
  // out-of-process GPU). Sampled every Nth frame; the value feeds NEXT frame's
  // sample (probedGpu is sticky). We then restart the dt clock past the stall
  // so it's excluded from the following frame's dt too — the probe costs real
  // fps but never shows up as a fake "dropped frame" in the recording.
  if (renderGpuProbeOn() && renderer && !isWebGPU() && (gpuProbeCount++ % GPU_PROBE_EVERY === 0)) {
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    const t0 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, GPU_PROBE_PIXEL);
    const ms = performance.now() - t0;
    if (Number.isFinite(ms) && ms >= 0 && ms < 1000) probedGpu = ms;
    lastEnd = performance.now();
  }
}
