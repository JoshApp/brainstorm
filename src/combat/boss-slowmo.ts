// Brief slow-mo on a boss's death blow — "the moment" beat. Triggered from the
// boss cinematics on boss:defeated; folds into the global time scale alongside
// the player-death and just-dodge contributors (see main.ts scaledDt). Mirrors
// the just-dodge dip: snap into slow speed, ease back to full over the window.

const DURATION_S = 0.45;   // total real-time the dip lasts
const SCALE = 0.3;         // slowest point (30% speed) at the instant of the kill

let elapsed = Infinity;    // real-seconds since the dip began (Infinity = inactive)

/** Kick the boss-death slow-mo. */
export function triggerBossSlowmo(): void {
  elapsed = 0;
}

/** Advance the dip in REAL time (so the slow-mo isn't slowed by itself). */
export function tickBossSlowmo(realDt: number): void {
  if (elapsed < DURATION_S) elapsed += realDt;
}

/** Current time-scale contribution (1 = no effect). */
export function getBossSlowmoTimeScale(): number {
  if (elapsed >= DURATION_S) return 1;
  const t = elapsed / DURATION_S;       // 0 → 1 across the dip
  return SCALE + (1 - SCALE) * t;       // 0.3 at the kill, eased back to 1
}

export function resetBossSlowmo(): void {
  elapsed = Infinity;
}
