// Frame pacing for the FRAME RATE cap.
//
// The old cap gated draws on a wall-clock timer:
//     if (now - lastDraw < 1000/cap - 4) skip;
// Two problems with that:
//   1. It can't honour 60 on a 90Hz panel. vsync is 11.1ms; after a draw the
//      next vsync (+11.1ms) is under the 12.67ms threshold so it's skipped, and
//      it draws every SECOND vsync = 45fps. A "60" cap silently became 45.
//   2. The threshold floats against performance.now() deltas that aren't vsync-
//      aligned, so the draw cadence can wobble (16.7ms then 25ms) — micro-jitter
//      even when the average fps is right.
//
// This paces by VSYNC DIVISION instead. We measure the panel's native refresh
// from the RAW rAF cadence (every callback, including skipped ones), then draw
// every Nth callback where N = round(native / cap). Pacing is then even BY
// CONSTRUCTION — locked to vsync, no timer drift — and the cap is honest: on a
// 90Hz panel a 60 request resolves to the nearest achievable rate, it doesn't
// pretend to be 60. Uncapped (cap<=0) always draws → native refresh.

let lastRawMs = 0;
const intervals: number[] = [];   // recent raw rAF deltas (ms)
let nativeHz = 60;                 // estimate, refined as samples arrive
let frameCounter = 0;

// Common panel rates we snap the noisy estimate to, so the divisor doesn't
// wobble frame-to-frame on a slightly-jittery measurement.
const COMMON_HZ = [60, 75, 90, 120, 144, 165, 240];
const SNAP_TOLERANCE = 6;         // Hz: within this of a common rate → snap to it

/** Call at the TOP of every rAF tick — BEFORE the draw/skip decision — with
 *  performance.now(). Must run on skipped frames too, or the counter + refresh
 *  estimate go wrong. */
export function pacerObserve(nowMs: number): void {
  if (lastRawMs > 0) {
    const d = nowMs - lastRawMs;
    // Ignore absurd gaps (tab backgrounded, GC hitch) so they don't poison the
    // median. 2ms floor guards against duplicate-timestamp callbacks.
    if (d > 2 && d < 100) {
      intervals.push(d);
      if (intervals.length > 90) intervals.shift();
    }
  }
  lastRawMs = nowMs;
  frameCounter++;
  if (intervals.length >= 20) estimateNativeHz();
}

function estimateNativeHz(): void {
  // Median raw interval → native Hz. Median (not mean) shrugs off the occasional
  // long frame; the raw cadence is the unthrottled vsync interval, so this reads
  // the true panel rate regardless of what cap we're currently applying.
  const sorted = intervals.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const hz = 1000 / median;
  let best = Math.round(hz);
  let bestErr = SNAP_TOLERANCE + 1;
  for (const c of COMMON_HZ) {
    const e = Math.abs(c - hz);
    if (e < bestErr) { bestErr = e; best = c; }
  }
  nativeHz = best;
}

/** The detected native refresh (Hz). 60 until enough samples land. */
export function getNativeHz(): number { return nativeHz; }

/** Should THIS rAF callback draw, for the given cap (fps)? cap<=0 = uncapped
 *  (always). Otherwise draw every round(native/cap)-th frame, divisor ≥ 1. */
export function pacerShouldDraw(cap: number): boolean {
  if (cap <= 0) return true;
  const div = Math.max(1, Math.round(nativeHz / cap));
  return frameCounter % div === 0;
}

/** The fps a cap actually resolves to on this panel (for a readout / honesty).
 *  e.g. cap 60 on a 90Hz panel → 45; on 120Hz → 60; uncapped → native. */
export function pacerEffectiveFps(cap: number): number {
  if (cap <= 0) return nativeHz;
  return Math.round(nativeHz / Math.max(1, Math.round(nativeHz / cap)));
}
