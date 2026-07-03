// Programmatic performance probe — a DEV-only `window.__perf()` hook that
// returns a structured snapshot of everything that predicts frame cost:
// draw calls, triangles, GPU resource counts, active/registered lights,
// JS heap, and a garbage-collection churn proxy (heap sawtooth).
//
// This is the machine-readable sibling of the on-screen PERF METER
// (src/ui/perf-overlay.ts). The overlay is for eyeballing FPS on the
// phone; this probe is for the headless perf runner (scripts/perf.ts),
// which drives a stress scenario and samples __perf() over several
// seconds to report structural load.
//
// WHY structural load, not FPS, headless: the snap/perf harness runs
// Chromium with --use-gl=swiftshader (CPU rasteriser), so wall-clock FPS
// is meaningless there. But renderer.info counts (draws, tris, lights,
// geometries, textures, programs) are GPU-INDEPENDENT and deterministic —
// they're exactly what predicts cost on a real mobile GPU. FPS you read
// off the on-screen overlay on the actual device.
//
// DEV-gated: installPerfProbe is only called behind `if (DEV)` in main.ts,
// so `window.__perf` cannot exist on the live static build.

import type * as THREE from 'three';
import { getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';
import { getGeometryPoolSize } from '../scene/geometry-pool';
import { currentGpuMs, perFrameDraws } from './frame-timing';
import { pipelineCount, type DelveRenderer } from '../scene/create-renderer';

// Chrome-only non-standard heap readout. Absent on Firefox/Safari and on
// headless swiftshader unless --enable-precise-memory-info is passed.
interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}
function heapBytes(): number | null {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m ? m.usedJSHeapSize : null;
}

let renderer: DelveRenderer | null = null;

// Frame-time ring (own copy so the probe works regardless of whether the
// on-screen overlay is visible). Timestamps in ms; trimmed to a 1s window.
const frameTimes: number[] = [];
const FRAME_WINDOW_MS = 1000;

// Heap sawtooth tracking — the GC churn proxy. We sample the heap each
// frame and watch the delta:
//   - a DROP (heap shrank) = a GC collection happened → bump gcCount
//   - a RISE (heap grew)   = allocations since last frame → sum as churn
// Alloc rate (MB/s) and GC frequency together tell you whether per-frame
// allocations are a problem. A flat heap = zero churn = ideal.
let lastHeap: number | null = null;
let allocBytesInWindow = 0;
let gcEventsInWindow = 0;
const heapEvents: Array<{ t: number; alloc: number; gc: boolean }> = [];
// FUZZ DETECTION. Without --enable-precise-memory-info, Chrome QUANTIZES
// usedJSHeapSize (big steps, rate-limited updates) — the sawtooth proxy then
// reads quantization artifacts as massive alloc churn (a 14 MB/s reading on a
// page whose true sampled churn was 0.04 MB/s). Track the smallest nonzero
// heap delta seen: precise heaps move in small steps constantly; a fuzzed
// heap only ever jumps in >=1MB quanta. Surfaced as heapQuantized so readers
// know to trust the alloc-profile CLI (real sampling stacks), not this proxy.
let minAbsDelta = Infinity;

export interface PerfSnapshot {
  /** Frames in the last 1s window (≈FPS). Meaningless under swiftshader. */
  fps: number;
  /** Most-recent frame delta, ms. */
  lastMs: number;
  /** 95th-percentile frame delta over the window, ms — surfaces hitches. */
  p95Ms: number;
  /** Draw calls last frame (drawCalls on WebGPU; `calls` is cumulative there). */
  draws: number;
  /** Triangles last frame. */
  tris: number;
  /** Live GPU geometries / textures / compiled programs. */
  geometries: number;
  textures: number;
  programs: number;
  /** Shared geometry-pool size (deduped primitive geometries). */
  geometryPool: number;
  /** Light slots currently lit / logical sources registered. */
  lightsActive: number;
  lightsRegistered: number;
  /** JS heap in MB, or null if the browser doesn't expose it. */
  heapMB: number | null;
  /** TRUE when the heap counter is quantized (no --enable-precise-memory-info):
   *  allocRateMBs/gcPerSec then reflect quantization noise, not real churn —
   *  use `npm run alloc-profile` (sampling stacks) for the real numbers. */
  heapQuantized: boolean | null;
  /** Estimated allocation churn, MB/s, over the window (GC proxy). */
  allocRateMBs: number | null;
  /** GC collections observed in the window (heap-drop count). */
  gcPerSec: number | null;
  /** GPU ms last frame from native timestamps — only populated while a profiler
   *  flag (?profiler=1) is on, since that's what ticks resolveTimestampsAsync.
   *  null if timestamps unsupported or the profiler isn't running. */
  gpuMs: number | null;
}

export function installPerfProbe(r: DelveRenderer): void {
  // Belt-and-suspenders: even if a stray call survives bundling, this
  // literal-false guard folds the body away in prod so window.__perf can
  // never be defined on the live site. (Same hardening as setGodMode.)
  if (!import.meta.env.DEV) return;
  renderer = r;
  (window as unknown as { __perf: () => PerfSnapshot }).__perf = getPerfSnapshot;
}

/** Call once per frame from the main tick (DEV-gated). Cheap: a push, a
 *  shift loop, and one heap read. */
export function tickPerfProbe(nowMs: number): void {
  if (!import.meta.env.DEV) return;
  frameTimes.push(nowMs);
  while (frameTimes.length > 0 && nowMs - frameTimes[0] > FRAME_WINDOW_MS) {
    frameTimes.shift();
  }

  const heap = heapBytes();
  if (heap !== null) {
    if (lastHeap !== null) {
      const delta = heap - lastHeap;
      const gc = delta < 0;
      if (gc) gcEventsInWindow++;
      else allocBytesInWindow += delta;
      const ad = Math.abs(delta);
      if (ad > 0 && ad < minAbsDelta) minAbsDelta = ad;
      heapEvents.push({ t: nowMs, alloc: gc ? 0 : delta, gc });
      // Trim window + roll the running sums back down.
      while (heapEvents.length && nowMs - heapEvents[0].t > FRAME_WINDOW_MS) {
        const e = heapEvents.shift()!;
        allocBytesInWindow -= e.alloc;
        if (e.gc) gcEventsInWindow--;
      }
    }
    lastHeap = heap;
  }
}

export function getPerfSnapshot(): PerfSnapshot {
  const info = renderer?.info;
  const fps = frameTimes.length;

  const lastMs = frameTimes.length >= 2
    ? frameTimes[frameTimes.length - 1] - frameTimes[frameTimes.length - 2]
    : 0;

  // p95 of frame deltas.
  const deltas: number[] = [];
  for (let i = 1; i < frameTimes.length; i++) deltas.push(frameTimes[i] - frameTimes[i - 1]);
  deltas.sort((a, b) => a - b);
  const p95Ms = deltas.length
    ? deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))]
    : 0;

  const heap = heapBytes();
  const MB = 1024 * 1024;

  return {
    fps,
    lastMs: round(lastMs, 2),
    p95Ms: round(p95Ms, 2),
    draws: perFrameDraws(info),
    tris: info ? info.render.triangles : 0,
    geometries: info ? info.memory.geometries : 0,
    textures: info ? info.memory.textures : 0,
    programs: renderer ? pipelineCount(renderer) : 0,
    geometryPool: getGeometryPoolSize(),
    lightsActive: getActiveSourceCount(),
    lightsRegistered: getRegisteredSourceCount(),
    heapMB: heap !== null ? round(heap / MB, 1) : null,
    heapQuantized: heap !== null ? (minAbsDelta !== Infinity && minAbsDelta >= 1024 * 512) : null,
    allocRateMBs: heap !== null ? round(allocBytesInWindow / MB, 2) : null,
    gcPerSec: heap !== null ? gcEventsInWindow : null,
    gpuMs: (() => { const g = currentGpuMs(); return g !== null ? round(g, 2) : null; })(),
  };
}

function round(n: number, d: number): number {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
