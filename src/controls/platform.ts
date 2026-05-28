// Tiny helper to decide whether the player is on a pure desktop
// (mouse + keyboard, no touch) so we can opt-in to desktop UX bits
// like keyboard hint badges on HUD buttons.
//
// Conservative: returns true ONLY on devices with NO touch capability
// AND a coarse-pointer media query that hints at mouse / trackpad.
// Touchscreen laptops fall through (they have touch + a keyboard;
// players there can use either, and we'd rather not show hint badges
// to a touch-only user who's never going to press 'Q').

let cached: boolean | null = null;

export function isDesktopLike(): boolean {
  if (cached !== null) return cached;
  const noTouch = navigator.maxTouchPoints === 0 && !('ontouchstart' in window);
  const finePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: fine)').matches
    : true;
  cached = noTouch && finePointer;
  return cached;
}
