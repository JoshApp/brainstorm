// Authoritative player-lifecycle state machine.
//
// Before this existed, "is the player alive / in control" was answered by
// scattered module flags (death.ts `dying`, health.ts `dead`) that most
// systems didn't even consult — they relied on the death sequence's
// time-scale ramp to coast to a stop. That left realDt-driven systems
// (viewmodel bob, lamp sway) running full speed through the death collapse.
//
// This module is the single source of truth for the lifecycle phase. It is
// deliberately SEPARATE from `isWorldPaused()` in world-paused.ts: pausing
// is a transient overlay (hit-pause, an open menu, a debug freeze) layered
// ON TOP of whatever lifecycle phase we're in. A dead player with a menu
// open is both `dead` and world-paused. Keep the two axes distinct.
//
// Systems that must change behaviour with the lifecycle read getGameMode()
// / isPlaying() each frame, or subscribe via onGameModeChange() for one-shot
// transitions (e.g. zero the input vector the instant the player dies).

export type GameMode =
  | 'playing'   // normal control — input, combat, viewmodel bob all live
  | 'dying'     // death sequence running (camera collapse + slow-mo)
  | 'dead';     // sequence finished, end screen up, awaiting RISE AGAIN

let mode: GameMode = 'playing';

type Listener = (next: GameMode, prev: GameMode) => void;
const listeners = new Set<Listener>();

export function getGameMode(): GameMode {
  return mode;
}

/** Transition to a new mode. No-op if unchanged. Fires listeners with
 *  (next, prev) so one-shot transition logic can run exactly once. */
export function setGameMode(next: GameMode): void {
  if (next === mode) return;
  const prev = mode;
  mode = next;
  for (const fn of listeners) fn(next, prev);
}

/** Subscribe to mode transitions. Returns an unsubscribe closure. */
export function onGameModeChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True only during normal play — the player has control. The common gate
 *  for input, attacks, and viewmodel motion. */
export function isPlaying(): boolean {
  return mode === 'playing';
}

/** True once the death sequence has begun (dying OR dead). */
export function isDyingOrDead(): boolean {
  return mode === 'dying' || mode === 'dead';
}
