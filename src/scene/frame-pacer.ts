// Frame pacing for the FRAME RATE cap.
//
// A DRIFT-FREE TIME ACCUMULATOR — the classic correct frame limiter, and
// deliberately simple. Each rAF callback we add the real elapsed time to a
// budget and draw one frame whenever a full cap-interval has banked, then
// SUBTRACT the interval (never reset to "now") so timing jitter can't
// accumulate. With NO refresh-rate estimation, every desirable property falls
// out on its own:
//   - Never above the cap: a draw needs a full 1000/cap ms of real time first.
//   - Jitter-immune (no dips): a late callback leaves a small carry that pulls
//     the next draw earlier, so the average rate holds exactly — it can't drift
//     down to 55 the way a re-seeding timer did.
//   - Even, vsync-quantised pacing on any panel: a 60 cap on a 120Hz screen
//     draws every 2nd vsync; on 240Hz every 4th; etc.
//   - Graceful under load: when callbacks are already slower than the cap the
//     budget refills every frame, so we draw every frame instead of halving an
//     already-struggling rate.
// Uncapped (cap<=0) draws every callback = native refresh.
//
// (An earlier version estimated native Hz, snapped it, and divided — when that
//  estimate wobbled the divisor flipped 1↔2 and the draw rate swung 120↔60.
//  The accumulator needs none of that.)

let lastNow = 0;
let budget = 0;

// Native-refresh estimate — for the perf READOUT only; it does not drive the
// cap. Median raw callback interval ≈ the vsync period when we're keeping up.
const intervals: number[] = [];
let nativeHz = 60;

/** Should THIS rAF callback draw, for the given cap (fps)? cap<=0 = uncapped.
 *  Call once per rAF callback, before the draw/skip branch. */
export function pacerShouldDraw(cap: number, now: number): boolean {
  const dt = lastNow === 0 ? 0 : Math.min(now - lastNow, 100); // clamp tab-stall gaps
  lastNow = now;
  observeForReadout(dt);

  if (cap <= 0) return true;
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

/** The fps a cap resolves to on this panel: the cap, clamped to native (the
 *  accumulator hits the target rate on average). Uncapped → native. */
export function pacerEffectiveFps(cap: number): number {
  return cap <= 0 ? nativeHz : Math.min(cap, nativeHz);
}
