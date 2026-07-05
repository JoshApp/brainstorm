// Cached canvas bounding rect — getBoundingClientRect forces browser LAYOUT,
// and calling it per frame measured 2-3% of phone CPU *per caller* (interact
// label, tutorial hints, item previews — found one at a time in the 2026-07-04
// and 07-05 USB profiles). The rect only changes on resize/rotation, so every
// per-frame world→screen projection should read THIS instead.
let rect: DOMRect | null = null;
let rectFor: HTMLCanvasElement | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { rect = null; });
  window.addEventListener('orientationchange', () => { rect = null; });
}

/** The canvas's bounding rect, recomputed only after resize/rotation. */
export function cachedCanvasRect(canvas: HTMLCanvasElement): DOMRect {
  if (!rect || rectFor !== canvas) {
    rect = canvas.getBoundingClientRect();
    rectFor = canvas;
  }
  return rect;
}
