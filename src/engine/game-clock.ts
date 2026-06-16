// Deterministic game clock — the seam that makes time-based gameplay state
// reproducible. Skill windows (just-dodge, i-frames, charge-perfect) and the
// time-scale durations (hit-pause, bullet-time, slow-mo) currently read
// performance.now() (wall-clock), so the same (seed, inputs) does NOT replay
// identically — and in fixed-step replay the wall-clock freeze/slow durations
// change how many frozen/slowed steps run, desyncing the tape.
//
// Those timers read gameNow() instead. Two modes:
//   - DEFAULT (variable-dt play): gameNow() === performance.now(). The live
//     game is byte-for-byte unchanged — zero feel risk.
//   - DETERMINISTIC (fixed-step / recording): gameNow() returns an accumulated
//     clock advanced by the sim's real-time dt each step (FIXED_DT quanta), so
//     it's reproducible. Enabled at boot when ?fixedstep=1.
//
// The clock advances on REAL time (unscaled) — a dodge window is real-time even
// while bullet-time slows the world — and it advances DURING hit-pause (so the
// freeze ends) but freezes during a menu (so a pause doesn't burn the window
// and doesn't inject wall-clock nondeterminism).

let gameMs = 0;
let deterministic = false;

/** Turn on the deterministic accumulated clock (fixed-step / recording).
 *  Resets to 0. When off, gameNow() passes through to performance.now(). */
export function setDeterministicClock(on: boolean): void {
  if (on === deterministic) return; // idempotent — don't reset an already-on clock
  deterministic = on;
  gameMs = 0;
}

export function isDeterministicClock(): boolean {
  return deterministic;
}

/** The game time in ms. Wall-clock in default play; the accumulated sim clock
 *  in deterministic mode. Gameplay timers read THIS, never performance.now(). */
export function gameNow(): number {
  return deterministic ? gameMs : performance.now();
}

/** Advance the accumulated clock by `dtSeconds` of real time. No-op unless in
 *  deterministic mode. Called once per sim step (skip while a menu pauses). */
export function advanceGameClock(dtSeconds: number): void {
  if (deterministic) gameMs += dtSeconds * 1000;
}

/** Reset the accumulated clock to 0 (call at run start). */
export function resetGameClock(): void {
  gameMs = 0;
}
