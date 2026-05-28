// Composite "is the world paused?" predicate.
//
// Three independent pause sources exist by design — each owns its own state:
//
//   - hit-pause      → combat feel (80ms freeze after a hit lands)
//   - debug freeze   → scenarios / snap CLI deterministic frames
//   - screen pause   → any open screen whose policy.pausesWorld is true
//
// The main tick loop wants "any of these → skip world updates", and so does
// any future system that needs to know. Centralizing the OR here means a new
// pause source (cutscene, loading veil, etc.) plugs in once instead of in
// every call site.

import { isFrozen } from './combat/hit-pause';
import { isWorldFrozen } from './debug/freeze';
import { isWorldPausedByScreen } from './ui/screen-manager';

export function isWorldPaused(): boolean {
  return isFrozen() || isWorldFrozen() || isWorldPausedByScreen();
}
