// DEV profiler HUD — the in-engine equivalent of Unity's Profiler window,
// aimed at "we added stuff and the frame rate dropped; WHAT got slower?"
//
//   • CPU ms  — wall-clock of one full system pass (script + draw submission).
//   • GPU ms  — actual GPU execution time via WebGL2 timer queries.
//   • System breakdown — every engine system, smoothed + sorted by cost, with
//     a bar. THIS is the regression finder: watch which row climbs.
//   • Graph   — rolling CPU (bars) + GPU (line) history with 60/30 fps guides.
//   • Memory  — heap + allocation rate (MB/s) + GC events/s.
//
// It's a thin VIEW now: all timing comes from frame-timing.ts (shared with the
// session recorder so the two can run together). DEV-only; tree-shaken from
// prod. Enable with ?profile=1, F2, or window.__profiler().

import { addFrameListener, removeFrameListener, gpuSupported, type FrameSample } from './frame-timing';

const GRAPH_W = 200;
const GRAPH_H = 46;
const HISTORY = GRAPH_W;
const DISPLAY_INTERVAL_MS = 200;
const EMA = 0.1;

let active = false;

// DOM
let root: HTMLDivElement | null = null;
let headEl: HTMLDivElement | null = null;
let statsEl: HTMLDivElement | null = null;
let sysEl: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;

// Smoothed state.
const emaMs = new Map<string, number>();
let cpuEma = 0;
let gpuEma = 0;
const cpuHist: number[] = [];
const gpuHist: number[] = [];
const frameStamps: number[] = [];
let lastDisplay = 0;

// Latest renderer/memory readout, refreshed each frame.
let last: FrameSample | null = null;

export function createProfilerHud(): void {
  if (root) return;

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
  if (!root) return;
  if (visible === active) return;
  active = visible;
  root.style.display = visible ? 'block' : 'none';
  if (visible) addFrameListener(onFrame);
  else removeFrameListener(onFrame);
}

export function toggleProfiler(): void {
  setProfilerVisible(!active);
}

function onFrame(s: FrameSample): void {
  last = s;
  const now = performance.now();

  frameStamps.push(now);
  while (frameStamps.length && now - frameStamps[0] > 1000) frameStamps.shift();

  cpuEma = cpuEma ? cpuEma * (1 - EMA) + s.cpuMs * EMA : s.cpuMs;
  const gms = s.gpuMs ?? 0;
  gpuEma = gpuEma ? gpuEma * (1 - EMA) + gms * EMA : gms;

  cpuHist.push(s.cpuMs);
  gpuHist.push(gms);
  if (cpuHist.length > HISTORY) cpuHist.shift();
  if (gpuHist.length > HISTORY) gpuHist.shift();

  // Per-system EMA: decay systems that didn't run, update those that did.
  for (const [name, ema] of emaMs) {
    if (!s.systems.has(name)) emaMs.set(name, ema * (1 - EMA));
  }
  for (const [name, ms] of s.systems) {
    emaMs.set(name, (emaMs.get(name) ?? ms) * (1 - EMA) + ms * EMA);
  }

  if (now - lastDisplay >= DISPLAY_INTERVAL_MS) {
    lastDisplay = now;
    refresh();
  }
}

function msColor(ms: number, budget: number): string {
  if (ms <= budget * 0.7) return 'rgba(140, 240, 160, 0.95)';
  if (ms <= budget) return 'rgba(255, 210, 130, 0.95)';
  return 'rgba(255, 120, 120, 0.95)';
}

function refresh(): void {
  if (!headEl || !statsEl || !sysEl || !last) return;
  const fps = frameStamps.length;

  const cpuC = msColor(cpuEma, 16.7);
  const gpuStr = gpuSupported()
    ? `<span style="color:${msColor(gpuEma, 16.7)}">${gpuEma.toFixed(1)}</span>gpu`
    : `<span style="opacity:.5">n/a gpu</span>`;
  headEl.innerHTML =
    `<span style="color:${fps >= 55 ? 'rgba(140,240,160,.95)' : fps >= 30 ? 'rgba(255,210,130,.95)' : 'rgba(255,120,120,.95)'}">${fps}</span>` +
    `<span style="opacity:.55;font-weight:500"> fps  </span>` +
    `<span style="color:${cpuC}">${cpuEma.toFixed(1)}</span><span style="opacity:.55;font-weight:500">cpu </span>` +
    gpuStr;

  drawGraph();

  const heapMB = last.heapMB !== null ? last.heapMB.toFixed(0) : '—';
  statsEl.textContent =
    `${last.draws} draws · ${(last.tris / 1000).toFixed(0)}k tris\n` +
    `prog ${last.programs} · geo ${last.geometries} · tex ${last.textures} · pool ${last.geometryPool}\n` +
    `lights ${last.lightsActive}/${last.lightsRegistered}\n` +
    `heap ${heapMB}MB${last.gc ? ' · GC' : ''}`;

  const rows = [...emaMs.entries()].filter(([, ms]) => ms > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = rows.length ? rows[0][1] : 1;
  let html = '<div style="opacity:.5;letter-spacing:.04em;margin-bottom:2px">SYSTEMS ms</div>';
  for (const [name, ms] of rows) {
    const barW = Math.max(2, Math.round((ms / max) * 56));
    const c = msColor(ms, 4);
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

  let peak = 33.4;
  for (const v of cpuHist) if (v > peak) peak = v;
  for (const v of gpuHist) if (v > peak) peak = v;
  const y = (ms: number) => GRAPH_H - (ms / peak) * GRAPH_H;

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

  const n = cpuHist.length;
  const x0 = GRAPH_W - n;
  g.fillStyle = 'rgba(120, 190, 255, 0.45)';
  for (let i = 0; i < n; i++) {
    const h = GRAPH_H - y(cpuHist[i]);
    g.fillRect(x0 + i, GRAPH_H - h, 1, h);
  }
  if (gpuSupported() && gpuHist.length) {
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
