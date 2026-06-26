// Frame pacing for the FRAME RATE cap.
//
// HYBRID PACING — two limiters, picked by what the panel is actually doing,
// because no single scheme survives every display:
//
//   • VSYNC-COUNT (draw every Nth rAF callback, N = round(nativeHz/cap)) is
//     buttery-even on a STABLE panel whose refresh is a CLEAN multiple of the
//     cap (60 on 120Hz, 60 on 244Hz). rAF callbacks ARE the vsync grid, so a
//     count can't be tipped by timing jitter. BUT it falls apart elsewhere:
//     when nativeHz isn't a clean multiple, round() either overshoots (N rounds
//     to 1 on an ~80Hz panel → no cap at all → 80fps when you asked for 60) or
//     can't hit the target; and on an ADAPTIVE-REFRESH (LTPO) phone the median
//     "nativeHz" is a meaningless blend of two rates, so N is garbage.
//
//   • A drift-free TIME ACCUMULATOR with a half-vsync GRACE handles all of that
//     — it paces by real wall-clock time, so it never overshoots the cap and
//     doesn't care what the refresh is doing. The grace (drawing up to half a
//     vsync early) keeps its decision boundary BETWEEN vsyncs instead of on one,
//     which is what the old plain accumulator got wrong: at a clean 2:1 ratio
//     its threshold sat right on the 2nd vsync, so jitter flipped it between the
//     2nd (16.7ms) and 3rd (25ms) every few frames — the standing-still
//     micro-stutter. The accumulator's price is that on a non-divisor / variable
//     panel individual gaps must vary to hold the average (mild, unavoidable
//     judder — you simply cannot evenly draw 60 on an 80Hz panel).
//
// So: use vsync-count when the refresh is STABLE and a CLEAN divisor; otherwise
// fall back to the grace-accumulator. The mode and the divisor N are each
// hysteresis-gated so a wobbling estimate can't flip them frame-to-frame.
//
// At/above native refresh the display IS the limiter — draw every callback.
// Uncapped — draw every callback. Escape hatch: ?legacypacer=1 forces the old
// plain accumulator (no grace, no count) so its metastable beat can be A/B'd.

let lastNow = 0;

// ── Refresh estimate + stability (drive the mode, the divisor, the readout) ──
const intervals: number[] = [];
let nativeHz = 60;
let spread = 1;            // (p85−p15)/median of recent intervals; small = single stable rate

// ── Pacer state ──────────────────────────────────────────────────────────
let budget = 0;            // grace-accumulator time budget (ms)
let stepN = 1;             // vsync-count divisor
let sinceDraw = 0;         // callbacks since last draw (count mode)
let mode = 0;              // 0 = grace-accumulator, 1 = vsync-count
let modePend = 0;
let modeHold = 0;
let stepPend = 0;
let stepHold = 0;
let effFps = 60;           // last resolved drawn rate, for the readout

const CLEAN_TOL = 0.12;    // |nativeHz/cap − round| within this = a clean divisor
const STABLE_TOL = 0.35;   // interval spread under this × median = a stable single refresh
const MODE_HOLD = 40;      // callbacks a new mode must hold before switching
const STEP_STABLE = 8;     // callbacks a new divisor must hold before adoption

const LEGACY = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('legacypacer') === '1';

/** Should THIS rAF callback draw, for the given cap (fps)? cap<=0 = uncapped.
 *  Call once per rAF callback, before the draw/skip branch. */
export function pacerShouldDraw(cap: number, now: number): boolean {
  const dt = lastNow === 0 ? 0 : Math.min(now - lastNow, 100); // clamp tab-stall gaps
  lastNow = now;
  observeForReadout(dt);

  // Uncapped, or at/above native: the display is the limiter — draw every frame.
  if (cap <= 0 || cap >= nativeHz - 1) {
    mode = 0; sinceDraw = 0; budget = 0; effFps = nativeHz;
    return true;
  }

  if (LEGACY) {
    effFps = Math.min(cap, nativeHz);
    return legacyAccumulator(cap, dt);
  }

  // Choose the limiter for the current panel (hysteresis-gated).
  const ratio = nativeHz / cap;
  const n = Math.max(1, Math.round(ratio));
  const wantCount = n >= 2 && Math.abs(ratio - n) <= CLEAN_TOL && spread <= STABLE_TOL ? 1 : 0;
  if (wantCount === mode) { modePend = mode; modeHold = 0; }
  else if (wantCount === modePend) { if (++modeHold >= MODE_HOLD) { mode = wantCount; modeHold = 0; budget = 0; sinceDraw = 0; } }
  else { modePend = wantCount; modeHold = 1; }

  if (mode === 1) {
    // VSYNC-COUNT: draw every stepN-th callback (stepN hysteresis-gated).
    if (n === stepN) { stepPend = 0; stepHold = 0; }
    else if (n === stepPend) { if (++stepHold >= STEP_STABLE) { stepN = n; stepPend = 0; stepHold = 0; } }
    else { stepPend = n; stepHold = 1; }
    effFps = Math.round(nativeHz / stepN);
    if (++sinceDraw >= stepN) { sinceDraw = 0; return true; }
    return false;
  }

  // GRACE-ACCUMULATOR: time-based, never overshoots; grace sits the threshold
  // between vsyncs so jitter can't make it metastable.
  effFps = Math.min(cap, nativeHz);
  const interval = 1000 / cap;
  const grace = Math.min((1000 / nativeHz) * 0.5, interval * 0.5);
  budget += dt;
  if (budget >= interval - grace) {
    budget -= interval;
    if (budget > interval) budget = interval;   // cap the backlog — no catch-up burst after a stall
    if (budget < -grace) budget = -grace;        // and no runaway negative drift
    return true;
  }
  return false;
}

/** The old plain wall-clock accumulator — kept behind ?legacypacer=1 so its
 *  metastable beat can be compared against the hybrid live. */
function legacyAccumulator(cap: number, dt: number): boolean {
  const interval = 1000 / cap;
  budget += dt;
  if (budget >= interval) {
    budget -= interval;
    if (budget > interval) budget = interval;
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
    const med = s[s.length >> 1];
    // NATIVE REFRESH = the FLOOR of frame intervals, not the median. The fastest
    // frames land on a clean vsync (= the panel period); slower ones are
    // missed-vsync multiples. The median tracks the ACHIEVED rate — so a capped or
    // GPU-bound game (very common under the async WebGPU path) read its panel as
    // far slower than it is (a 244Hz monitor showing 20-60). A low percentile (the
    // >2ms guard already drops coalesced sub-frame ticks) recovers the true panel.
    const floorMs = s[Math.floor(s.length * 0.10)];
    nativeHz = Math.round(1000 / floorMs);
    spread = (s[Math.floor(s.length * 0.85)] - s[Math.floor(s.length * 0.15)]) / med; // stability
  }
}

/** The detected native refresh (Hz) — for display. 60 until samples land. */
export function getNativeHz(): number { return nativeHz; }

/** The fps a cap actually resolves to on this panel — the rate the pacer is
 *  currently drawing (quantized in count mode, ≈cap in accumulator mode).
 *  Uncapped / at-native → native. */
export function pacerEffectiveFps(cap: number): number {
  if (cap <= 0 || cap >= nativeHz - 1) return nativeHz;
  return effFps;
}
