// Brief fade-to-black on descent. The level loader tears down the
// active world synchronously and the new one pops in on the next
// frame — without a transition the camera angle and surroundings
// just snap, which reads as a teleport bug. A tight 220ms fade-out
// + 220ms fade-in around the actual swap covers the snap.
//
// Driven from main.ts's loadLevel flow: the loader signals a fade
// before tearing down + signals the fade-in after the new level
// builds.
//
// A second overlay carries a "Depth N — Act Name" title card that
// rides on top of the black. The card stays visible while the world
// is hidden and fades out alongside the black, so the player gets a
// momentary "you have arrived" beat instead of a silent jump.

let overlay: HTMLDivElement | null = null;
let titleCard: HTMLDivElement | null = null;
let titleEl: HTMLDivElement | null = null;
let subtitleEl: HTMLDivElement | null = null;

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

function ensureTitleCard(): HTMLDivElement {
  if (titleCard) return titleCard;
  titleCard = document.createElement('div');
  titleCard.id = 'descent-title';
  Object.assign(titleCard.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '51',           // sits ABOVE the black overlay
    color: '#d8c8a8',
    fontFamily: 'Georgia, "Times New Roman", serif',
    textAlign: 'center',
    letterSpacing: '0.12em',
    textShadow: '0 0 12px rgba(0,0,0,0.9)',
    transition: 'opacity 320ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    fontSize: 'clamp(28px, 7vw, 56px)',
    fontWeight: '300',
    margin: '0 0 0.4em 0',
  } as Partial<CSSStyleDeclaration>);

  subtitleEl = document.createElement('div');
  Object.assign(subtitleEl.style, {
    fontSize: 'clamp(13px, 2.4vw, 18px)',
    fontStyle: 'italic',
    opacity: '0.7',
    letterSpacing: '0.18em',
  } as Partial<CSSStyleDeclaration>);

  titleCard.appendChild(titleEl);
  titleCard.appendChild(subtitleEl);
  document.body.appendChild(titleCard);
  return titleCard;
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

/** Show a title card (e.g. "Depth 3 / The Old Refectory") centered
 *  on the black overlay. Call AFTER fadeOut completes so the text is
 *  born onto the black, then it auto-fades a moment after the world
 *  is revealed. Pass an empty subtitle for unnamed depths. */
export function showDescentTitle(title: string, subtitle: string = '') {
  const card = ensureTitleCard();
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
  // Snap to visible — no transition on the rise, only on the fall.
  card.style.transition = 'opacity 0ms';
  card.style.opacity = '1';
  // Hold a beat past the world fade-in, then fade out.
  window.setTimeout(() => {
    card.style.transition = 'opacity 700ms ease-in';
    card.style.opacity = '0';
  }, 900);
}
