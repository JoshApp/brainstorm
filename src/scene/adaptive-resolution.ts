import { setPS1Scale, PS1_SCALE_DEFAULT } from '../style/render-target';

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

/** Call once per frame with performance.now(). Cheap: a push, a trim, and an
 *  occasional average. No-op (one branch) when disabled. */
export function tickAdaptiveResolution(nowMs: number): void {
  if (!enabled) return;
  frames.push(nowMs);
  while (frames.length > 0 && nowMs - frames[0] > WINDOW_MS) frames.shift();

  if (nowMs - lastStep < COOLDOWN_MS) return;
  if (frames.length < MIN_SAMPLES) return;

  const avgMs = (frames[frames.length - 1] - frames[0]) / (frames.length - 1);
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

/** Current scene-render scale (for a perf readout). */
export function getAdaptiveScale(): number { return scale; }
