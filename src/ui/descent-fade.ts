// Brief fade-to-black on descent. The level loader tears down the
// active world synchronously and the new one pops in on the next
// frame — without a transition the camera angle and surroundings
// just snap, which reads as a teleport bug. A tight 220ms fade-out
// + 220ms fade-in around the actual swap covers the snap.
//
// Driven from main.ts's loadLevel flow: the loader signals a fade
// before tearing down + signals the fade-in after the new level
// builds.

let overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'descent-fade';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: '#000',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '50',           // above HUD (10-15), below screens (100+)
    transition: 'opacity 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlay);
  return overlay;
}

/** Fade the screen to black. Returns a promise that resolves after
 *  the fade completes. The caller should run the level swap during
 *  the black, then call fadeIn. */
export function fadeOut(): Promise<void> {
  const el = ensureOverlay();
  return new Promise((resolve) => {
    el.style.transition = 'opacity 220ms ease-out';
    el.style.opacity = '1';
    window.setTimeout(resolve, 230);
  });
}

/** Fade the black back out, revealing the new level. */
export function fadeIn(): void {
  const el = ensureOverlay();
  // Slight delay so the first frame of the new level renders BEFORE
  // the fade starts (prevents popping in mid-render).
  window.setTimeout(() => {
    el.style.transition = 'opacity 320ms ease-out';
    el.style.opacity = '0';
  }, 40);
}
