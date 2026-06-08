// Performance session RECORDER — with a "dashcam" rolling buffer.
//
// The problem with a plain start/stop recorder: it only helps if you pressed
// REC *before* the hitch. But the drops you most want to catch are the ones you
// can't predict ("fps dropped at some point and I couldn't tell when"). So
// while the profiler tools are enabled, this ALWAYS keeps the last ~60s of
// frames in a ring buffer. Three ways to get a recording out of it:
//
//   • SAVE LAST 15s — snapshot the tail of the ring. Felt a hitch? Hit save,
//     it's already captured. This is the dashcam.
//   • ● REC / ■ STOP — mark an explicit span (a whole boss fight, say).
//   • window.__perfRec.{start,stop,saveLast}().
//
// Delivery picks the best channel for where you are:
//   • On a dev server (localhost / LAN) → POST to /__perf, lands on the PC.
//   • On the live build (a phone) → navigator.share() into the OS share sheet
//     (AirDrop / email-to-self), falling back to a file download.
// Review either way at /brainstorm/perf-review.html.
//
// Ships behind the PROFILER TOOLS setting (not DEV-gated). The ring only fills
// while the tools are enabled, so there's no cost for players. Note: buffering
// allocates a small per-frame record, so the profiler's own GC/alloc readout
// carries a little constant overhead while the tools are on — expected.

import { addFrameListener, removeFrameListener, gpuSupported, type FrameSample } from './frame-timing';

const TARGET_MS = 1000 / 60;          // 60fps budget
const RING_CAP_MS = 60_000;           // keep the last 60s; also the explicit-record cap
const DASHCAM_SECS = 15;              // default "save last N"

interface RecFrame {
  t: number;            // absolute performance.now() in the ring; rebased on export
  dt: number;
  cpu: number;
  gpu: number | null;
  draws: number;
  tris: number;
  heap: number | null;  // MB
  gc: boolean;
  sys: number[];        // per-system ms, aligned to sysNames
}

export interface Recording {
  meta: {
    startedAt: string;
    durationMs: number;
    frameCount: number;
    targetMs: number;
    gpuSupported: boolean;
    ua: string;
    dpr: number;
    viewport: [number, number];
    label?: string;
  };
  systemNames: string[];
  frames: RecFrame[];
}

let rolling = false;
let ring: RecFrame[] = [];
const sysIndex = new Map<string, number>();
const sysNames: string[] = [];

let recording = false;
let recordStartAbs = 0;
let pendingLabel: string | undefined;

function systemIdx(name: string): number {
  let i = sysIndex.get(name);
  if (i === undefined) { i = sysNames.length; sysNames.push(name); sysIndex.set(name, i); }
  return i;
}
function r2(n: number): number { return Math.round(n * 100) / 100; }

function snapshotSys(systems: Map<string, number>): number[] {
  const arr = new Array<number>(sysNames.length).fill(0);
  for (const [name, ms] of systems) {
    const i = systemIdx(name);
    if (i >= arr.length) arr.length = i + 1;
    arr[i] = r2(ms);
  }
  return arr;
}

function onRingFrame(s: FrameSample): void {
  const now = performance.now();
  ring.push({
    t: now,
    dt: r2(s.dt),
    cpu: r2(s.cpuMs),
    gpu: s.gpuMs !== null ? r2(s.gpuMs) : null,
    draws: s.draws,
    tris: s.tris,
    heap: s.heapMB !== null ? Math.round(s.heapMB) : null,
    gc: s.gc,
    sys: snapshotSys(s.systems),
  });
  const cutoff = now - RING_CAP_MS;
  while (ring.length && ring[0].t < cutoff) ring.shift();
  // Cap an explicit recording at the ring length so it can't outrun the buffer.
  if (recording && now - recordStartAbs >= RING_CAP_MS) void stopRecording();
}

/** Turn the dashcam ring on/off. Driven by the PROFILER TOOLS setting. */
export function setRollingEnabled(on: boolean): void {
  if (on === rolling) return;
  rolling = on;
  if (on) {
    ring = [];
    sysIndex.clear();
    sysNames.length = 0;
    addFrameListener(onRingFrame);
  } else {
    removeFrameListener(onRingFrame);
    ring = [];
    if (recording) { recording = false; hideBadge(); stateListener?.(false); }
  }
}

export function isRecording(): boolean { return recording; }

let stateListener: ((rec: boolean) => void) | null = null;
export function onRecordingState(cb: ((rec: boolean) => void) | null): void { stateListener = cb; }

export function startRecording(label?: string): void {
  if (recording) return;
  if (!rolling) setRollingEnabled(true);   // self-arm if called directly
  recording = true;
  recordStartAbs = performance.now();
  pendingLabel = label;
  showBadge();
  stateListener?.(true);
}

export async function stopRecording(): Promise<void> {
  if (!recording) return;
  recording = false;
  hideBadge();
  stateListener?.(false);
  const slice = ring.filter((f) => f.t >= recordStartAbs);
  await deliver(buildExport(slice, pendingLabel));
}

export function toggleRecording(): void {
  if (recording) void stopRecording();
  else startRecording();
}

/** Dashcam: export the last `secs` seconds from the ring. */
export async function saveLastSeconds(secs = DASHCAM_SECS, label?: string): Promise<void> {
  if (!rolling || !ring.length) return;
  const cutoff = performance.now() - secs * 1000;
  const slice = ring.filter((f) => f.t >= cutoff);
  await deliver(buildExport(slice, label ?? `last-${secs}s`));
}

function buildExport(slice: RecFrame[], label?: string): Recording {
  const base = slice.length ? slice[0].t : 0;
  const frames: RecFrame[] = slice.map((f) => {
    const sys = f.sys.slice();
    while (sys.length < sysNames.length) sys.push(0);   // pad late-appearing systems
    return { ...f, t: r2(f.t - base), sys };
  });
  return {
    meta: {
      startedAt: new Date().toISOString(),
      durationMs: frames.length ? frames[frames.length - 1].t : 0,
      frameCount: frames.length,
      targetMs: TARGET_MS,
      gpuSupported: gpuSupported(),
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: [window.innerWidth, window.innerHeight],
      label,
    },
    systemNames: sysNames.slice(),
    frames,
  };
}

// --- Delivery ------------------------------------------------------------

function isLocalDevHost(): boolean {
  // localhost or a private-LAN IP (the phone hitting `vite --host`) → a dev
  // server is there to POST to. Public hosts (github.io) → no server.
  return /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)
    || location.hostname.endsWith('.local');
}

async function deliver(rec: Recording): Promise<void> {
  const id = `rec-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const json = JSON.stringify(rec);

  if (isLocalDevHost()) {
    try {
      const res = await fetch('/__perf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, recording: rec }),
      });
      if (res.ok) {
        const j = (await res.json()) as { dir?: string; id?: string };
        toast(`saved → ${j.dir ?? id}\nreview at /brainstorm/perf-review.html`);
        return;
      }
    } catch { /* fall through to download */ }
    download(`${id}.json`, json);
    toast('downloaded JSON\ndrop it on perf-review.html');
    return;
  }

  // Live build (phone): share sheet first, then download. Called synchronously
  // from the button tap so the share gesture stays valid (no awaited fetch
  // ahead of it on this path).
  const nav = navigator as Navigator & {
    canShare?: (d: { files: File[] }) => boolean;
    share?: (d: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };
  try {
    const file = new File([json], `${id}.json`, { type: 'application/json' });
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: 'DELVE perf recording', text: rec.meta.label ?? '' });
      toast('shared recording');
      return;
    }
  } catch { /* user cancelled or share failed — fall through */ }
  download(`${id}.json`, json);
  toast('downloaded JSON\nopen perf-review.html, drop it in');
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// --- On-screen affordances (recording badge + toast) ---------------------

let badge: HTMLDivElement | null = null;
function showBadge(): void {
  if (badge) { badge.style.display = 'flex'; return; }
  badge = document.createElement('div');
  Object.assign(badge.style, {
    position: 'fixed',
    top: 'calc(12px + env(safe-area-inset-top, 0px))',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    background: 'rgba(20, 4, 4, 0.82)',
    border: '1px solid rgba(255, 90, 90, 0.5)',
    borderRadius: '20px',
    color: 'rgba(255, 180, 180, 0.95)',
    font: '600 11px ui-monospace, monospace',
    letterSpacing: '0.08em',
    pointerEvents: 'none',
    zIndex: '9000',
  } as Partial<CSSStyleDeclaration>);
  badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#ff4040;animation:perfblink 1s steps(2,start) infinite"></span>REC`;
  const style = document.createElement('style');
  style.textContent = '@keyframes perfblink{to{opacity:0}}';
  document.head.appendChild(style);
  document.body.appendChild(badge);
}
function hideBadge(): void {
  if (badge) badge.style.display = 'none';
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    Object.assign(toastEl.style, {
      position: 'fixed',
      bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: '80vw',
      padding: '8px 14px',
      background: 'rgba(8, 14, 22, 0.9)',
      border: '1px solid rgba(140, 200, 255, 0.35)',
      borderRadius: '8px',
      color: 'rgba(200, 230, 255, 0.95)',
      font: '500 12px ui-monospace, monospace',
      whiteSpace: 'pre',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: '9000',
      transition: 'opacity 0.3s',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 4000);
}
