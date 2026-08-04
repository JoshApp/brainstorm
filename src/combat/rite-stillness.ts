import { playSlowmoEnter } from '../audio/sfx';
import { registerSimReset } from '../engine/sim-state';

// STILLNESS — the world stops and you do not.
//
// The rite-driven cousin of the reactive-defense bullet-time, and deliberately
// built on the same asymmetry rather than beside it: this scales the WORLD clock
// (enemies, projectiles, ambient FX) and never touches the player clock, so
// during a Stillness you move, swing and dodge at full speed through a room that
// has forgotten how. That asymmetry already exists and is already tuned
// (combat/reactive-defense.ts) — this is a longer, deeper, DELIBERATE version of
// it, paid for with Hunger instead of earned with a perfect dodge.
//
// Kept as its own module rather than folded into reactive-defense because the
// two must be able to overlap: a just-dodge landed inside a Stillness should
// deepen it, not restart somebody else's timer. They multiply in the frame loop.
//
// Ticked in REAL time — a slow-mo that slowed its own countdown would never end.

/** How deep the world's clock goes at the floor. 0.12 = the world at 12% speed. */
const DEFAULT_SCALE = 0.12;
/** Fraction of the window spent HELD at the floor before the release begins.
 *  Without a hold the deep part passes in a frame and the player never sees it —
 *  the same lesson bullet-time learned. */
const HOLD_FRAC = 0.7;

let remaining = 0;      // real-seconds left in the window
let duration = 0;       // the window's full length
let scale = DEFAULT_SCALE;

/** Stop the world. `seconds` is REAL time; `deep` is the floor (0..1). */
export function enterStillness(seconds: number, deep = DEFAULT_SCALE): void {
  // A second casting during a Stillness EXTENDS rather than restarts, and takes
  // the deeper of the two floors — so stacking never shortens what you had.
  duration = Math.max(seconds, remaining);
  remaining = duration;
  scale = Math.min(scale, deep);
  playSlowmoEnter();
}

/** Advance in REAL time. */
export function tickStillness(realDt: number): void {
  if (remaining <= 0) return;
  remaining = Math.max(0, remaining - realDt);
  if (remaining === 0) scale = DEFAULT_SCALE;
}

/** The world-clock contribution (1 = no effect). Multiplied into scaledDt/fxDt
 *  alongside the bullet-time scale — never into playerDt. */
export function getStillnessTimeScale(): number {
  if (remaining <= 0 || duration <= 0) return 1;
  const t = 1 - remaining / duration;          // 0 → 1 across the window
  if (t <= HOLD_FRAC) return scale;
  const r = (t - HOLD_FRAC) / (1 - HOLD_FRAC); // 0 → 1 across the release
  return scale + (1 - scale) * (r * r);        // quadratic snap-back
}

/** True while the world is held. Presentation hooks (vignette, audio) read it. */
export function isStillnessActive(): boolean {
  return remaining > 0;
}

/** Drop it (death, floor load, a fresh run). */
export function resetStillness(): void {
  remaining = 0;
  duration = 0;
  scale = DEFAULT_SCALE;
}
// sim-state: a held world must never survive a floor load — you would arrive on
// the next floor with everything crawling and no idea why.
registerSimReset(resetStillness);
