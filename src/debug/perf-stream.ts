// DETACHED LIVE PROFILER — stream frame samples to a SEPARATE tab.
//
// The in-game profiler HUD (profiler-hud.ts) is honest but it isn't free: it
// redraws a canvas + DOM on the game's OWN main thread and GPU every ~200ms, so
// watching the profiler slightly perturbs the thing you're profiling. Unity's
// "detached profiler" dodges this by rendering in a separate process. The
// browser equivalent: this module does NOTHING but read the per-frame sample
// and postMessage it over a BroadcastChannel; a separate cockpit tab
// (perf-review.html, "● LIVE") subscribes and does ALL the drawing. The game
// tab pays only for sampling (which the recorder already costs) plus one tiny
// structured-clone per frame — no canvas, no layout, no reflow.
//
// Same-ORIGIN, same-BROWSER only (BroadcastChannel doesn't cross devices). That
// covers the desktop case: game in one window, cockpit in another beside it.
// For the phone→desktop case use Chrome remote debugging over USB + the native
// Performance panel reading the ?marks=1 spans (see docs/PERF-FLAMECHART.md) —
// that's the true zero-overhead detached profiler for mobile.
//
// Gated: streaming is OFF until explicitly enabled (F9 / ?stream=1 /
// window.__perfStream), so normal play and even normal profiling pay nothing.

import { addFrameListener, removeFrameListener, gpuActive, type FrameSample } from './frame-timing';
import { getCameraYaw, getCameraPitch } from '../controls/camera';
import { getRenderPixelRatio } from '../style/render-target';
import { getSettings } from '../settings/settings';

export const PERF_CHANNEL = 'delve-perf';

type StreamMsg =
  | { t: 'schema'; names: string[]; gphNames: string[]; meta: Record<string, unknown> }
  | { t: 'frame'; f: StreamFrame }
  | { t: 'attr'; data: unknown }
  | { t: 'hello' };

interface StreamFrame {
  t: number; dt: number; cpu: number; gpu: number | null;
  draws: number; tris: number; heap: number | null; gc: boolean;
  geo: number; tex: number; prog: number;
  sys: number[]; cam: [number, number]; gph?: number[];
}

let chan: BroadcastChannel | null = null;
let enabled = false;
let t0 = 0;

const names: string[] = [];
const nameIdx = new Map<string, number>();
const gphNames: string[] = [];
const gphIdx = new Map<string, number>();

function r2(n: number): number { return Math.round(n * 100) / 100; }

function sysIndex(name: string): number {
  let i = nameIdx.get(name);
  if (i === undefined) { i = names.length; names.push(name); nameIdx.set(name, i); postSchema(); }
  return i;
}
function gphIndex(name: string): number {
  let i = gphIdx.get(name);
  if (i === undefined) { i = gphNames.length; gphNames.push(name); gphIdx.set(name, i); postSchema(); }
  return i;
}

function metaSnapshot(): Record<string, unknown> {
  const s = getSettings();
  return {
    startedAt: new Date().toISOString(),
    targetMs: 1000 / 60,
    gpuSupported: gpuActive(),
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    pixelRatio: getRenderPixelRatio(),
    viewport: [window.innerWidth, window.innerHeight],
    renderScale: s.renderScale,
    graphics: {
      pixelRatioCap: s.pixelRatioCap, renderScale: s.renderScale, frameCap: s.frameCap,
      shadows: s.shadows, bloom: s.bloom, adaptiveResolution: s.adaptiveResolution,
    },
    live: true,
  };
}

function postSchema(): void {
  chan?.postMessage({ t: 'schema', names: names.slice(), gphNames: gphNames.slice(), meta: metaSnapshot() } satisfies StreamMsg);
}

// Last GPU-attribution sweep result, so a cockpit that connects AFTER a sweep
// still gets it (re-sent on the cockpit's 'hello'). main.ts feeds these in via
// onAttributionReport → broadcastAttr; perf-stream stays free of the heavy
// gpu-attribution module.
let lastAttr: unknown = null;
export function broadcastAttr(data: unknown): void {
  lastAttr = data;
  chan?.postMessage({ t: 'attr', data } satisfies StreamMsg);
}

function onFrame(s: FrameSample): void {
  if (!chan) return;
  const now = performance.now();
  const sys = new Array<number>(names.length).fill(0);
  for (const [name, ms] of s.systems) {
    const i = sysIndex(name);
    if (i >= sys.length) sys.length = i + 1;
    sys[i] = r2(ms);
  }
  let gph: number[] | undefined;
  if (s.gpuPhases) {
    gph = new Array<number>(gphNames.length).fill(0);
    for (const [name, ms] of s.gpuPhases) {
      const i = gphIndex(name);
      if (i >= gph.length) gph.length = i + 1;
      gph[i] = r2(ms);
    }
  }
  const f: StreamFrame = {
    t: r2(now - t0),
    dt: r2(s.dt), cpu: r2(s.cpuMs), gpu: s.gpuMs != null ? r2(s.gpuMs) : null,
    draws: s.draws, tris: s.tris,
    heap: s.heapMB != null ? Math.round(s.heapMB) : null, gc: s.gc,
    geo: s.geometries, tex: s.textures, prog: s.programs,
    sys, cam: [r2(getCameraYaw()), r2(getCameraPitch())], gph,
  };
  chan.postMessage({ t: 'frame', f } satisfies StreamMsg);
}

/** Turn the detached live stream on/off. Costs nothing until on; while on, the
 *  only added work over the recorder is one postMessage per frame. */
export function setStreamEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  if (on) {
    chan = new BroadcastChannel(PERF_CHANNEL);
    // A freshly-opened cockpit announces itself; reply with the schema so it can
    // decode the per-frame sys[] arrays without waiting for a name to change.
    chan.onmessage = (e: MessageEvent<StreamMsg>) => {
      if (e.data?.t !== 'hello') return;
      postSchema();
      if (lastAttr) chan?.postMessage({ t: 'attr', data: lastAttr } satisfies StreamMsg);   // catch up a late-joining cockpit
    };
    names.length = 0; nameIdx.clear();
    gphNames.length = 0; gphIdx.clear();
    t0 = performance.now();
    addFrameListener(onFrame);
    postSchema();
  } else {
    removeFrameListener(onFrame);
    chan?.close();
    chan = null;
  }
}
export function streamEnabled(): boolean { return enabled; }
