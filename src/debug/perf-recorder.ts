// Performance session RECORDER. Captures every frame's timing to a ring buffer
// while you play, then ships the whole timeline somewhere you can review it
// with dropped-frame markers against a 60fps target. This is the part the live
// HUD can't do: catch the hitch that happened 8 seconds ago while you were
// fighting, not just the one you're staring at.
//
// Delivery (in order):
//   1. POST the recording JSON to the dev server's /__perf endpoint, which
//      writes it to perf-recordings/ on the PC. Because the phone loaded the
//      game FROM the dev server, this "phone → PC" hop is just a same-origin
//      fetch — no USB, no cable. Review it on the PC at /brainstorm/perf-review.html.
//   2. If there's no dev server (e.g. a static build, or offline), fall back to
//      a file download so you still get the JSON.
//
// DEV-only. Enable recording with F3, ?record=1 (auto-start), or
// window.__perfRec.toggle(). It works whether or not the HUD is visible — both
// read from the shared frame-timing core.

import { addFrameListener, removeFrameListener, gpuSupported, type FrameSample } from './frame-timing';

const TARGET_MS = 1000 / 60;          // 60fps budget
const MAX_DURATION_MS = 60_000;       // auto-stop cap so memory stays bounded

// One recorded frame. Per-system costs are a flat array aligned to the
// recording's `systemNames` index table — compact, and lets the viewer draw a
// stacked per-system timeline.
interface RecFrame {
  t: number;            // ms since record start
  dt: number;           // frame interval ms
  cpu: number;
  gpu: number | null;
  draws: number;
  tris: number;
  heap: number | null;  // MB
  gc: boolean;
  sys: number[];        // per-system ms, aligned to systemNames
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

let recording = false;
let t0 = 0;
let frames: RecFrame[] = [];
const sysIndex = new Map<string, number>();
const sysNames: string[] = [];

function systemIdx(name: string): number {
  let i = sysIndex.get(name);
  if (i === undefined) {
    i = sysNames.length;
    sysNames.push(name);
    sysIndex.set(name, i);
  }
  return i;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function onFrame(s: FrameSample): void {
  const t = performance.now() - t0;
  const sys = new Array<number>(sysNames.length).fill(0);
  for (const [name, ms] of s.systems) {
    const i = systemIdx(name);
    if (i >= sys.length) sys.length = i + 1;   // grow if a new system appeared
    sys[i] = round2(ms);
  }
  frames.push({
    t: round2(t),
    dt: round2(s.dt),
    cpu: round2(s.cpuMs),
    gpu: s.gpuMs !== null ? round2(s.gpuMs) : null,
    draws: s.draws,
    tris: s.tris,
    heap: s.heapMB !== null ? Math.round(s.heapMB) : null,
    gc: s.gc,
    sys,
  });
  if (t >= MAX_DURATION_MS) void stopRecording();
}

export function isRecording(): boolean {
  return recording;
}

// State callback so an on-screen control (the profiler toolbar) can reflect
// recording on/off — including the automatic stop at the duration cap.
let stateListener: ((rec: boolean) => void) | null = null;
export function onRecordingState(cb: ((rec: boolean) => void) | null): void {
  stateListener = cb;
}

export function startRecording(label?: string): void {
  if (recording) return;
  recording = true;
  t0 = performance.now();
  frames = [];
  sysIndex.clear();
  sysNames.length = 0;
  pendingLabel = label;
  addFrameListener(onFrame);
  showBadge();
  stateListener?.(true);
}

let pendingLabel: string | undefined;

export async function stopRecording(): Promise<void> {
  if (!recording) return;
  recording = false;
  removeFrameListener(onFrame);
  hideBadge();
  stateListener?.(false);

  // Normalise every frame's sys array to the final system count (late-appearing
  // systems left earlier rows short).
  for (const f of frames) {
    while (f.sys.length < sysNames.length) f.sys.push(0);
  }

  const rec: Recording = {
    meta: {
      startedAt: new Date().toISOString(),
      durationMs: frames.length ? frames[frames.length - 1].t : 0,
      frameCount: frames.length,
      targetMs: TARGET_MS,
      gpuSupported: gpuSupported(),
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: [window.innerWidth, window.innerHeight],
      label: pendingLabel,
    },
    systemNames: sysNames.slice(),
    frames,
  };
  await deliver(rec);
}

export function toggleRecording(): void {
  if (recording) void stopRecording();
  else startRecording();
}

async function deliver(rec: Recording): Promise<void> {
  const id = `rec-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  let savedTo: string | null = null;
  try {
    const res = await fetch('/__perf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, recording: rec }),
    });
    if (res.ok) {
      const j = (await res.json()) as { id?: string; dir?: string };
      savedTo = j.dir ?? j.id ?? id;
    }
  } catch {
    // No dev server reachable — fall through to download.
  }

  if (savedTo) {
    toast(`saved → ${savedTo}\nreview at /brainstorm/perf-review.html`);
  } else {
    download(`${id}.json`, JSON.stringify(rec));
    toast('no dev server — downloaded JSON\ndrop it on perf-review.html');
  }
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

// --- Tiny on-screen affordances (recording badge + toast) ----------------

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
