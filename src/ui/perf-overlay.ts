// On-screen performance overlay — FPS, frame time, and renderer
// triangle/call counts. Toggleable via Settings → PERF METER. Default
// off; meant for diagnosing frame drops on the phone in the field
// without needing a USB tether or remote DevTools session.
//
// Cheap: one DOM element, no per-frame allocations. Display refreshes
// at 4 Hz so the text doesn't strobe. Frame deltas come from a small
// circular buffer the main loop pushes into.
//
// Three.js renderer.info numbers (triangles, draw calls) are pushed
// in via reportRendererInfo() each frame — kept optional so the
// overlay still works for non-Three.js contexts later.

import type * as THREE from 'three';
import { getGeometryPoolSize } from '../scene/geometry-pool';

let root: HTMLDivElement | null = null;
let lastDisplayUpdate = 0;
const FRAME_WINDOW_MS = 1000;        // rolling 1s for FPS averaging
const DISPLAY_INTERVAL_MS = 250;     // refresh text 4x/sec

// Ring of recent frame timestamps. We allocate up to ~120 entries
// (covers 120fps × 1s); when full we shift, but this only happens
// once per frame at high refresh rates — cheap.
const frameTimes: number[] = [];

// Last-known renderer stats. Pushed in from main.ts (the renderer
// owner). Cached so the display can update independently of when the
// stats arrive.
let lastTris = 0;
let lastCalls = 0;

export function createPerfOverlay(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'perf-overlay';
  Object.assign(root.style, {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top, 0px))',
    right: '10px',
    padding: '4px 8px',
    background: 'rgba(0, 0, 0, 0.55)',
    border: '1px solid rgba(120, 200, 255, 0.35)',
    borderRadius: '3px',
    color: '#a0e8ff',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.05em',
    lineHeight: '1.4',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    zIndex: '8000',                  // above HUD, below screen-manager screens
    display: 'none',
    whiteSpace: 'pre',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(root);
}

export function setPerfOverlayVisible(visible: boolean): void {
  if (!root) return;
  root.style.display = visible ? 'block' : 'none';
}

/** Push renderer stats from main.ts each frame. Optional — the FPS +
 *  ms readout works without it. */
export function reportRendererInfo(renderer: THREE.WebGLRenderer): void {
  if (!root || root.style.display === 'none') return;   // skip work when hidden
  lastTris  = renderer.info.render.triangles;
  lastCalls = renderer.info.render.calls;
}

/** Called once per frame from the main loop. Records the frame time
 *  and refreshes the display text at the display-update interval. */
export function tickPerfOverlay(nowMs: number): void {
  if (!root || root.style.display === 'none') return;

  frameTimes.push(nowMs);
  while (frameTimes.length > 0 && nowMs - frameTimes[0] > FRAME_WINDOW_MS) {
    frameTimes.shift();
  }

  if (nowMs - lastDisplayUpdate < DISPLAY_INTERVAL_MS) return;
  lastDisplayUpdate = nowMs;

  const fps = frameTimes.length;
  // Last-frame ms (more useful than avg for spotting spikes).
  const lastMs = frameTimes.length >= 2
    ? nowMs - frameTimes[frameTimes.length - 2]
    : 0;
  // 95th-percentile ms over the window — surfaces spikes that the
  // smoothed average hides. Rough approximation: sort deltas and pick
  // the 0.95 quantile.
  const deltas: number[] = [];
  for (let i = 1; i < frameTimes.length; i++) {
    deltas.push(frameTimes[i] - frameTimes[i - 1]);
  }
  deltas.sort((a, b) => a - b);
  const p95 = deltas.length
    ? deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))]
    : 0;

  root.textContent =
    `${fps} fps   ${lastMs.toFixed(1)} ms   p95 ${p95.toFixed(1)} ms\n` +
    `${lastTris.toLocaleString()} tris   ${lastCalls} draws   ` +
    `${getGeometryPoolSize()} pooled`;
}
