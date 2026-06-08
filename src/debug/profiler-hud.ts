// DEV profiler HUD — the in-engine equivalent of Unity's Profiler window,
// aimed squarely at the question "we added stuff and the frame rate dropped;
// WHAT got slower?" The existing PERF METER (src/ui/perf-overlay.ts) answers
// "how fast are we?" on the phone. This answers "where is the time going?":
//
//   • CPU ms  — wall-clock cost of one full system pass (script + draw-call
//               submission), measured around runSystems().
//   • GPU ms  — actual GPU execution time of the frame, via WebGL2 timer
//               queries (src/debug/gpu-timer.ts). CPU-bound vs GPU-bound is
//               the first fork in any perf hunt; this tells you which.
//   • System breakdown — every entry in engine/systems.ts, smoothed and
//               sorted by cost, with a bar. THIS is the regression finder:
//               if the new arm viewmodels cost you, 'weapon' / 'view-sway' /
//               'render' light up here. Toggle it on, walk the dungeon, watch
//               which row climbs.
//   • Graph   — rolling CPU (bars) + GPU (line) history with 60/30 fps guide
//               lines, so a periodic hitch (GC, a spawn, a room load) shows
//               as a spike you can SEE rather than a number you might miss.
//   • Memory  — JS heap + allocation rate (MB/s) + GC events/s. A climbing
//               alloc rate with periodic heap drops = per-frame garbage =
//               stutter. Flat heap = clean.
//
// DEV-ONLY. The whole module is imported behind `if (import.meta.env.DEV)` in
// main.ts, so it tree-shakes out of the production bundle entirely. Enable it
// with `?profile=1` in the URL, the F2 key, or `window.__profiler()` in the
// console. Zero cost when hidden: the per-system probe is only installed while
// the HUD is visible, so the instrumented runSystems path isn't even taken in
// normal play.

import type * as THREE from 'three';
import { GpuTimer } from './gpu-timer';
import { setSystemProbe } from '../engine/loop';
import { getGeometryPoolSize } from '../scene/geometry-pool';
import { getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';

interface PerfMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}
function heapBytes(): number | null {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m ? m.usedJSHeapSize : null;
}

const GRAPH_W = 200;
const GRAPH_H = 46;
const HISTORY = GRAPH_W;              // one frame per column
const DISPLAY_INTERVAL_MS = 200;      // refresh text/graph 5×/sec
const EMA = 0.1;                      // smoothing for headline + system rows

let renderer: THREE.WebGLRenderer | null = null;
let gpu: GpuTimer | null = null;
let active = false;

// DOM
let root: HTMLDivElement | null = null;
let headEl: HTMLDivElement | null = null;
let statsEl: HTMLDivElement | null = null;
let sysEl: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;

// Per-frame system accumulation + smoothed costs.
const frameMs = new Map<string, number>();   // this frame, reset each begin
const emaMs = new Map<string, number>();      // smoothed per system

// Frame timing.
let frameStart = 0;
let cpuEma = 0;
let gpuEma = 0;
const cpuHist: number[] = [];
const gpuHist: number[] = [];

// FPS window.
const frameStamps: number[] = [];

// Heap / GC churn (compact version of perf-probe's tracker).
let lastHeap: number | null = null;
let allocInWindow = 0;
let gcInWindow = 0;
const heapEvents: Array<{ t: number; alloc: number; gc: boolean }> = [];

let lastDisplay = 0;

function onSystem(name: string, ms: number): void {
  frameMs.set(name, (frameMs.get(name) ?? 0) + ms);
}

export function createProfilerHud(r: THREE.WebGLRenderer): void {
  if (!import.meta.env.DEV) return;   // belt-and-suspenders; folds away in prod
  if (root) return;
  renderer = r;
  gpu = new GpuTimer(r.getContext());

  root = document.createElement('div');
  root.id = 'profiler-hud';
  Object.assign(root.style, {
    position: 'fixed',
    top: 'calc(70px + env(safe-area-inset-top, 0px))',
    left: 'calc(12px + env(safe-area-inset-left, 0px))',
    padding: '7px 9px 8px 9px',
    width: `${GRAPH_W + 18}px`,
    background: 'linear-gradient(180deg, rgba(10, 12, 20, 0.82), rgba(4, 6, 12, 0.86))',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    border: '1px solid rgba(150, 180, 255, 0.24)',
    borderRadius: '7px',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.6)',
    color: 'rgba(210, 225, 245, 0.92)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '10px',
    lineHeight: '1.4',
    fontVariantNumeric: 'tabular-nums',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    zIndex: '8000',
    display: 'none',
  } as Partial<CSSStyleDeclaration>);

  headEl = document.createElement('div');
  Object.assign(headEl.style, { fontSize: '11px', fontWeight: '700', letterSpacing: '0.02em', marginBottom: '4px' } as Partial<CSSStyleDeclaration>);

  canvas = document.createElement('canvas');
  canvas.width = GRAPH_W;
  canvas.height = GRAPH_H;
  Object.assign(canvas.style, { width: `${GRAPH_W}px`, height: `${GRAPH_H}px`, display: 'block', borderRadius: '3px', marginBottom: '5px' } as Partial<CSSStyleDeclaration>);
  ctx2d = canvas.getContext('2d');

  statsEl = document.createElement('div');
  Object.assign(statsEl.style, { color: 'rgba(160, 195, 235, 0.78)', whiteSpace: 'pre', marginBottom: '5px' } as Partial<CSSStyleDeclaration>);

  sysEl = document.createElement('div');
  Object.assign(sysEl.style, { borderTop: '1px solid rgba(150, 180, 255, 0.16)', paddingTop: '4px' } as Partial<CSSStyleDeclaration>);

  root.appendChild(headEl);
  root.appendChild(canvas);
  root.appendChild(statsEl);
  root.appendChild(sysEl);
  document.body.appendChild(root);
}

export function isProfilerVisible(): boolean {
  return active;
}

export function setProfilerVisible(visible: boolean): void {
  if (!import.meta.env.DEV || !root) return;
  active = visible;
  root.style.display = visible ? 'block' : 'none';
  // Install the per-system probe ONLY while visible — that's what keeps the
  // instrumented runSystems path (and its per-system performance.now calls)
  // out of normal play entirely.
  setSystemProbe(visible ? onSystem : null);
  if (!visible) {
    frameMs.clear();
  }
}

export function toggleProfiler(): void {
  setProfilerVisible(!active);
}

/** Open a frame measurement. Call immediately BEFORE runSystems(). */
export function profilerBeginFrame(): void {
  if (!active) return;
  frameMs.clear();
  frameStart = performance.now();
  gpu?.begin();
}

/** Close the frame measurement + refresh the HUD. Call right AFTER runSystems(). */
export function profilerEndFrame(): void {
  if (!active) return;
  const now = performance.now();
  const cpuMs = now - frameStart;
  gpu?.end();
  gpu?.poll();

  // FPS window.
  frameStamps.push(now);
  while (frameStamps.length && now - frameStamps[0] > 1000) frameStamps.shift();

  // Smooth headline numbers so they don't strobe; graph uses raw values.
  cpuEma = cpuEma ? cpuEma * (1 - EMA) + cpuMs * EMA : cpuMs;
  const gms = gpu?.lastMs ?? 0;
  gpuEma = gpuEma ? gpuEma * (1 - EMA) + gms * EMA : gms;

  cpuHist.push(cpuMs);
  gpuHist.push(gms);
  if (cpuHist.length > HISTORY) cpuHist.shift();
  if (gpuHist.length > HISTORY) gpuHist.shift();

  // Per-system EMA: decay systems that didn't run, update those that did.
  for (const [name, ema] of emaMs) {
    if (!frameMs.has(name)) emaMs.set(name, ema * (1 - EMA));
  }
  for (const [name, ms] of frameMs) {
    emaMs.set(name, (emaMs.get(name) ?? ms) * (1 - EMA) + ms * EMA);
  }

  // Heap / GC churn.
  const heap = heapBytes();
  if (heap !== null) {
    if (lastHeap !== null) {
      const delta = heap - lastHeap;
      const gc = delta < 0;
      if (gc) gcInWindow++; else allocInWindow += delta;
      heapEvents.push({ t: now, alloc: gc ? 0 : delta, gc });
      while (heapEvents.length && now - heapEvents[0].t > 1000) {
        const e = heapEvents.shift()!;
        allocInWindow -= e.alloc;
        if (e.gc) gcInWindow--;
      }
    }
    lastHeap = heap;
  }

  if (now - lastDisplay >= DISPLAY_INTERVAL_MS) {
    lastDisplay = now;
    refresh(heap);
  }
}

function msColor(ms: number, budget: number): string {
  if (ms <= budget * 0.7) return 'rgba(140, 240, 160, 0.95)';
  if (ms <= budget) return 'rgba(255, 210, 130, 0.95)';
  return 'rgba(255, 120, 120, 0.95)';
}

function refresh(heap: number | null): void {
  if (!headEl || !statsEl || !sysEl) return;
  const fps = frameStamps.length;

  // Headline: FPS · CPU · GPU. Budget = 16.7ms (60fps); colour against it.
  const cpuC = msColor(cpuEma, 16.7);
  const gpuStr = gpu?.supported
    ? `<span style="color:${msColor(gpuEma, 16.7)}">${gpuEma.toFixed(1)}</span>gpu`
    : `<span style="opacity:.5">n/a gpu</span>`;
  headEl.innerHTML =
    `<span style="color:${fps >= 55 ? 'rgba(140,240,160,.95)' : fps >= 30 ? 'rgba(255,210,130,.95)' : 'rgba(255,120,120,.95)'}">${fps}</span>` +
    `<span style="opacity:.55;font-weight:500"> fps  </span>` +
    `<span style="color:${cpuC}">${cpuEma.toFixed(1)}</span><span style="opacity:.55;font-weight:500">cpu </span>` +
    gpuStr;

  drawGraph();

  const info = renderer?.info;
  const MB = 1024 * 1024;
  const heapMB = heap !== null ? (heap / MB).toFixed(0) : '—';
  const allocMBs = heap !== null ? (allocInWindow / MB).toFixed(1) : '—';
  statsEl.textContent =
    `${info ? info.render.calls : 0} draws · ${((info ? info.render.triangles : 0) / 1000).toFixed(0)}k tris\n` +
    `prog ${info?.programs?.length ?? 0} · geo ${info ? info.memory.geometries : 0} · tex ${info ? info.memory.textures : 0} · pool ${getGeometryPoolSize()}\n` +
    `lights ${getActiveSourceCount()}/${getRegisteredSourceCount()}\n` +
    `heap ${heapMB}MB · alloc ${allocMBs}MB/s · gc ${heap !== null ? gcInWindow : '—'}/s`;

  // System breakdown — top costs, sorted desc.
  const rows = [...emaMs.entries()].filter(([, ms]) => ms > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = rows.length ? rows[0][1] : 1;
  let html = '<div style="opacity:.5;letter-spacing:.04em;margin-bottom:2px">SYSTEMS ms</div>';
  for (const [name, ms] of rows) {
    const barW = Math.max(2, Math.round((ms / max) * 56));
    const c = msColor(ms, 4);   // 4ms is a chunky single-system budget
    html +=
      `<div style="display:flex;align-items:center;gap:5px;height:13px">` +
      `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.82">${name}</span>` +
      `<span style="color:${c};width:30px;text-align:right">${ms.toFixed(2)}</span>` +
      `<span style="width:${barW}px;height:6px;background:${c};border-radius:1px;opacity:.7"></span>` +
      `</div>`;
  }
  sysEl.innerHTML = html;
}

function drawGraph(): void {
  if (!ctx2d) return;
  const g = ctx2d;
  g.clearRect(0, 0, GRAPH_W, GRAPH_H);
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.fillRect(0, 0, GRAPH_W, GRAPH_H);

  // Scale so 33.3ms (30fps) always fits; grow if we're spiking past it.
  let peak = 33.4;
  for (const v of cpuHist) if (v > peak) peak = v;
  for (const v of gpuHist) if (v > peak) peak = v;
  const y = (ms: number) => GRAPH_H - (ms / peak) * GRAPH_H;

  // Guide lines: 60fps (green) + 30fps (amber).
  for (const [budget, col] of [[16.7, 'rgba(140,240,160,0.35)'], [33.3, 'rgba(255,210,130,0.3)']] as const) {
    if (budget > peak) continue;
    const gy = y(budget);
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, gy);
    g.lineTo(GRAPH_W, gy);
    g.stroke();
  }

  // CPU as faint bars.
  const n = cpuHist.length;
  const x0 = GRAPH_W - n;
  g.fillStyle = 'rgba(120, 190, 255, 0.45)';
  for (let i = 0; i < n; i++) {
    const h = GRAPH_H - y(cpuHist[i]);
    g.fillRect(x0 + i, GRAPH_H - h, 1, h);
  }
  // GPU as a magenta line over the top.
  if (gpu?.supported && gpuHist.length) {
    g.strokeStyle = 'rgba(255, 130, 220, 0.9)';
    g.lineWidth = 1;
    g.beginPath();
    const m = gpuHist.length;
    const gx0 = GRAPH_W - m;
    for (let i = 0; i < m; i++) {
      const px = gx0 + i;
      const py = y(gpuHist[i]);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
}
