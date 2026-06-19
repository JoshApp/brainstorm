// Shared "interact pressed" flag — mirrors attack-input.ts. Any input source
// (the E key, the floating prompt tap, a direct tap on an object) sets it.
//
// Two readers:
//   - the run recorder PEEKS it, so a run's interactions (descend a stair, open
//     a chest, take loot) land in the replay tape — without this, multi-floor
//     runs replay to depth 0 because the player never uses the stairs.
//   - on REPLAY, a sim system consumes it and uses the in-range interactable.
//     In LIVE play the input handlers still perform the interaction directly
//     (unchanged — zero regression risk); the flag is recording-only there.

import { isWorldPausedByScreen } from '../ui/screen-manager';
import { DEV } from '../debug/dev';
import { traceTrigger } from '../debug/interact-trace';

let pressed = false;

/** Called by any input source when the player asks to interact. `source` is a
 *  DEV-only label ('tap' | 'ekey' | 'label') for the interact-capture trace. */
export function triggerInteract(source?: string): void {
  if (isWorldPausedByScreen()) {
    if (DEV) traceTrigger(source, false); // a screen swallowed the press
    return;
  }
  pressed = true;
  if (DEV) traceTrigger(source, true);
}

/** Consume the pending press — true at most once per press. */
export function consumeInteractPressed(): boolean {
  if (!pressed) return false;
  pressed = false;
  return true;
}

/** Read the pending press WITHOUT consuming — for the run recorder, which must
 *  capture the intent the systems are about to consume this step. */
export function peekInteractPressed(): boolean {
  return pressed;
}
