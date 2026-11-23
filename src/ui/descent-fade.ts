import { FAST_BOOT } from '../debug/fast-boot';
import { waitForPresentedFrames, isWarmingUp } from '../style/render-webgpu';
import { DESCENT_LINES } from '../content/descent-lines';
import { FONT_TITLE, FONT_DISPLAY } from './theme';
import { injectGameFonts } from './fonts';
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

// ── THE DESCENT SCREEN (Lamplight) ──────────────────────────────────────────
// One element is both the loading view and the arrival title, so the two read
// as one beat: while the floor is made it says where you are going (DEPTH N
// over the HUD's skull rule, the floor's name), an ember burns along that rule
// as the work completes, and the deep says one line (content/descent-lines.ts).
// At the reveal the line and the burning go, and the title holds over the
// world a moment before it fades, where it already was.
let screen: HTMLDivElement | null = null;
let titleEl: HTMLDivElement | null = null;
let subtitleEl: HTMLDivElement | null = null;
let ruleEl: HTMLDivElement | null = null;
let burnEl: HTMLDivElement | null = null;
let lineEl: HTMLDivElement | null = null;
let pctEl: HTMLDivElement | null = null;
let lastLine = -1;

const SKULL_SVG = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1 a5 5 0 0 1 5 5 v1.6 a2.4 2.4 0 0 1 -2.4 2.4 h-5.2 a2.4 2.4 0 0 1 -2.4 -2.4 v-1.6 a5 5 0 0 1 5 -5 z" fill="currentColor"/><circle cx="4" cy="6.4" r="1.1" fill="#0b0705"/><circle cx="8" cy="6.4" r="1.1" fill="#0b0705"/></svg>`;

function injectScreenStyles(): void {
  if (document.getElementById('descent-screen-style')) return;
  // The first descent can come before any screen registered the faces (a
  // scenario, a resume): register them here, and ask for the two this screen
  // speaks in so they arrive while the black is still up.
  injectGameFonts();
  void document.fonts?.load(`600 32px ${FONT_TITLE}`).catch(() => {});
  void document.fonts?.load(`italic 16px ${FONT_DISPLAY}`).catch(() => {});
  const st = document.createElement('style');
  st.id = 'descent-screen-style';
  st.textContent = `
    #descent-title { position: fixed; inset: 0; z-index: 51; pointer-events: none; opacity: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
      padding: 0 24px; transition: opacity 320ms ease-out; }
    #descent-title .ds-title { font: 600 clamp(22px, 4.6vw, 40px)/1.1 ${FONT_TITLE}; letter-spacing: .34em; text-indent: .34em;
      color: #e6cfa4; text-shadow: 0 0 18px rgba(255, 150, 60, .18), 0 2px 0 #000; }
    #descent-title .ds-rule { position: relative; width: min(340px, 64vw); height: 18px; margin: 12px 0 10px; color: #6e5634; }
    #descent-title .ds-rule::before, #descent-title .ds-rule::after { content: ''; position: absolute; top: 50%; height: 1px;
      width: calc(50% - 16px); background: rgba(138, 111, 62, .55); }
    #descent-title .ds-rule::before { left: 0; } #descent-title .ds-rule::after { right: 0; }
    #descent-title .ds-rule svg { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); transition: color .4s, filter .4s; }
    #descent-title .ds-rule.lit { color: #ffb35c; }
    #descent-title .ds-rule.lit svg { filter: drop-shadow(0 0 5px rgba(255, 150, 50, .9)); }
    #descent-title .ds-burn { position: absolute; left: 0; top: 50%; height: 1px; width: 0; transform: translateY(-50%);
      background: linear-gradient(90deg, rgba(160, 70, 20, .5), #ff9a40); box-shadow: 0 0 6px rgba(255, 140, 50, .8);
      transition: width 280ms ease-out, opacity 300ms; opacity: 0; }
    #descent-title .ds-burn::after { content: ''; position: absolute; right: -3px; top: -3px; width: 7px; height: 7px; border-radius: 50%;
      background: radial-gradient(circle, #fff1c8 0%, #ffae50 45%, rgba(255, 120, 40, 0) 75%);
      box-shadow: 0 0 10px 3px rgba(255, 140, 50, .55); animation: ds-flicker 1.3s ease-in-out infinite; }
    @keyframes ds-flicker { 50% { opacity: .65; transform: scale(.85); } }
    #descent-title.loading .ds-burn { opacity: 1; }
    #descent-title .ds-name { font: italic clamp(14px, 2.5vw, 20px)/1.3 ${FONT_DISPLAY}; letter-spacing: .04em; color: rgba(222, 192, 152, .82); }
    #descent-title .ds-line { margin-top: clamp(18px, 5vh, 40px); max-width: 34ch; font: italic clamp(13px, 2.1vw, 16px)/1.45 ${FONT_DISPLAY};
      color: rgba(190, 158, 122, .62); opacity: 0; transition: opacity 600ms ease-out; }
    #descent-title.loading .ds-line { opacity: 1; }
    #descent-title .ds-pct { margin-top: 10px; font: 600 10px/1 system-ui, sans-serif; letter-spacing: .3em; color: rgba(170, 130, 90, .5);
      opacity: 0; transition: opacity 300ms; }
    #descent-title.loading .ds-pct.on { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { #descent-title .ds-burn::after { animation: none; } }
  `;
  document.head.appendChild(st);
}

function ensureTitleCard(): HTMLDivElement {
  if (screen) return screen;
  injectScreenStyles();
  screen = document.createElement('div');
  screen.id = 'descent-title';
  titleEl = document.createElement('div'); titleEl.className = 'ds-title';
  ruleEl = document.createElement('div'); ruleEl.className = 'ds-rule'; ruleEl.innerHTML = SKULL_SVG;
  burnEl = document.createElement('div'); burnEl.className = 'ds-burn'; ruleEl.appendChild(burnEl);
  subtitleEl = document.createElement('div'); subtitleEl.className = 'ds-name';
  lineEl = document.createElement('div'); lineEl.className = 'ds-line';
  pctEl = document.createElement('div'); pctEl.className = 'ds-pct';
  screen.append(titleEl, ruleEl, subtitleEl, lineEl, pctEl);
  document.body.appendChild(screen);
  return screen;
}

/** A line the deep says, never the same twice running. */
function pickLine(): string {
  if (DESCENT_LINES.length === 0) return '';
  let i = Math.floor(Math.random() * DESCENT_LINES.length);
  if (i === lastLine && DESCENT_LINES.length > 1) i = (i + 1) % DESCENT_LINES.length;
  lastLine = i;
  return DESCENT_LINES[i];
}

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

let pulseTimer = 0;
let safetyTimer = 0;
/** The title the next reveal will raise, known before the wait so the loading
 *  view can already say it. Set by revealWhenReady's `card`. */
let pendingCard: { title: string; subtitle: string } | null = null;

/** Drive the descent loading progress, 0..1 (the warmup reports its batch
 *  progress): the ember burns along the rule. No-op until the loading view is
 *  up — fast floors never show it. Progress is also the cover watchdog's
 *  heartbeat: a warm that reports is a warm that's alive. */
export function setDescentProgress(t: number): void {
  descentWorkHeartbeat();
  if (!screen || !screen.classList.contains('loading') || !burnEl || !ruleEl || !pctEl) return;
  const c = Math.max(0, Math.min(1, t));
  burnEl.style.width = `${c * 100}%`;
  ruleEl.classList.toggle('lit', c >= 0.5);
  // A long warm (cold cache after an update) can hold this cover for a minute
  // on a phone; a bare line read as "frozen" (2026-07-04 report). Say where it is.
  pctEl.textContent = `${Math.round(c * 100)}%`;
  pctEl.classList.add('on');
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
  const el = ensureTitleCard();
  if (titleEl) titleEl.textContent = pendingCard?.title ?? '';
  if (subtitleEl) subtitleEl.textContent = pendingCard?.subtitle ?? '';
  if (titleEl) titleEl.style.display = pendingCard ? '' : 'none';
  if (subtitleEl) subtitleEl.style.display = pendingCard?.subtitle ? '' : 'none';
  if (lineEl) lineEl.textContent = pickLine();
  if (burnEl) { burnEl.style.transition = 'none'; burnEl.style.width = '0'; void burnEl.offsetWidth; burnEl.style.transition = ''; }
  ruleEl?.classList.remove('lit');
  if (pctEl) { pctEl.textContent = ''; pctEl.classList.remove('on'); }
  el.classList.add('loading');
  el.style.transition = 'opacity 400ms ease-out';
  el.style.opacity = '1';
}

function hideLoadingMark(): void {
  if (!screen) return;
  screen.classList.remove('loading');
  // No title to hold (a safe room): the whole view goes with the black.
  if (!pendingCard) { screen.style.transition = 'opacity 320ms ease-out'; screen.style.opacity = '0'; }
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

export function revealWhenReady(
  ready?: Promise<unknown> | void,
  onReveal?: () => void,
  /** The title the reveal raises, so the loading view can say it while it waits. */
  card?: { title: string; subtitle?: string },
): void {
  // Consume the one-shot here, not in finish(): a reveal that returns early
  // (no promise) still has to clear it, or the flag survives to dress-down the
  // NEXT transition — which would be a real descent.
  const plain = suppressNextMark;
  suppressNextMark = false;
  pendingCard = card ? { title: card.title, subtitle: card.subtitle ?? '' } : null;
  const finish = (): void => {
    window.clearTimeout(pulseTimer);
    window.clearTimeout(safetyTimer);
    hideLoadingMark();
    onReveal?.();
    pendingCard = null;
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
  card.classList.remove('loading');
  if (titleEl) { titleEl.textContent = title; titleEl.style.display = ''; }
  if (subtitleEl) { subtitleEl.textContent = subtitle; subtitleEl.style.display = subtitle ? '' : 'none'; }
  // Snap to visible (a no-op when the loading view already shows it) — no
  // transition on the rise, only on the fall.
  card.style.transition = 'opacity 0ms';
  card.style.opacity = '1';
  // Hold a beat past the world fade-in, then fade out.
  window.setTimeout(() => {
    card.style.transition = 'opacity 700ms ease-in';
    card.style.opacity = '0';
  }, 900);
}
