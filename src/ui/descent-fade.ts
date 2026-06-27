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

// ── Prewarm-gated reveal ────────────────────────────────────────────────────
// On WebGPU every material is a render PIPELINE that must compile before it can
// draw, and the compile is ASYNC. If we fadeIn the instant the level mounts, the
// reveal lands on a half-compiled scene with warmup effects still flashing — the
// "loading bleeding into the game" artifact. Instead we hold the black until the
// prewarm promise resolves, and if that wait runs long we show a quiet, stable
// loading mark so it reads as a deliberate descent rather than a frozen hang.

let loadingMark: HTMLDivElement | null = null;
let pulseTimer = 0;
let safetyTimer = 0;

function ensureLoadingMark(): HTMLDivElement {
  if (loadingMark) return loadingMark;
  loadingMark = document.createElement('div');
  loadingMark.id = 'descent-loading';
  Object.assign(loadingMark.style, {
    position: 'fixed',
    left: '0', right: '0', bottom: '12%',
    textAlign: 'center',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '52',           // above the black + title
    color: '#9a8a6a',
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: 'clamp(12px, 2vw, 16px)',
    letterSpacing: '0.35em',
    textTransform: 'lowercase',
    transition: 'opacity 400ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  loadingMark.textContent = 'descending';
  document.body.appendChild(loadingMark);
  return loadingMark;
}

function showLoadingMark(): void {
  const el = ensureLoadingMark();
  el.style.opacity = '0.55';
  // Slow breathe so it reads as alive, not a spinner — matches the dungeon's
  // unhurried tone. Web Animations API, cancelled when we hide.
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [{ opacity: 0.18 }, { opacity: 0.6 }, { opacity: 0.18 }],
    { duration: 2200, iterations: Infinity, easing: 'ease-in-out' },
  );
}

function hideLoadingMark(): void {
  if (!loadingMark) return;
  loadingMark.getAnimations().forEach((a) => a.cancel());
  loadingMark.style.opacity = '0';
}

/** Reveal the new level when `ready` resolves — or immediately if it's not a
 *  promise (WebGL / already-warm floors). While waiting on the WebGPU pipeline
 *  prewarm the black stays up; a quiet "descending" mark appears only if the wait
 *  is long enough to notice (so fast floors don't flash it). `onReveal` fires the
 *  instant before the world appears — used to raise the "Depth N" title so its
 *  beat tracks the real reveal, not the load start. A safety cap reveals anyway
 *  if the prewarm stalls, so a driver hiccup can never strand the player on black. */
export function revealWhenReady(ready?: Promise<unknown> | void, onReveal?: () => void): void {
  const finish = (): void => {
    window.clearTimeout(pulseTimer);
    window.clearTimeout(safetyTimer);
    hideLoadingMark();
    onReveal?.();
    fadeIn();
  };
  if (!ready || typeof (ready as { then?: unknown }).then !== 'function') { finish(); return; }
  // COVER FIRST. The warm pass renders its subjects to the (still-visible) canvas to
  // compile pipelines at the real format, so the screen MUST be black before it runs.
  // The descent path already faded out, but the first floor from the title loads via
  // loadInitialLevel with no fadeOut — so raise the black instantly here. fadeIn drops
  // it on reveal. (Idempotent: if already black, this is a no-op.)
  const cover = ensureOverlay();
  cover.style.transition = 'opacity 0ms';
  cover.style.opacity = '1';
  pulseTimer = window.setTimeout(showLoadingMark, 320);   // only show the mark for noticeable waits
  safetyTimer = window.setTimeout(finish, 15000);          // never strand on black
  let revealed = false;
  const once = (): void => { if (revealed) return; revealed = true; finish(); };
  (ready as Promise<unknown>).then(once, once);
}

// One-shot suppression — the next showDescentTitle is skipped. Used by the
// vault-inspector snaps so the "Depth N" card never covers the geometry.
let suppressNext = false;
export function suppressNextDescentTitle() { suppressNext = true; }

/** Show a title card (e.g. "Depth 3 / The Old Refectory") centered
 *  on the black overlay. Call AFTER fadeOut completes so the text is
 *  born onto the black, then it auto-fades a moment after the world
 *  is revealed. Pass an empty subtitle for unnamed depths. */
export function showDescentTitle(title: string, subtitle: string = '') {
  if (suppressNext) { suppressNext = false; return; }
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
