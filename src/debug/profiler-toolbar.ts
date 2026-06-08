// On-screen profiler toolbar — the phone-usable face of the profiling suite.
// Desktop has F2/F3/F6, but a phone has no function keys, so these buttons are
// how you drive the tools on the actual device where the drops live.
//
// Mounted only while the PROFILER TOOLS setting is on (or a ?profiler/?record
// session flag), so there's zero footprint for normal players. Buttons:
//   HUD   — toggle the live per-system CPU/GPU profiler overlay
//   ● REC — start/stop a session recording (becomes ■ STOP while recording)
//   SPCT  — capture the next frame's draw calls with spector.js
//
// Not DEV-gated — ships behind the setting, like the rest of the suite.

import { toggleProfiler, isProfilerVisible } from './profiler-hud';
import { toggleRecording, isRecording, onRecordingState, saveLastSeconds } from './perf-recorder';
import { setGpuProbe, gpuProbeOn } from './frame-timing';
import { captureDrawReport } from './draw-report';
import { launchSpector } from './spector-launch';

let root: HTMLDivElement | null = null;
let hudBtn: HTMLButtonElement | null = null;
let recBtn: HTMLButtonElement | null = null;
let gpuBtn: HTMLButtonElement | null = null;

function makeBtn(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    padding: '7px 11px',
    minHeight: '32px',
    background: 'rgba(14, 18, 28, 0.82)',
    border: '1px solid rgba(150, 180, 255, 0.4)',
    borderRadius: '6px',
    color: 'rgba(200, 225, 255, 0.92)',
    font: '600 11px ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  return b;
}

function mount(): void {
  if (root) { root.style.display = 'flex'; return; }
  root = document.createElement('div');
  root.id = 'profiler-toolbar';
  Object.assign(root.style, {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top, 0px))',
    left: 'calc(12px + env(safe-area-inset-left, 0px))',
    display: 'flex',
    gap: '6px',
    zIndex: '8100',           // above the HUD card (which it sits over)
  } as Partial<CSSStyleDeclaration>);

  hudBtn = makeBtn('HUD');
  hudBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleProfiler(); paintHud(); });

  recBtn = makeBtn('● REC');
  recBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleRecording(); });

  // Dashcam: snapshot the last 15s from the always-on ring. Called straight
  // from the tap so the share-sheet gesture stays valid on the phone.
  const saveBtn = makeBtn('SAVE 15s');
  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); void saveLastSeconds(15); });

  // GPU probe — real GPU ms via gl.finish() on devices without the timer-query
  // extension. Stalls the pipeline on sampled frames (fps dips while on), so
  // it's a deliberate measurement toggle.
  gpuBtn = makeBtn('GPU');
  gpuBtn.addEventListener('click', (e) => { e.stopPropagation(); setGpuProbe(!gpuProbeOn()); paintGpu(); });

  // DRAWS — analyze the scene's draw calls + instancing wins, share as text.
  // The quick, shareable summary.
  const drawBtn = makeBtn('DRAWS');
  drawBtn.addEventListener('click', (e) => { e.stopPropagation(); void captureDrawReport(); });

  // SPCT — spector.js full GL-command capture. Heavy, but its result view has
  // an export so the capture can be saved + sent on.
  const spcBtn = makeBtn('SPCT');
  spcBtn.addEventListener('click', (e) => { e.stopPropagation(); void launchSpector(); });

  root.append(hudBtn, recBtn, saveBtn, gpuBtn, drawBtn, spcBtn);
  document.body.appendChild(root);

  onRecordingState(paintRec);
  paintRec(isRecording());
  paintHud();
  paintGpu();
}

function paintGpu(): void {
  if (!gpuBtn) return;
  const on = gpuProbeOn();
  gpuBtn.style.opacity = on ? '1' : '0.55';
  gpuBtn.style.borderColor = on ? 'rgba(255, 130, 220, 0.7)' : 'rgba(150, 180, 255, 0.4)';
  gpuBtn.style.color = on ? 'rgba(255, 180, 235, 0.95)' : 'rgba(200, 225, 255, 0.92)';
}

function paintRec(rec: boolean): void {
  if (!recBtn) return;
  recBtn.textContent = rec ? '■ STOP' : '● REC';
  recBtn.style.background = rec ? 'rgba(60, 12, 12, 0.9)' : 'rgba(14, 18, 28, 0.82)';
  recBtn.style.borderColor = rec ? 'rgba(255, 90, 90, 0.7)' : 'rgba(150, 180, 255, 0.4)';
  recBtn.style.color = rec ? 'rgba(255, 180, 180, 0.95)' : 'rgba(200, 225, 255, 0.92)';
}

function paintHud(): void {
  if (hudBtn) hudBtn.style.opacity = isProfilerVisible() ? '1' : '0.55';
}

export function setProfilerToolbarVisible(visible: boolean): void {
  if (visible) mount();
  else if (root) root.style.display = 'none';
}
