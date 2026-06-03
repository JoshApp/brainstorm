// Player movement-speed scale driven by enemy auras (e.g. the king
// slime's inside-the-body slow). An enemy whose aura currently
// envelops the player calls setPlayerInAura(slowFactor) every
// frame; the camera's move tick multiplies its move vector by
// getPlayerMoveScale().
//
// "Last refresh wins" rather than additive: if a player is inside
// two overlapping auras at once (rare; would only happen with two
// slime kings), the stronger of them wins because whichever
// updated LAST took precedence — that's fine for our scale.
//
// Time-based decay (not frame-counter) so it works whether the
// caller is in the world tick, a fixed tick, or paused-then-
// resumed. Threshold 100ms — well above 60fps frame time, well
// below the human-visible "stuck slow" feel.

let factor = 1.0;
let lastSetMs = 0;

const STALE_MS = 100;

export function setPlayerInAura(slowFactor: number): void {
  factor = slowFactor;
  lastSetMs = performance.now();
}

export function getPlayerMoveScale(): number {
  if (performance.now() - lastSetMs > STALE_MS) {
    factor = 1.0;
  }
  return factor;
}

export function resetPlayerAura(): void {
  factor = 1.0;
  lastSetMs = 0;
}
