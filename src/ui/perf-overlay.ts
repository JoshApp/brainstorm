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
import { isWebGPU } from '../scene/renderer-mode';
import { getGeometryPoolSize } from '../scene/geometry-pool';
import { getActiveSourceCount, getRegisteredSourceCount } from '../scene/light-pool';
import { getNativeHz, pacerEffectiveFps } from '../scene/frame-pacer';
import { getSettings } from '../settings/settings';

// Chrome-only heap readout (absent on Firefox/Safari). Prod-safe: just a
// number for the overlay, no behavioural effect.
interface PerfMemory { usedJSHeapSize: number }
function heapMB(): number | null {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m ? Math.round((m.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null;
}

let root: HTMLDivElement | null = null;
let fpsEl: HTMLDivElement | null = null;
let secondaryEl: HTMLDivElement | null = null;
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
let lastGeo = 0;
let lastTex = 0;

export function createPerfOverlay(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'perf-overlay'; root.classList.add('game-hud');
  // Sits below the inventory button (at top:16+safearea, height ~40)
  // — pushed down so they don't overlap. Compact card with a colour-
  // coded FPS as the headline read, secondary stats in a quieter
  // micro row below.
  Object.assign(root.style, {
    position: 'fixed',
    top: 'calc(70px + env(safe-area-inset-top, 0px))',
    right: 'calc(12px + env(safe-area-inset-right, 0px))',
    padding: '5px 10px 6px 10px',
    background: 'linear-gradient(180deg, rgba(8, 14, 22, 0.72), rgba(4, 8, 14, 0.78))',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    border: '1px solid rgba(140, 200, 255, 0.28)',
    borderRadius: '6px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
    color: 'rgba(200, 230, 255, 0.92)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    zIndex: '8000',                  // above HUD, below screen-manager screens
    display: 'none',
    minWidth: '128px',
    textAlign: 'right',
  } as Partial<CSSStyleDeclaration>);
  // FPS headline — large + colour-coded.
  fpsEl = document.createElement('div');
  Object.assign(fpsEl.style, {
    fontSize: '18px',
    fontWeight: '700',
    letterSpacing: '0.04em',
    lineHeight: '1.05',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 0 6px rgba(120, 200, 255, 0.25)',
  } as Partial<CSSStyleDeclaration>);
  // Secondary micro-stats.
  secondaryEl = document.createElement('div');
  Object.assign(secondaryEl.style, {
    fontSize: '9.5px',
    fontWeight: '500',
    letterSpacing: '0.07em',
    lineHeight: '1.35',
    color: 'rgba(150, 200, 240, 0.72)',
    marginTop: '2px',
    fontVariantNumeric: 'tabular-nums',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(fpsEl);
  root.appendChild(secondaryEl);
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
  lastGeo   = renderer.info.memory.geometries;
  lastTex   = renderer.info.memory.textures;
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

  if (!fpsEl || !secondaryEl) return;

  // Colour-coded FPS — at-a-glance "am I OK?" read.
  //   >= 55 fps → green, healthy
  //   30..54   → amber, watch it
  //   < 30     → red, something's wrong
  const fpsColor =
    fps >= 55 ? 'rgba(140, 240, 160, 0.95)' :
    fps >= 30 ? 'rgba(255, 200, 120, 0.95)' :
                'rgba(255, 110, 110, 0.95)';
  fpsEl.style.color = fpsColor;
  fpsEl.style.textShadow = `0 0 8px ${fpsColor.replace('0.95', '0.35')}`;
  // Inner span styles the "fps" label one shade dimmer than the number
  // so the number reads as the headline.
  fpsEl.innerHTML =
    `${fps}<span style="font-size:11px;font-weight:500;letter-spacing:.15em;opacity:.65;margin-left:4px;">FPS</span>`;

  const heap = heapMB();
  // Panel native refresh + what the FRAME RATE cap actually resolves to on it
  // (e.g. a 60 cap is 45 on a 90Hz panel). 'native' when uncapped.
  const cap = Number(getSettings().frameCap);
  const capLabel = cap > 0 ? `${pacerEffectiveFps(cap)}` : 'native';
  // Under WebGPU, renderer.info draw/tri/resource counts are unreliable (the
  // node RenderPipeline renders async across multiple passes, so the counters
  // can't be reset cleanly per frame). Show them as n/a rather than a misleading
  // runaway — real WebGPU stats need timestamp queries (the Phase-3 cockpit port).
  const drawsLine = isWebGPU()
    ? `draws n/a · tris n/a  (webgpu — see Phase 3)`
    : `${lastCalls} draws · ${lastTris.toLocaleString()} tris`;
  secondaryEl.textContent =
    `${lastMs.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms\n` +
    `panel ${getNativeHz()}Hz · cap ${capLabel}\n` +
    `${drawsLine}\n` +
    `lights ${getActiveSourceCount()}/${getRegisteredSourceCount()} · geo ${isWebGPU() ? 'n/a' : lastGeo} · tex ${isWebGPU() ? 'n/a' : lastTex}\n` +
    `pool ${getGeometryPoolSize()}${heap !== null ? ` · heap ${heap}MB` : ''}`;
  // Preserve the newline for the secondary block.
  secondaryEl.style.whiteSpace = 'pre';
}
