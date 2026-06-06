// Touch-activity beacon — lets the desktop input scheme ignore the
// "compatibility" mouse events a touch device synthesizes after every tap
// (mousedown / mouseup / click, ~300–500ms later). Both schemes run at once
// (input.ts) on the assumption their event types don't overlap; on a phone
// they DO (a tap fires touch events AND a ghost mouse click), which double-
// fired actions — e.g. a tapped-open chest also swinging. The touch scheme
// stamps activity here; the desktop scheme bails when a touch was just seen.

let lastTouchMs = -Infinity;

/** Call from the touch scheme on touchstart / touchend. */
export function markTouchActivity(): void {
  lastTouchMs = performance.now();
}

/** True if a touch happened within `windowMs` — i.e. an incoming mouse event
 *  is almost certainly a touch-synthesized ghost, not a real mouse. */
export function touchWasRecent(windowMs = 800): boolean {
  return performance.now() - lastTouchMs < windowMs;
}
