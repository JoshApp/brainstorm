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

import { addFrameListener, removeFrameListener, gpuActive, gpuSupported, setGpuPassTiming, getCompiledProgramKeys, type FrameSample } from './frame-timing';
import { getCameraYaw, getCameraPitch } from '../controls/camera';
import { getRenderPixelRatio } from '../style/render-frame';
import type { SceneAudit } from './scene-audit';

// Scene-audit provider — main.ts registers a closure over the live scene so a
// saved recording can snapshot WHAT is in the scene graph (leak hunting). Kept
// as a provider so the recorder needn't import the scene/THREE.
let sceneAuditProvider: (() => SceneAudit) | null = null;
export function setSceneAuditProvider(fn: () => SceneAudit): void { sceneAuditProvider = fn; }
import { getSettings } from '../settings/settings';

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
  // GPU-resource counts (renderer.info) — these catch a leak the JS heap can't:
  // geometries/textures created-not-disposed, or the shader program cache
  // growing. If these climb over a session while heap stays flat, that's the
  // degradation (and a WebGL context-loss on tab-out clears it — "tab fixed it").
  geo: number;
  tex: number;
  prog: number;
  sys: number[];        // per-system ms, aligned to sysNames
  /** Camera orientation this frame: [yaw, pitch] in radians. Lets a recording
   *  correlate a GPU/fill spike with WHERE the player was looking — pitch-down
   *  fills the screen with the near floor (peak per-pixel lighting), which a
   *  raw frame-time trace can't explain on its own. */
  cam: [number, number];
  /** Per-render-pass GPU ms aligned to gpuPhaseNames (prepass/scene/bloom/
   *  blit). Present only while per-pass GPU timing is armed — which the ring
   *  does itself on timer-query devices, where the spans are free. */
  gph?: number[];
  /** Discrete events that fired THIS frame (spawn, death, level:N, …) via
   *  tagPerfEvent — the "why" beside a spike. Omitted when nothing fired. */
  ev?: string[];
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
    /** Scene render scale (the PS1 low-res target fraction) — with dpr+viewport
     *  this gives the true GPU fill resolution, the dominant mobile lever. */
    renderScale?: number;
    /** Effective renderer pixel ratio = min(device DPR, the PIXEL DENSITY cap).
     *  The TRUE fill multiplier; `dpr` alone (device native) hides the cap. */
    pixelRatio?: number;
    /** Snapshot of the perf/visual-relevant settings at record time, so a
     *  recording self-documents the config it was taken under (no more guessing
     *  which sliders were where). */
    graphics?: Record<string, unknown>;
    /** Scene-graph drawable tally at save time — names WHAT is in the scene
     *  (corpses/drops/blood/instanced batches), so a climbing geo/draw count in
     *  the frames can be attributed to a leaking category. */
    sceneAudit?: SceneAudit;
    /** FULL cacheKeys of shader programs that compiled during the session — diff
     *  against the warmed set to identify the exact un-warmed variant. */
    compiledKeys?: readonly string[];
    label?: string;
  };
  systemNames: string[];
  gpuPhaseNames?: string[];
  frames: RecFrame[];
}

let rolling = false;
let ring: RecFrame[] = [];
const sysIndex = new Map<string, number>();
const sysNames: string[] = [];

let recording = false;
let recordStartAbs = 0;
let pendingLabel: string | undefined;

// Discrete events tagged on the CURRENT frame (drained into the ring each frame).
let pendingEvents: string[] = [];

/** Tag a discrete event on the current frame (e.g. 'spawn:ghoul', 'death',
 *  'level:3'). No-op unless the dashcam is rolling, so call sites pay nothing in
 *  normal play. The analyzer correlates these with spikes — the "why". */
export function tagPerfEvent(name: string): void {
  if (!rolling || !name) return;
  if (pendingEvents.length < 16) pendingEvents.push(name);
}

// Auto-spike "dashcam trigger": while rolling, a frame that blows past the
// recent baseline auto-saves the window AROUND it (incl. ~1.2s of after-context)
// — so spikes in motion record themselves without you hitting save. Cooled down
// + capped so a bad stretch saves once and a session can't spam the disk.
let autoCapture = true;
let lastAutoSpikeAt = -Infinity;
let autoSpikeCount = 0;
const SPIKE_ABS_MS = 45;        // ignore anything under this (sub-22fps frame)
const SPIKE_MUL = 2.2;          // ...AND must be this × the recent median
const SPIKE_COOLDOWN_MS = 5000;
const SPIKE_POST_MS = 1200;     // delay the save so after-context lands in the window
const SPIKE_WINDOW_S = 4;
const MAX_AUTO_CAPTURES = 16;

export function setAutoCapture(on: boolean): void { autoCapture = on; }

/** Median frame dt over the recent ring tail — the baseline a spike must beat.
 *  Only called when a frame already exceeded SPIKE_ABS_MS, so the sort is rare. */
function recentMedianDt(): number {
  const n = Math.min(ring.length, 90);
  if (n < 20) return TARGET_MS;
  const recent = ring.slice(ring.length - n).map((f) => f.dt).sort((a, b) => a - b);
  return recent[Math.floor(n / 2)];
}

const gphIndex = new Map<string, number>();
const gphNames: string[] = [];

function systemIdx(name: string): number {
  let i = sysIndex.get(name);
  if (i === undefined) { i = sysNames.length; sysNames.push(name); sysIndex.set(name, i); }
  return i;
}
function gpuPhaseIdx(name: string): number {
  let i = gphIndex.get(name);
  if (i === undefined) { i = gphNames.length; gphNames.push(name); gphIndex.set(name, i); }
  return i;
}
function snapshotGph(phases: Map<string, number>): number[] {
  const arr = new Array<number>(gphNames.length).fill(0);
  for (const [name, ms] of phases) {
    const i = gpuPhaseIdx(name);
    if (i >= arr.length) arr.length = i + 1;
    arr[i] = r2(ms);
  }
  return arr;
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

/** Perf/visual-relevant settings at record time — so a recording self-documents
 *  the config it ran under (which sliders/toggles were where). One snapshot per
 *  export, in meta. */
function graphicsSnapshot(): Record<string, unknown> {
  const s = getSettings();
  return {
    pixelRatioCap: s.pixelRatioCap,
    renderScale: s.renderScale,
    frameCap: s.frameCap,
    shadows: s.shadows,
    bloom: s.bloom,
    adaptiveResolution: s.adaptiveResolution,
    portalCulling: s.portalCulling,
    surfaceDetail: s.surfaceDetail,
    bandedLighting: s.bandedLighting,
    aoStrength: s.aoStrength,
    brightness: s.brightness,
    wick: s.wick,
  };
}

function onRingFrame(s: FrameSample): void {
  const now = performance.now();
  const evList = pendingEvents.length ? pendingEvents.slice() : [];
  pendingEvents.length = 0;
  // Fold in any shader programs that compiled this frame, tagged by type
  // ('C:physical', 'C:distanceRGBA'=shadow caster, …) — names what froze a frame.
  for (const k of s.newProgKinds ?? []) evList.push('C:' + k);
  const ev = evList.length ? evList : undefined;
  ring.push({
    t: now,
    dt: r2(s.dt),
    cpu: r2(s.cpuMs),
    gpu: s.gpuMs !== null ? r2(s.gpuMs) : null,
    draws: s.draws,
    tris: s.tris,
    heap: s.heapMB !== null ? Math.round(s.heapMB) : null,
    gc: s.gc,
    geo: s.geometries,
    tex: s.textures,
    prog: s.programs,
    sys: snapshotSys(s.systems),
    cam: [r2(getCameraYaw()), r2(getCameraPitch())],
    gph: s.gpuPhases ? snapshotGph(s.gpuPhases) : undefined,
    ev,
  });
  const cutoff = now - RING_CAP_MS;
  while (ring.length && ring[0].t < cutoff) ring.shift();
  // Cap an explicit recording at the ring length so it can't outrun the buffer.
  if (recording && now - recordStartAbs >= RING_CAP_MS) void stopRecording();

  // AUTO-SPIKE: a frame well past the recent baseline records its own window.
  // Dev hosts only — the dashcam is a dev-server workflow (silent POST + review).
  // On a public build there's no server, so an auto-save would become a passive
  // FILE DOWNLOAD on every frame hitch; gate it out. (Manual saves still work.)
  if (autoCapture && isLocalDevHost() && !recording && autoSpikeCount < MAX_AUTO_CAPTURES
      && s.dt > SPIKE_ABS_MS && now - lastAutoSpikeAt > SPIKE_COOLDOWN_MS
      && s.dt > recentMedianDt() * SPIKE_MUL) {
    lastAutoSpikeAt = now;
    autoSpikeCount++;
    const tag = ev?.length ? ' · ' + ev.join(',') : '';
    const label = `spike ${Math.round(s.dt)}ms${tag}`;
    // Delay so the window captures ~1.2s of AFTER-context, not just the lead-up.
    window.setTimeout(() => { void saveLastSeconds(SPIKE_WINDOW_S, label); }, SPIKE_POST_MS);
  }
}

/** Turn the dashcam ring on/off. Driven by the PROFILER TOOLS setting. */
export function setRollingEnabled(on: boolean): void {
  if (on === rolling) return;
  rolling = on;
  if (on) {
    ring = [];
    sysIndex.clear();
    sysNames.length = 0;
    gphIndex.clear();
    gphNames.length = 0;
    pendingEvents.length = 0;
    lastAutoSpikeAt = -Infinity;
    autoSpikeCount = 0;
    addFrameListener(onRingFrame);
    // On timer-query devices per-pass GPU spans are passive and free — arm
    // them whenever the ring rolls, so every recording (incl. the dashcam)
    // carries the per-pass breakdown without anyone touching PASS. Devices
    // without the extension are left alone: the readPixels fallback stalls
    // sampled frames and would pollute the very recording it feeds.
    if (gpuSupported()) setGpuPassTiming(true);
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
    let gph = f.gph;
    if (gph) {
      gph = gph.slice();
      while (gph.length < gphNames.length) gph.push(0);
    }
    return { ...f, t: r2(f.t - base), sys, gph };
  });
  return {
    meta: {
      startedAt: new Date().toISOString(),
      durationMs: frames.length ? frames[frames.length - 1].t : 0,
      frameCount: frames.length,
      targetMs: TARGET_MS,
      gpuSupported: gpuActive(),
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      pixelRatio: getRenderPixelRatio(),
      viewport: [window.innerWidth, window.innerHeight],
      renderScale: getSettings().renderScale,
      graphics: graphicsSnapshot(),
      sceneAudit: sceneAuditProvider ? sceneAuditProvider() : undefined,
      compiledKeys: getCompiledProgramKeys().slice(),   // full cacheKeys of in-session compiles
      label,
    },
    systemNames: sysNames.slice(),
    gpuPhaseNames: gphNames.length ? gphNames.slice() : undefined,
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
