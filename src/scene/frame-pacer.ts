// Frame pacing for the FRAME RATE cap.
//
// The original cap gated draws on a timer with a FIXED 4ms slack
// (now - lastDraw < 1000/cap - 4). On a 90Hz panel that lands a "60" cap on
// 45fps, and the fixed slack isn't right across refresh rates. This replaces it
// with a refresh-aware pacer.
//
// NATIVE REFRESH ESTIMATE. We watch the raw rAF cadence (every callback) and
// take a LOW PERCENTILE of recent intervals — the fastest cadence the panel
// delivers, which IS the true vsync period. The median would be dragged upward
// by every dropped frame, so it reads low and wobbles whenever the scene gets
// heavy; the floor is stable under load. Snapped to a common panel rate and made
// sticky so the readout doesn't flicker ±1Hz at a boundary (or on a variable-
// refresh panel breathing around a rate).
//
// CAP DECISION. PRIMARY is a deterministic vsync DIVISION: draw every
// round(native/cap)-th raw callback. Counting callbacks is immune to timestamp
// jitter, so a capped rate with headroom holds EXACTLY (a 60 cap on a 120Hz
// panel draws every 2nd vsync = a clean 60, never a jittered 55). A pure timer
// here drifts: storing the noisy measured draw time re-seeds the schedule with
// error, and a frame whose timestamp lands a few ms late tips the next "draw"
// vsync just under threshold — it skips, opening a 3-vsync gap that reads as a
// momentary 40fps and drags the average below the cap.
// FALLBACK is a timer: if a full cap-interval has elapsed we're load-bound (raw
// callbacks already slower than the cap), so draw immediately — capping must
// never HALVE a framerate that's already below the cap, which a bare divisor
// would. Uncapped (cap<=0) always draws.

let lastRawMs = 0;        // previous rAF callback time (for interval sampling)
let lastDrawMs = 0;       // previous DRAWN frame time (for the load fallback)
let framesSinceDraw = 0;  // raw vsync callbacks since the last draw
const intervals: number[] = [];
const WINDOW = 240;       // ~2–4s of samples — long enough to be stable
let nativeHz = 60;        // estimate; refined as samples arrive

// Common panel rates we snap a noisy estimate to.
const COMMON_HZ = [60, 75, 90, 100, 120, 144, 165, 240];
const SNAP_TOL = 6;       // Hz: within this of a common rate → snap to it
const STICK_TOL = 5;      // Hz: don't republish nativeHz unless it moves > this

/** Call at the TOP of every rAF tick — BEFORE the draw/skip decision, on
 *  skipped frames too — with performance.now(). Samples the raw cadence. */
export function pacerObserve(nowMs: number): void {
  if (lastRawMs > 0) {
    const d = nowMs - lastRawMs;
    // Drop absurd gaps (tab backgrounded, GC hitch) so they don't skew the
    // window; 2ms floor guards duplicate-timestamp callbacks.
    if (d > 2 && d < 100) {
      intervals.push(d);
      if (intervals.length > WINDOW) intervals.shift();
    }
  }
  lastRawMs = nowMs;
  if (intervals.length >= 20) estimateNativeHz();
}

function estimateNativeHz(): void {
  const sorted = intervals.slice().sort((a, b) => a - b);
  // 10th-percentile interval ≈ the true vsync period (the fastest cadence the
  // panel delivers), immune to dropped frames inflating it.
  const lo = sorted[Math.floor(sorted.length * 0.10)];
  const hz = 1000 / lo;
  let snapped = Math.round(hz);
  let bestErr = SNAP_TOL + 1;
  for (const c of COMMON_HZ) {
    const e = Math.abs(c - hz);
    if (e < bestErr) { bestErr = e; snapped = c; }
  }
  // Sticky: only republish on a meaningful move, so the readout (and the cap
  // divisor derived from it) stays pinned instead of jittering each second.
  if (Math.abs(snapped - nativeHz) > STICK_TOL) nativeHz = snapped;
}

/** The detected native refresh (Hz). 60 until enough samples land. */
export function getNativeHz(): number { return nativeHz; }

/** Should THIS rAF callback draw, for the given cap (fps)? cap<=0 = uncapped.
 *  Must be called once per rAF callback (it counts vsyncs). */
export function pacerShouldDraw(cap: number, nowMs: number): boolean {
  framesSinceDraw++;
  if (cap <= 0) { framesSinceDraw = 0; lastDrawMs = nowMs; return true; }
  const div = Math.max(1, Math.round(nativeHz / cap));
  const targetInterval = 1000 / cap;
  const vsync = 1000 / nativeHz;
  // Primary: every div-th callback (jitter-immune even pacing). Fallback: a full
  // cap-interval elapsed → we're load-bound, draw now (graceful, never halves a
  // already-slow rate). The half-vsync slack rounds the fallback to the nearest
  // vsync so it can't fire a hair early with headroom.
  if (framesSinceDraw >= div || nowMs - lastDrawMs >= targetInterval - vsync * 0.5) {
    framesSinceDraw = 0;
    lastDrawMs = nowMs;
    return true;
  }
  return false;
}

/** The fps a cap actually resolves to on this panel — the cap rounded to the
 *  nearest achievable vsync multiple. e.g. 60 on 90Hz → 45, on 120Hz → 60,
 *  on 144Hz → 72; uncapped → native. */
export function pacerEffectiveFps(cap: number): number {
  if (cap <= 0) return nativeHz;
  const div = Math.max(1, Math.round(nativeHz / cap));
  return Math.round(nativeHz / div);
}
