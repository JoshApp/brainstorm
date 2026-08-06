// "IS THE PLAYER ASKING TO RUN?" — one answer, two devices.
//
// On a phone it is a long press on the dodge button; on a desktop it is Shift.
// Both feed the same thing (momentum's build rate), and neither should have to
// know the other exists — so the question gets its own tiny module rather than
// the movement code importing a touch control and a keyboard poller and OR-ing
// them at the call site.

import { isSprinting as dodgeButtonHeld } from './dodge-button';

let desktopHeld = false;

/** Polled by the desktop input each frame from the Shift key. */
export function setDesktopRunHeld(v: boolean): void { desktopHeld = v; }

/** Is the player asking to run, on whatever they're holding? */
export function isRunHeld(): boolean {
  return desktopHeld || dodgeButtonHeld();
}
