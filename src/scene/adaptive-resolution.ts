import { setPS1Scale, PS1_SCALE_DEFAULT } from '../style/render-frame';

// Adaptive resolution — the highest-leverage knob for covering the spread of
// phones. Watches real frame time and nudges the scene-render scale (the
// low-res PS1 target) down when a device sustains slow frames, back up when it
// recovers. Fill-rate is the #1 mobile cost, so dropping the scene to ~0.3
// (from 0.4) cuts fragment work ~44% — and a lower-res PS1 render just reads
// as MORE PS1, so it's on-aesthetic, not a compromise.
//
// Gated to real phones (main.ts passes enabled = setting && !isDesktopLike),
// so desktop debug + the headless snap workflow always render at the fixed
// default — snaps stay deterministic.
//
// Hysteresis keeps it from oscillating: a >=1.5s settle window, a >=1.5s
// cooldown between steps, and a dead zone (17–22ms ≈ 45–59fps) where it holds.
// Under vsync a comfortable 60fps reads as ~16.7ms, which trips the raise
// threshold; missed frames push the average past the drop threshold.

// The ceiling adaptive scales DOWN from = the player's RENDER SCALE setting
// (default PS1_SCALE_DEFAULT). setAdaptiveCeiling updates it live.
let maxScale = PS1_SCALE_DEFAULT;
const MIN_SCALE = 0.28;                // floor — chunky but still legibly PS1
const STEP = 0.04;
const WINDOW_MS = 1500;                // frame-time averaging window
const COOLDOWN_MS = 1500;              // min time between steps
const DROP_MS = 22;                    // avg frame ms above this → scale down (~<45fps)
const RAISE_MS = 17;                   // avg frame ms below this → scale up (~>59fps)
const MIN_SAMPLES = 24;                // don't act until the window has data

let enabled = false;
let scale = maxScale;
const frames: number[] = [];
let lastStep = 0;

/** Enable/disable. Disabling restores the ceiling (render-scale) resolution. */
export function setAdaptiveResolution(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  frames.length = 0;
  lastStep = 0;
  if (!on) {
    scale = maxScale;
    setPS1Scale(maxScale);
  }
}

/** Set the resolution ceiling (the RENDER SCALE setting). Clamps the current
 *  scale to it; applies immediately when adaptive is on (when off, the caller
 *  sets the fixed scale via setPS1Scale). */
export function setAdaptiveCeiling(v: number): void {
  maxScale = v;
  if (scale > maxScale) {
    scale = maxScale;
    if (enabled) setPS1Scale(scale);
  }
}

/** Shared drop/raise step from a "how slow is the frame" ms signal. */
function applyStep(avgMs: number, nowMs: number): void {
  if (nowMs - lastStep < COOLDOWN_MS) return;
  if (avgMs > DROP_MS && scale > MIN_SCALE) {
    scale = Math.round((scale - STEP) * 100) / 100;
    setPS1Scale(scale);
    lastStep = nowMs;
  } else if (avgMs < RAISE_MS && scale < maxScale) {
    scale = Math.min(maxScale, Math.round((scale + STEP) * 100) / 100);
    setPS1Scale(scale);
    lastStep = nowMs;
  }
}

// ── WALL-CLOCK FALLBACK (WebGL2-fallback backend only) ──────────────────────
// The primary signal is the native GPU timestamp (feedAdaptiveGpuMs). But the
// WebGL2 fallback backend needs EXT_disjoint_timer_query_webgl2 for timestamps,
// which most mobile GPUs/browsers don't expose — i.e. the weak devices that need
// adaptive res most would get NO signal at all. On that backend the render
// submit is synchronous, so a GPU-bound frame DOES stretch the drawn-frame
// interval (driver back-pressure) — wall-clock time between drawn frames is a
// valid load signal there. It is NOT valid on WebGPU (MAX_IN_FLIGHT=1
// skip-pacing pins the rAF interval to vsync), so main.ts only arms this when
// init resolves to the WebGL backend — and a real GPU timestamp, if one ever
// arrives, takes over permanently.
let wallFallback = false;
let gpuSignalSeen = false;
let lastTickMs = 0;
let winStartMs = 0;
/** Arm the wall-clock frame-time fallback (call with true only on the WebGL2
 *  fallback backend, where submits are sync and rAF intervals reflect GPU load). */
export function setAdaptiveWallClockFallback(on: boolean): void {
  wallFallback = on;
  frames.length = 0; lastTickMs = 0; winStartMs = 0;
}

/** Per-drawn-frame tick. expectedMs = the frame-cap's target interval on this
 *  panel (1000/effective fps) so a deliberate 30fps cap isn't misread as a
 *  struggling device. No-op unless the wall-clock fallback is armed and no GPU
 *  timestamp has ever resolved. */
export function tickAdaptiveResolution(nowMs: number, expectedMs = 1000 / 60): void {
  if (!enabled || !wallFallback || gpuSignalSeen) { lastTickMs = nowMs; return; }
  const dt = lastTickMs === 0 ? 0 : nowMs - lastTickMs;
  lastTickMs = nowMs;
  if (dt <= 0 || dt > 100) return;   // boot / tab-stall / pause gaps aren't render cost
  if (winStartMs === 0) winStartMs = nowMs;
  frames.push(dt);
  if (frames.length < MIN_SAMPLES || nowMs - winStartMs < WINDOW_MS) return;
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  frames.length = 0; winStartMs = 0;
  // Same thresholds as the absolute DROP/RAISE constants at a 60fps target
  // (16.7ms × 1.32 ≈ 22, × 1.02 ≈ 17), generalized to the capped rate.
  if (nowMs - lastStep < COOLDOWN_MS) return;
  if (avg > expectedMs * 1.32 && scale > MIN_SCALE) {
    scale = Math.round((scale - STEP) * 100) / 100;
    setPS1Scale(scale);
    lastStep = nowMs;
  } else if (avg < expectedMs * 1.02 && scale < maxScale) {
    scale = Math.min(maxScale, Math.round((scale + STEP) * 100) / 100);
    setPS1Scale(scale);
    lastStep = nowMs;
  }
}

// EMA of GPU frame ms (WebGPU only) — the bottleneck signal the rAF interval can't see.
let gpuEma = 0;
/** Feed the latest GPU frame ms (native timestamp) — WebGPU's adaptive signal.
 *  Drives the same drop/raise stepping as the WebGL frame-time path. */
export function feedAdaptiveGpuMs(ms: number): void {
  if (!(ms > 0)) return;
  gpuSignalSeen = true;   // a real timestamp exists — it owns the signal from here
  if (!enabled) return;
  gpuEma = gpuEma === 0 ? ms : gpuEma * 0.85 + ms * 0.15;
  applyStep(gpuEma, performance.now());
}

/** Current scene-render scale (for a perf readout). */
export function getAdaptiveScale(): number { return scale; }

/** Whether the scaler is currently enabled — so a measurement sweep can
 *  suspend it (it would fight a resolution probe) and restore exactly. */
export function isAdaptiveResolutionEnabled(): boolean { return enabled; }
