import { FAST_BOOT } from '../debug/fast-boot';
import { waitForPresentedFrames, isWarmingUp } from '../style/render-webgpu';
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
    // Matches the boot veil: a faint warm breath in the centre falling to true
    // black at the edges — depth, not a flat card.
    background: 'radial-gradient(ellipse 90% 70% at 50% 46%, rgba(38,22,12,0.55), rgba(0,0,0,0) 60%) #000',
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

// TRUE from the start of a descent fade-out (or a reveal raising the black) until the
// fade-in has fully receded. The world stays PAUSED across it (world-paused.ts ORs this
// in), so gameplay can't begin until the new floor has fully appeared — no acting blind,
// no being hit, during the transition.
let transitioning = false;
export function isDescendTransition(): boolean { return transitioning; }

/** Fade the screen to black. Returns a promise that resolves after
 *  the fade completes. The caller should run the level swap during
 *  the black, then call fadeIn. */
export function fadeOut(): Promise<void> {
  transitioning = true;
  document.body.classList.add('descending');
  const el = ensureOverlay();
  return new Promise((resolve) => {
    // ?fast=1 collapses the transition — the black still goes up (the level swap must not be
    // visible), it just does not take a quarter second about it.
    el.style.transition = FAST_BOOT ? 'opacity 0ms' : 'opacity 220ms ease-out';
    el.style.opacity = '1';
    window.setTimeout(resolve, FAST_BOOT ? 0 : 230);
  });
}

/** Fade the black back out, revealing the new level. Gameplay resumes (transitioning
 *  clears) only once the fade has fully completed. */
export function fadeIn(): void {
  const el = ensureOverlay();
  // Wait for REAL presented frames before the fade starts — the canvas may
  // still hold the last (covered) warm frame after a pipeline warm, and rAF
  // ticks alone don't prove a present (the frame cap skips draws). Gate on the
  // renderer's presented-frame counter, with a timeout so a hidden tab can't
  // strand the cover.
  // ?fast=1 skips the presented-frame gate as well as the fade. The gate is there so the reveal
  // cannot land on the last covered warm frame — with nothing warming there is no such frame,
  // and waiting for two presents is a third of a second per descent.
  void (FAST_BOOT ? Promise.resolve() : waitForPresentedFrames(2, 1500)).then(() => {
    el.style.transition = FAST_BOOT ? 'opacity 0ms' : 'opacity 320ms ease-out';
    el.style.opacity = '0';
    window.setTimeout(() => {
      transitioning = false;
      document.body.classList.remove('descending');   // HUD returns with the world
    }, FAST_BOOT ? 0 : 340);   // after the fade finishes
  });
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
  // Label in its own span so the progress % can update without nuking the ember child.
  markLabel = document.createElement('span');
  markLabel.textContent = 'descending';
  loadingMark.appendChild(markLabel);
  // The same breathing coal the boot veil carries, floating above the mark.
  const ember = document.createElement('div');
  ember.classList.add('ember-coal');
  Object.assign(ember.style, {
    position: 'fixed', left: '50%', bottom: 'calc(12% + 34px)',
    transform: 'translateX(-50%)',
    pointerEvents: 'none', zIndex: '52',
  } as Partial<CSSStyleDeclaration>);
  loadingMark.appendChild(ember);
  document.body.appendChild(loadingMark);

  // A thin amber progress line under the mark — a real fill (driven by the warmup
  // batches), not a spinner: it reads as the dark slowly admitting you, in keeping
  // with the unhurried tone. Hidden (scaleX 0) until setDescentProgress drives it.
  progressBar = document.createElement('div');
  Object.assign(progressBar.style, {
    position: 'fixed', left: '50%', bottom: 'calc(12% - 14px)',
    width: 'min(180px, 40vw)', height: '2px',
    transform: 'translateX(-50%)',
    pointerEvents: 'none', opacity: '0', zIndex: '52',
    transition: 'opacity 400ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    height: '100%', width: '100%',
    transformOrigin: 'left center', transform: 'scaleX(0)',
    background: 'linear-gradient(90deg, rgba(255,150,80,0.15), rgba(255,150,80,0.7))',
    transition: 'transform 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  progressBar.appendChild(fill);
  progressFill = fill;
  document.body.appendChild(progressBar);
  return loadingMark;
}

let progressBar: HTMLDivElement | null = null;
let progressFill: HTMLDivElement | null = null;
let markLabel: HTMLSpanElement | null = null;

/** Drive the descent loading bar, 0..1 (the warmup reports its batch progress).
 *  No-op until the loading mark exists — fast floors never show it. Progress is
 *  also the cover watchdog's heartbeat: a warm that reports is a warm that's
 *  alive, so the strand-guard must not reveal over it. */
export function setDescentProgress(t: number): void {
  descentWorkHeartbeat();
  if (!progressFill || !progressBar) return;
  progressBar.style.opacity = '0.8';
  const c = Math.max(0, Math.min(1, t));
  progressFill.style.transform = `scaleX(${c})`;
  // A long warm (cold cache after an update) can hold this cover for a minute
  // on a phone — a bare 2px bar read as "black screen, frozen" (2026-07-04
  // report). Say where it is, plainly.
  if (markLabel) markLabel.textContent = `descending · ${Math.round(c * 100)}%`;
}

// ── Cover watchdog heartbeat ────────────────────────────────────────────────
// revealWhenReady's strand-guard used to be a FIXED 15s timer — but the first
// descent's full warm (roster + real roster + deferred drain + whole-floor
// compile) legitimately runs longer on slow machines. The timer fired mid-warm,
// the cover dropped, and the player got a frozen "game" for the remaining warm
// seconds (renderWebGPU skips submits while warmingUp — the measured 8s
// post-reveal freeze). The guard is now a WATCHDOG: warm work pets it (progress
// reports above, per-subject drain steps, the live warmingUp flag), and it only
// reveals after true silence — a genuinely stranded promise still can't hold
// the black forever.
let lastWorkAlive = 0;
export function descentWorkHeartbeat(): void { lastWorkAlive = performance.now(); }

// Returning to the tab restarts the clock. Petting while hidden (safetyCheck)
// is not enough by itself: background timers are throttled to roughly once a
// minute, so the last pet can already be ~60s stale at the moment we come back
// — and the first check after that would trip the 15s guard instantly, which is
// the very reveal-over-a-half-warmed-scene this is meant to prevent. The warm
// only resumes once rAF does, so give it a fresh window from that instant.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) descentWorkHeartbeat();
  });
}

function showLoadingMark(): void {
  const el = ensureLoadingMark();
  // Reset the bar + label for this descent (the element is reused across loads).
  if (progressFill) { progressFill.style.transition = 'none'; progressFill.style.transform = 'scaleX(0)'; void progressFill.offsetWidth; progressFill.style.transition = 'transform 280ms ease-out'; }
  if (markLabel) markLabel.textContent = 'descending';
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
  if (progressBar) progressBar.style.opacity = '0';
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
/** Snap the black cover fully opaque, instantly (no fade). For boot paths that
 *  are about to run a heavy SYNCHRONOUS level build with no fadeOut before it —
 *  raise this, let it PAINT (two rAFs), then build, so the player sees a clean
 *  black instead of a frozen menu. revealWhenReady/fadeIn drop it as usual. */
export function holdCover(): void {
  transitioning = true;
  document.body.classList.add('descending');   // covers own HUD visibility (index.html rule)
  const cover = ensureOverlay();
  cover.style.transition = 'opacity 0ms';
  cover.style.opacity = '1';
}

export function revealWhenReady(ready?: Promise<unknown> | void, onReveal?: () => void): void {
  // Consume the one-shot here, not in finish(): a reveal that returns early
  // (no promise) still has to clear it, or the flag survives to dress-down the
  // NEXT transition — which would be a real descent.
  const plain = suppressNextMark;
  suppressNextMark = false;
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
  transitioning = true;   // gameplay stays paused until fadeIn fully recedes
  document.body.classList.add('descending');
  const cover = ensureOverlay();
  cover.style.transition = 'opacity 0ms';
  cover.style.opacity = '1';
  // Only show the mark for noticeable waits — and never when this transition
  // isn't a descent (see suppressNextLoadingMark).
  if (!plain) pulseTimer = window.setTimeout(showLoadingMark, 320);
  // Strand-guard WATCHDOG (see descentWorkHeartbeat): reveal only after 15s of
  // NO warm activity — heartbeats and the live warmingUp flag both count as
  // alive. A legit long first-descent warm holds the black to completion; a
  // genuinely stranded promise still gets cut loose 15s after its last sign of
  // life.
  const QUIET_MS = 15000;
  descentWorkHeartbeat();
  let revealed = false;
  const once = (): void => { if (revealed) return; revealed = true; finish(); };
  const safetyCheck = (): void => {
    if (revealed) return;
    if (isWarmingUp()) descentWorkHeartbeat();
    // A BACKGROUNDED TAB IS NOT A STRANDED PROMISE. The warm advances on rAF
    // (yieldFrame between batches), and rAF stops while the tab is hidden — so
    // the warm parks mid-sequence, stops reporting progress, and warmDepth sits
    // at 0 because it parked BETWEEN renders. Every liveness signal this guard
    // watches goes quiet at once, while setTimeout keeps running, so 15s of
    // being tabbed out looked exactly like a stranded load: the cover dropped
    // over a half-warmed scene. Tab back in and you were greeted by the warm's
    // subjects strewn through the level — "a jumble of objects" — until the
    // warm resumed and removed them, with the world still at the warm's tiny
    // 0.05 render scale, which is the pixelation that then "sharpened" when the
    // warm restored it. Pet the watchdog while hidden: the clock that matters
    // is time spent stalled while the page can actually make progress.
    if (document.hidden) descentWorkHeartbeat();
    const quiet = performance.now() - lastWorkAlive;
    if (quiet >= QUIET_MS) { once(); return; }
    safetyTimer = window.setTimeout(safetyCheck, Math.min(1000, QUIET_MS - quiet + 50));
  };
  safetyTimer = window.setTimeout(safetyCheck, 1000);
  (ready as Promise<unknown>).then(once, once);
}

// One-shot suppression — the next showDescentTitle is skipped. Used by the
// vault-inspector snaps so the "Depth N" card never covers the geometry.
let suppressNext = false;
export function suppressNextDescentTitle() { suppressNext = true; }

// ── LEAVING IS NOT DESCENDING ───────────────────────────────────────────────
//
// Abandoning a run, quitting to the menu and the death screen's continue all
// route through the same in-place level swap a descent uses (app-restart.ts) —
// they rebuild the title vignette rather than reloading the page, which is the
// whole reason the pipeline cache survives.
//
// But the swap presented itself as a DESCENT: the black cover, then a mark that
// literally reads "descending" and an amber progress bar filling underneath it,
// on top of the menu. Which is exactly what it looks like — the app restarting
// — and it is why abandoning a run reads as a full reload when nothing reloads
// at all. Reported from the phone in those words.
//
// The COVER stays: the level build is synchronous and would otherwise freeze the
// run's last frame on screen. Only the descent DRESSING goes. One-shot, so it
// can't leak into the next real descent.
let suppressNextMark = false;
/** Cover the next transition in plain black — no "descending", no progress bar.
 *  For transitions that are not a descent. Consumed by the next reveal. */
export function suppressNextLoadingMark(): void { suppressNextMark = true; }

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
