// Composite "is the world paused?" predicate.
//
// Four independent pause sources exist by design — each owns its own state:
//
//   - hit-pause      → combat feel (80ms freeze after a hit lands)
//   - debug freeze   → scenarios / snap CLI deterministic frames
//   - screen pause   → any open screen whose policy.pausesWorld is true
//   - harness        → turn-based AI-playable mode (?harness=1). World stays
//                      paused between actions; each action requests a brief
//                      tick budget that unpauses then re-pauses.
//
// The main tick loop wants "any of these → skip world updates", and so does
// any future system that needs to know. Centralizing the OR here means a new
// pause source (cutscene, loading veil, etc.) plugs in once instead of in
// every call site.

import { isFrozen } from './combat/hit-pause';
import { isWorldFrozen } from './debug/freeze';
import { isWorldPausedByScreen } from './ui/screen-manager';
import { isHarnessPaused } from './harness/pause';

export function isWorldPaused(): boolean {
  return isFrozen() || isWorldFrozen() || isWorldPausedByScreen() || isHarnessPaused();
}

/** True when the world is paused for a reason that must FREEZE the deterministic
 *  game clock — a menu, the harness, or a debug freeze. Deliberately EXCLUDES
 *  hit-pause: hit-pause reads gameNow() to know when to release, so its clock
 *  must keep advancing or the freeze would never end. Used by the fixed-step
 *  loop so a paused stretch neither burns in-flight skill windows nor leaks
 *  wall-clock time into a recorded run's tape (see game-clock.ts's contract). */
export function shouldFreezeGameClock(): boolean {
  return isWorldFrozen() || isWorldPausedByScreen() || isHarnessPaused();
}

/** Which source is currently pausing the world? Used by the harness to
 *  report `pausedReason` in observations. Returns null when running. */
export function pausedReason(): 'hit' | 'debug' | 'screen' | 'harness' | null {
  if (isFrozen()) return 'hit';
  if (isWorldFrozen()) return 'debug';
  if (isWorldPausedByScreen()) return 'screen';
  if (isHarnessPaused()) return 'harness';
  return null;
}
