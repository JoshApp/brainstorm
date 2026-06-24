// Frame pacing for the FRAME RATE cap.
//
// VSYNC-COUNT PACING. When capping below the panel's native refresh, we draw on
// every Nth rAF callback, where N = round(nativeHz / cap). Because rAF callbacks
// ARE the vsync grid, counting them gives genuinely even spacing — drawn frames
// land exactly N refreshes apart regardless of how much individual callbacks
// jitter in wall-clock time.
//
// This replaces an earlier wall-clock TIME-BUDGET accumulator. The accumulator
// was drift-free for the AVERAGE rate, but it paced by a time budget that, at a
// clean ratio (e.g. 60 cap on a 120Hz phone), sat right at the 2-vsync
// threshold — so natural rAF jitter tipped it between drawing on the 2nd vsync
// (16.7ms) and the 3rd (25ms) every few frames, FOREVER, even standing still.
// That metastable beat was visible micro-stutter on high-refresh phones. A
// vsync COUNT can't be tipped by timing jitter, so the beat is gone.
//
// The only thing a count can't survive is a wobbling refresh ESTIMATE flipping
// N (the failure mode that originally pushed the code to the accumulator). We
// fix that directly with HYSTERESIS: a new N must hold for STEP_STABLE
// consecutive callbacks before it's adopted, so a 119↔121Hz estimate flicker
// can't flip the divisor.
//
// Properties that fall out:
//   - Even, jitter-immune spacing: every Nth vsync, full stop.
//   - Never above the cap: a non-integer ratio rounds to the nearest whole N, so
//     "60 on 244Hz" becomes a steady every-4th-vsync (61fps) instead of a 4/5
//     beat. (pacerEffectiveFps reports the true drawn rate.)
//   - At/above native: the display IS the limiter, so draw every callback.
//   - Graceful under load: if the device can't even hit the cap, nativeHz drops
//     to ≈ the real callback rate, cap ≥ nativeHz-1 trips, and we draw every
//     callback instead of throttling an already-struggling rate.
//
// Escape hatch: ?legacypacer=1 restores the old wall-clock accumulator so the
// two can be A/B'd live on the phone.

let lastNow = 0;

// ── Native-refresh estimate (drives the divisor + the readout) ──────────────
// Median raw callback interval ≈ the vsync period when we're keeping up.
const intervals: number[] = [];
let nativeHz = 60;

// ── Vsync-count pacer state ─────────────────────────────────────────────────
let stepN = 1;            // active divisor: draw every stepN-th callback
let sinceDraw = 0;        // callbacks since the last drawn frame
let capActive = false;    // were we capping (below native) on the previous call?
// Hysteresis so a wobbling nativeHz estimate can't flip the divisor frame-to-frame.
let pendingStep = 0;
let pendingCount = 0;
const STEP_STABLE = 8;    // a new divisor must hold this many callbacks before adoption

// ── Legacy wall-clock accumulator (A/B via ?legacypacer=1) ──────────────────
const LEGACY = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('legacypacer') === '1';
let budget = 0;

/** Should THIS rAF callback draw, for the given cap (fps)? cap<=0 = uncapped.
 *  Call once per rAF callback, before the draw/skip branch. */
export function pacerShouldDraw(cap: number, now: number): boolean {
  const dt = lastNow === 0 ? 0 : Math.min(now - lastNow, 100); // clamp tab-stall gaps
  lastNow = now;
  observeForReadout(dt);

  // Uncapped, or at/above the panel's native refresh: the display is the
  // limiter, so draw every callback. (A software cap can only ADD judder here.)
  if (cap <= 0 || cap >= nativeHz - 1) {
    capActive = false;
    sinceDraw = 0;
    return true;
  }

  if (LEGACY) return legacyAccumulator(cap, dt);

  // Capping below native: draw every stepN-th callback (vsync-count pacing).
  const desired = Math.max(1, Math.round(nativeHz / cap));
  if (!capActive) {
    // Just engaged the cap — snap to the divisor immediately (no warm-up beat).
    capActive = true;
    stepN = desired;
    pendingStep = 0;
    pendingCount = 0;
    sinceDraw = 0;
    return true;
  }
  // Hysteresis: only adopt a new divisor once it has held for a while.
  if (desired === stepN) {
    pendingStep = 0;
    pendingCount = 0;
  } else if (desired === pendingStep) {
    if (++pendingCount >= STEP_STABLE) { stepN = desired; pendingStep = 0; pendingCount = 0; }
  } else {
    pendingStep = desired;
    pendingCount = 1;
  }

  if (++sinceDraw >= stepN) { sinceDraw = 0; return true; }
  return false;
}

/** The old wall-clock time-budget limiter — kept behind ?legacypacer=1 so the
 *  two pacers can be compared live. Drift-free for the average rate, but
 *  metastable at clean ratios (see header). */
function legacyAccumulator(cap: number, dt: number): boolean {
  const interval = 1000 / cap;
  budget += dt;
  if (budget >= interval) {
    budget -= interval;
    if (budget > interval) budget = interval; // cap the backlog — no catch-up bursts
    return true;
  }
  return false;
}

function observeForReadout(dt: number): void {
  if (dt > 2 && dt < 100) {
    intervals.push(dt);
    if (intervals.length > 180) intervals.shift();
  }
  if (intervals.length >= 30) {
    const s = intervals.slice().sort((a, b) => a - b);
    nativeHz = Math.round(1000 / s[s.length >> 1]); // median interval → Hz
  }
}

/** The detected native refresh (Hz) — for display. 60 until samples land. */
export function getNativeHz(): number { return nativeHz; }

/** The fps a cap resolves to on this panel. Uncapped / at-native → native.
 *  Below native → the QUANTIZED rate (nativeHz / divisor), which is what the
 *  vsync-count pacer actually draws (e.g. 60-on-244 → 61). */
export function pacerEffectiveFps(cap: number): number {
  if (cap <= 0 || cap >= nativeHz - 1) return nativeHz;
  if (LEGACY) return Math.min(cap, nativeHz);
  return Math.round(nativeHz / Math.max(1, Math.round(nativeHz / cap)));
}
