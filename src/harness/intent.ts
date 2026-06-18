// The drive-by-wire intent bus — the spine of the harness-anew.
//
// ONE per-frame Intent is the sole control input the sim consumes. Whatever
// produces it — a human's thumb, a bot policy, a replay tape — writes the SAME
// shape to the SAME bus, so the game can't tell them apart and a driver can
// never get a power a thumb can't. "Bot takes over" = swap the source. "Replay"
// = feed the tape. "Record" = tap the bus.
//
// This is deliberately LOWER-level than the legacy Action vocab (move-for-N-
// seconds): the tape must be frame-accurate to replay deterministically, so the
// unit is the resolved per-frame intent, not a high-level verb. Verbs become a
// convenience layer that expands into intents over frames.
//
// Drive-by-wire reuses the input seams that already exist:
//   - setInputOverride() feeds continuous move/look into InputState
//   - triggerAttack() / triggerDash() are the edge-triggered queues
// so this composes with the game's existing input path instead of forking it.

import type { InputState } from '../controls/input';
import { setInputOverride } from '../controls/input';
import { triggerAttack } from '../controls/attack-input';
import { triggerDash } from '../controls/dash-input';
import { triggerInteract } from '../controls/interact-input';

export interface Intent {
  /** Camera-relative move: [strafe (=moveX), forward-sign (=moveY, −=forward)]. */
  move: [number, number];
  /** Look delta this frame: [lookDx, lookDy]. */
  look: [number, number];
  /** Edge-triggered: swing this frame. */
  attack: boolean;
  /** Edge-triggered dodge in camera-relative dir, or null for none.
   *  [0,0] is a valid dodge (neutral backstep). */
  dodge: [number, number] | null;
  /** Edge-triggered: use the in-range interactable this frame (descend a
   *  stair, open a chest, take loot). Optional so pre-interact tapes still
   *  parse (treated as false). */
  interact?: boolean;
}

export const NEUTRAL_INTENT: Intent = {
  move: [0, 0],
  look: [0, 0],
  attack: false,
  dodge: null,
  interact: false,
};

/** Deep-copy an intent — tapes own their frames; don't alias the live bus. */
export function cloneIntent(i: Intent): Intent {
  return {
    move: [i.move[0], i.move[1]],
    look: [i.look[0], i.look[1]],
    attack: i.attack,
    dodge: i.dodge ? [i.dodge[0], i.dodge[1]] : null,
    interact: !!i.interact,
  };
}

let current: Intent = NEUTRAL_INTENT;
let installed = false;

/** Install the continuous-input override ONCE: each frame the game reads
 *  move/look from whatever intent the bus currently holds. Idempotent. */
export function installBus(): void {
  if (installed) return;
  installed = true;
  setInputOverride((s: InputState) => {
    s.moveX = current.move[0];
    s.moveY = current.move[1];
    s.lookDx = current.look[0];
    s.lookDy = current.look[1];
  });
}

/** Hand the bus back to the touch/keyboard schemes (live human control). */
export function releaseBus(): void {
  installed = false;
  current = NEUTRAL_INTENT;
  setInputOverride(null);
}

/** A source (bot / replay / live-capture) sets this frame's intent. The
 *  continuous part (move/look) is read by the override; the EDGE part
 *  (attack/dodge) is fired here, exactly once, so it lands this frame. */
export function setIntent(i: Intent): void {
  current = i;
  if (i.attack) triggerAttack();
  if (i.dodge) triggerDash(i.dodge[0], i.dodge[1]);
  if (i.interact) triggerInteract();
}

/** Whether the intent bus is driving input (bot / replay). The interact system
 *  only performs the interaction itself in this mode — live play does it in the
 *  input handlers. */
export function isBusInstalled(): boolean {
  return installed;
}

export function getIntent(): Intent {
  return current;
}
