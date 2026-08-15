import type * as THREE from 'three';
import { getSettings } from '../settings/settings';
import { initFrameTiming, setMarks, marksOn } from './frame-timing';
import { setStreamEnabled, streamEnabled, broadcastAttr } from './perf-stream';
import { startRecording, stopRecording, toggleRecording, setRollingEnabled, saveLastSeconds, setSceneAuditProvider } from './perf-recorder';
import { setMatrixCensusProvider } from './matrix-census';
import { auditScene } from './scene-audit';
import { launchSpector } from './spector-launch';
import { initDrawReport, captureDrawReport, drawReportData } from './draw-report';
import { initGpuAttribution, runGpuAttribution, getLastAttributionReport, isAttributionRunning, onAttributionReport } from './gpu-attribution';
import { setLambertPreview, isLambertPreview } from './lambert-preview';
import { setProfilerToolbarVisible } from './profiler-toolbar';
import { createProfilerHud, setProfilerVisible, toggleProfiler } from './profiler-hud';
import type { DelveRenderer } from '../scene/create-renderer';
import type { LiveLevel } from '../level/builder';

// Profiling suite wiring — per-system CPU/GPU profiler HUD, session recorder,
// spector draw-call capture. A SAFE diagnostic (no gameplay effect), so it
// SHIPS in the production build behind the PROFILER TOOLS setting — the same
// "diagnostics are the exception" carve-out the perf meter uses. NOT
// import.meta.env.DEV gated: the whole point is to run it on the live build,
// on the phone, where the drops are. Zero footprint until enabled — the timing
// core + HUD are lazily created the first time the toggle (or a ?profiler /
// ?profile / ?record session flag) turns it on.
//
// Drive it from the on-screen toolbar (phone) or, on desktop, the hotkeys:
//   F2 HUD · F3 record · F4 DevTools marks · F6 draw report · F7 GPU probe ·
//   F9 detached stream. URL: ?profile/record/marks/stream=1.
//   Console: window.__profiler / __perfRec.{...} / __marks / __gpuAttr /
//   __draws / __perfStream / __spector (desktop).

export interface ProfilerWiringDeps {
  renderer: DelveRenderer;
  scene: THREE.Scene;
  /** The live render camera — the matrix census needs it, because a camera that
   *  moves dirties every drawn object's modelView at once and that has to be
   *  distinguishable from objects moving on their own. */
  camera: THREE.Camera;
  getLevel: () => LiveLevel | null;
}

let deps: ProfilerWiringDeps = null as unknown as ProfilerWiringDeps;

const profilerSessionFlag = ['profiler', 'profile', 'record', 'marks', 'stream']
  .some((k) => new URLSearchParams(window.location.search).get(k) === '1');
function profilingEnabled(): boolean {
  return getSettings().profilerTools || profilerSessionFlag;
}

let profilingInited = false;
function ensureProfilingInited(): void {
  if (profilingInited) return;
  profilingInited = true;
  initFrameTiming(deps.renderer);
  initDrawReport(deps.scene, deps.renderer, () => deps.getLevel());
  initGpuAttribution(deps.scene, deps.renderer);
  // A completed GPU-attribution sweep is forwarded to the detached cockpit (it
  // shows the ranking beside the timeline). broadcastAttr is a no-op unless the
  // stream is on, so this is free otherwise.
  onAttributionReport((d) => broadcastAttr(d));
  createProfilerHud();
}

/** Mount/unmount the on-screen toolbar (and tear the suite down) to match the
 *  PROFILER TOOLS setting. Called at boot and from onSettingsChanged. */
export function applyProfilerEnabled(): void {
  const on = profilingEnabled();
  if (on) {
    ensureProfilingInited();
    setSceneAuditProvider(() => auditScene(deps.scene));
    // Same shape, different question: the audit says WHAT is in the scene, the
    // matrix census says what MOVED (see debug/matrix-census.ts).
    setMatrixCensusProvider(() => ({ scene: deps.scene, camera: deps.camera }));
  }
  setRollingEnabled(on);          // dashcam ring fills only while enabled
  setProfilerToolbarVisible(on);
  if (!on) {
    setProfilerVisible(false);
    setMarks(false);
    setStreamEnabled(false);
  }
}

/** Wire the suite: settings-driven toolbar, session URL flags, hotkeys, and
 *  the window.__* console handles. Call once at boot. */
export function initProfilerWiring(d: ProfilerWiringDeps): void {
  deps = d;
  applyProfilerEnabled();
  // Honour the specific URL flags once the suite is active for this session.
  if (profilingEnabled()) {
    const q = new URLSearchParams(window.location.search);
    if (q.get('profile') === '1') setProfilerVisible(true);
    if (q.get('marks') === '1') setMarks(true);
    if (q.get('stream') === '1') setStreamEnabled(true);
    if (q.get('record') === '1') startRecording('auto');
  }
  window.addEventListener('keydown', (e) => {
    if (!profilingEnabled()) return;
    if (e.code === 'F2') { e.preventDefault(); toggleProfiler(); }
    else if (e.code === 'F3') { e.preventDefault(); toggleRecording(); }
    else if (e.code === 'F4') { e.preventDefault(); setMarks(!marksOn()); }
    else if (e.code === 'F6') { e.preventDefault(); void captureDrawReport(); }
    else if (e.code === 'F7') { e.preventDefault(); void runGpuAttribution(); }
    else if (e.code === 'F9') { e.preventDefault(); ensureProfilingInited(); setStreamEnabled(!streamEnabled()); }
  }, true);
  const profWin = window as unknown as {
    __profiler: () => void;
    __perfRec: { start: (l?: string) => void; stop: () => void; toggle: () => void; saveLast: (secs?: number) => void };
    __marks: () => void;
    __perfStream: () => void;
    __draws: () => void;
    __drawData: () => ReturnType<typeof drawReportData>;
    __gpuAttr: () => void;
    __gpuAttrReport: () => { running: boolean; report: string | null };
    __lambert: (on?: boolean) => boolean;
    __spector: () => void;
  };
  profWin.__profiler = () => { ensureProfilingInited(); toggleProfiler(); };
  profWin.__perfRec = {
    start: (l) => { ensureProfilingInited(); startRecording(l); },
    stop: stopRecording,
    toggle: () => { ensureProfilingInited(); toggleRecording(); },
    saveLast: (secs) => void saveLastSeconds(secs),
  };
  profWin.__marks = () => { ensureProfilingInited(); setMarks(!marksOn()); };
  profWin.__perfStream = () => { ensureProfilingInited(); setStreamEnabled(!streamEnabled()); };
  profWin.__draws = () => { ensureProfilingInited(); void captureDrawReport(); };
  profWin.__drawData = () => { ensureProfilingInited(); return drawReportData(); };
  profWin.__gpuAttr = () => { ensureProfilingInited(); void runGpuAttribution(); };
  profWin.__gpuAttrReport = () => ({ running: isAttributionRunning(), report: getLastAttributionReport() });
  // Lambert-class shading preview — A/B the PBR tax visually. __lambert() toggles,
  // __lambert(true/false) sets. Profiler-suite tool, not a player setting.
  profWin.__lambert = (on?: boolean) => { setLambertPreview(deps.scene, on ?? !isLambertPreview()); return isLambertPreview(); };
  profWin.__spector = () => void launchSpector();   // desktop only — heavy UI
}
