// Hit-pause: the global freeze-frame the world enters for ~80ms when a hit
// connects. The single most important feel feature per CLAUDE.md.
//
// Architecture: a freeze deadline timestamp. While gameNow() is below
// it, the main tick skips all per-frame updates (camera, mob, sword, torch,
// combat). Render continues so the screen still updates (no black frame).
//
// Side effect: input.lookDx/lookDy must be drained by the caller during the
// freeze, or they'll accumulate and snap-rotate when the freeze ends.

import { gameNow } from '../engine/game-clock';

let frozenUntil = 0;

export function freezeFor(ms: number) {
  const target = gameNow() + ms;
  // Don't shorten an existing freeze if multiple hits land close together.
  if (target > frozenUntil) frozenUntil = target;
}

export function isFrozen(): boolean {
  return gameNow() < frozenUntil;
}
