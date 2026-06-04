// Shared dash/dodge trigger — set by an input scheme (touch: double-tap the
// move side; desktop: the dash key), consumed once per frame by the 'dash'
// system. Mirrors attack-input.ts.
//
// Carries the CAMERA-RELATIVE direction the dash should travel: dx = strafe
// (like InputState.moveX), dy = forward sign (like InputState.moveY, where
// negative is forward). (0, 0) means "no direction held" → a backstep.

let pending = false;
let dirX = 0;
let dirY = 0;

/** Request a dash this frame, in the given camera-relative direction. */
export function triggerDash(camRelX: number, camRelY: number): void {
  pending = true;
  dirX = camRelX;
  dirY = camRelY;
}

/** Game-loop side: returns the pending dash's direction at most once per
 *  request, or null if none. */
export function consumeDash(): { dx: number; dy: number } | null {
  if (!pending) return null;
  pending = false;
  return { dx: dirX, dy: dirY };
}

/** Drop any pending dash (level load / control loss). */
export function resetDashInput(): void {
  pending = false;
}
