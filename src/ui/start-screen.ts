// Title / start screen. First thing the player sees on a fresh load.
//
// The Lamplight title (docs/UI-SYSTEM.md): the logo's own lantern is the light
// the menu is read by. The column hangs on one left line (the logo's stone
// edge, the tagline, the verbs, the footer); the chosen verb is lit, a spark
// falls to it from the lantern, and the lantern answers. The live bonfire
// vignette renders behind (main.ts mounts it); the left is scrimmed for reading.
//
// Actions:
//   CONTINUE     — only with a save. Resumes at the saved depth.
//   NEW DESCENT  — with a save: the first press arms it ("abandon depth N?"),
//                  the second abandons the run and begins again.
//   DESCEND      — without a save: begins at once (nothing to lose).
// The footer holds everything else, quieter.
//
// Every input drives it: tap, mouse, keyboard (arrows / Enter) and controller
// (D-pad / stick / A) through the shared focus scope (ui/kit/focus.ts).

import { openScreen, closeScreen, topScreenId } from './screen-manager';
import { getMeta, getStash } from '../state/meta-state';
import { getSettings } from '../settings/settings';
import { FONT_DISPLAY, FONT_TITLE } from './theme';
import { showCodex } from './codex-screen';
import { showStash } from './stash-screen';
import { showPatchlog } from './patchlog-screen';
import { showLeaderboard } from './leaderboard-screen';
import { openSettings } from './settings-menu';
import { startAccountUpgrade } from '../net/account-link';
import { isDesktopLike } from '../controls/platform';
import { noteTouchActivity, noteKeyboardMouseActivity } from '../controls/active-device';
import { hasCommunityLink, openCommunityLink, COMMUNITY_LABEL } from '../links';
import { createFocusScope, type FocusScope } from './kit/focus';
import { bindPrompts } from './kit/prompts';
import { injectKitStyles } from './kit/style';
import logoUrl from '../assets/ui/delve-logo.webp?url';

const SCREEN_ID = 'start';

/** Where the lantern's glass sits in the logo art (fractions of its box), and
 *  how far in its solid stone edge starts (pulled onto the text line). Measured
 *  from src/assets/ui/delve-logo.webp. */
const LANTERN = { x: 0.478, y: 0.40 };
const LOGO_EDGE = 0.035;
/** How long an armed NEW DESCENT waits for its second press. */
const ARM_MS = 5000;

export interface StartScreenOptions {
  hasSave: boolean;
  saveDepth?: number;
  onDescend: () => void;
  onContinue: () => void;
  /** Optional: explicit "play tutorial" entry point. Lets returning
   *  players revisit the antechamber even after their first run. */
  onTutorial?: () => void;
  /** Open the test-chambers picker. Dev affordance for verifying
   *  individual features (arena door, blood altar, ooze split, etc.)
   *  in isolation. */
  onTestChambers?: () => void;
  /** Proving Grounds — pick a weapon + a thing to test (mob/boss/event/depth)
   *  and drop into a generated, save-safe floor. */
  onProvingGrounds?: () => void;
}

let root: HTMLDivElement | null = null;
let scope: FocusScope | null = null;
let unbindPrompts: (() => void) | null = null;
let onResize: (() => void) | null = null;

/** Desktop: capture the mouse for first-person look the moment the player
 *  enters the game — the press is a user gesture, so the lock is permitted.
 *  DESKTOP ONLY: on mobile requestPointerLock still fires the browser's
 *  intrusive "to show your cursor…" banner over the descent. */
function lockPointer(): void {
  if (!isDesktopLike()) return;
  try { (document.querySelector('canvas') as HTMLCanvasElement | null)?.requestPointerLock?.(); } catch { /* denied */ }
}

const reduceMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const st = document.createElement('style');
  st.id = 'start-screen-styles';
  st.textContent = `
    #start-screen {
      position: fixed; inset: 0; overflow: hidden; pointer-events: auto;
      background: linear-gradient(90deg, rgba(5,3,2,.94) 0%, rgba(5,3,2,.84) 34%, rgba(5,3,2,.35) 62%, rgba(5,3,2,0) 82%);
      color: #d8bd8e; opacity: 0; transition: opacity .6s ease;
      user-select: none; -webkit-user-select: none;
    }
    #start-screen .ts-col {
      position: relative; z-index: 1; height: 100%; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: flex-start;
      width: min(60%, 560px);
      padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px calc(env(safe-area-inset-bottom, 0px) + 10px)
               calc(env(safe-area-inset-left, 0px) + clamp(30px, 6vw, 84px));
    }
    #start-screen .ts-space { margin-top: auto; }
    #start-screen .ts-logo {
      width: clamp(200px, min(34vw, 46vh), 380px); height: auto; display: block;
      transform: translateX(-${(LOGO_EDGE * 100).toFixed(1)}%);
      filter: drop-shadow(0 0 22px rgba(255, 140, 50, .2));
      opacity: 0; transition: opacity 1.2s ease .1s;
    }
    #start-screen.shown .ts-logo { opacity: 1; }
    #start-screen .ts-tag { font-family: ${FONT_DISPLAY}; font-style: italic; font-size: clamp(14px, 2vh + 4px, 18px); color: #cfb08c; margin-top: 6px; }
    #start-screen .ts-stat { font: 500 11px/1.4 system-ui, -apple-system, sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #7d6650; margin-top: 4px; }
    #start-screen .ts-menu { display: flex; flex-direction: column; align-items: flex-start; gap: clamp(0px, 1vh, 8px); margin: clamp(8px, 3vh, 22px) 0 0 -18px; }
    #start-screen .ts-item {
      position: relative; display: flex; align-items: baseline; gap: 14px; white-space: nowrap;
      min-height: 44px; padding: 6px 16px 6px 18px; box-sizing: border-box;
      background: none; border: 0; cursor: pointer; text-align: left;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    #start-screen .ts-item::before {
      content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 2px;
      background: rgb(255, 176, 96); box-shadow: 0 0 8px rgba(255, 176, 96, .9); opacity: 0; transition: opacity .2s;
    }
    #start-screen .ts-item .v {
      font-family: ${FONT_TITLE}; font-weight: 600; font-size: clamp(18px, 2.4vh + 6px, 26px); letter-spacing: .2em;
      color: #b99a74; text-shadow: 0 1px 0 rgba(0,0,0,.95), 0 -1px 0 rgba(255,225,180,.10); transition: color .2s, text-shadow .2s;
    }
    #start-screen .ts-item .s { font: 500 11px/1 system-ui, -apple-system, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #6f5a46; }
    #start-screen .ts-item .s.warn { display: none; color: #c0604f; }
    #start-screen .ts-item .s.warn.armed { color: #ff8a70; }
    #start-screen .ts-item.is-focused::before { opacity: 1; }
    #start-screen .ts-item.is-focused .v { color: #ffdcaa; text-shadow: 0 1px 0 #000, 0 0 18px rgba(255, 176, 96, .55); }
    #start-screen .ts-item.is-focused .s { color: #b8946c; }
    #start-screen .ts-item.is-focused .s.warn { display: inline; color: #c0604f; }
    #start-screen .ts-item.is-focused .s.warn.armed { color: #ff8a70; }
    #start-screen .ts-item:not(.is-focused) .ts-key { display: none; }
    #start-screen .ts-foot {
      position: relative; display: flex; flex-wrap: wrap; align-items: center; margin: auto 0 0 -10px; padding-top: 10px;
      /* the footer may run wider than the column: one row on most screens */
      width: calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - clamp(30px, 6vw, 84px) - 24px);
    }
    #start-screen .ts-foot::before {
      content: ''; position: absolute; top: 0; left: 10px; width: 120px; height: 1px;
      background: linear-gradient(90deg, rgba(140,100,60,.55), rgba(140,100,60,0));
    }
    #start-screen .ts-link {
      position: relative; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 10px;
      background: none; border: 0; cursor: pointer; font-family: ${FONT_TITLE}; font-weight: 600; font-size: 12px; letter-spacing: .2em;
      color: #8a7158; transition: color .15s; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    #start-screen .ts-link:not(:last-child)::after {
      content: ''; position: absolute; right: -2px; top: 50%; width: 3px; height: 3px; transform: translateY(-50%) rotate(45deg); background: #5e4834;
    }
    #start-screen .ts-link.is-focused { color: #f0cd9c; }
    #start-screen .ts-link .badge {
      min-width: 16px; height: 16px; line-height: 16px; padding: 0 4px; border-radius: 8px; box-sizing: border-box;
      background: rgba(200, 80, 50, .9); color: #ffe2c8; font: 700 10px/16px system-ui, sans-serif; letter-spacing: 0; text-align: center;
    }
    #start-screen .ts-light {
      position: absolute; z-index: 0; width: 380px; height: 76px; margin: -38px 0 0 -120px; left: 0; top: -200px; pointer-events: none;
      background: radial-gradient(closest-side, rgba(255,168,80,.20), rgba(255,140,50,.07) 55%, rgba(255,140,50,0));
      transition: top .38s cubic-bezier(.3,.7,.2,1), left .38s cubic-bezier(.3,.7,.2,1);
    }
    #start-screen .ts-lantern {
      position: absolute; z-index: 2; width: 110px; height: 110px; margin: -55px 0 0 -55px; left: -200px; top: 0; pointer-events: none;
      mix-blend-mode: screen; opacity: .45;
      background: radial-gradient(closest-side, rgba(255,200,120,.55), rgba(255,150,60,.18) 45%, rgba(255,150,60,0));
    }
    #start-screen .ts-spark {
      position: absolute; z-index: 3; left: 0; top: 0; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%;
      pointer-events: none; opacity: 0;
      background: radial-gradient(circle, #fff3d0, #ffb45a 55%, rgba(255,150,60,0)); box-shadow: 0 0 10px rgba(255,170,80,.9);
    }
    @media (prefers-reduced-motion: reduce) { #start-screen .ts-light { transition: none; } }
    /* A landscape phone is ~390px tall: a smaller logo, a tighter column, a lower footer. */
    @media (max-height: 480px) {
      #start-screen .ts-logo { width: clamp(150px, 40vh, 220px); }
      #start-screen .ts-tag { font-size: 14px; margin-top: 2px; }
      #start-screen .ts-menu { margin-top: 6px; gap: 0; }
      #start-screen .ts-item { min-height: 40px; padding-block: 4px; }
      #start-screen .ts-item .v { font-size: 19px; }
      #start-screen .ts-link { min-height: 36px; padding: 4px 9px; font-size: 11px; }
      #start-screen .ts-lantern { width: 70px; height: 70px; margin: -35px 0 0 -35px; }
    }
  `;
  document.head.appendChild(st);
}

export function showStartScreen(opts: StartScreenOptions) {
  if (root) return;
  injectKitStyles();
  injectStyles();

  const r = document.createElement('div');
  r.id = 'start-screen';
  root = r;

  const light = document.createElement('div'); light.className = 'ts-light';
  const lantern = document.createElement('div'); lantern.className = 'ts-lantern';
  const spark = document.createElement('div'); spark.className = 'ts-spark';
  r.append(light, lantern, spark);

  const col = document.createElement('div');
  col.className = 'ts-col';
  r.appendChild(col);
  col.appendChild(Object.assign(document.createElement('div'), { className: 'ts-space' }));

  const logo = document.createElement('img');
  logo.className = 'ts-logo';
  logo.src = logoUrl;
  logo.alt = 'DELVE';
  logo.draggable = false;
  col.appendChild(logo);

  const tag = document.createElement('div');
  tag.className = 'ts-tag';
  tag.textContent = 'the dungeon does not remember your name.';
  col.appendChild(tag);

  // Lifetime record — only once the player has attempted a run.
  const meta = getMeta();
  if (meta.runsAttempted > 0) {
    const parts: string[] = [];
    if (meta.deepestDepth > 0) parts.push(`deepest ${meta.deepestDepth}`);
    parts.push(`${meta.runsAttempted} descent${meta.runsAttempted === 1 ? '' : 's'}`);
    const stat = document.createElement('div');
    stat.className = 'ts-stat';
    stat.textContent = parts.join(' · ');
    col.appendChild(stat);
  }

  // ── The verbs ──
  const menu = document.createElement('div');
  menu.className = 'ts-menu';
  col.appendChild(menu);

  const depthLabel = opts.saveDepth ? `depth ${opts.saveDepth}` : 'your descent';
  let armed = false;
  let armTimer = 0;
  let warnEl: HTMLSpanElement | null = null;
  const disarm = (): void => {
    armed = false;
    clearTimeout(armTimer);
    if (warnEl) { warnEl.textContent = `abandons ${depthLabel}`; warnEl.classList.remove('armed'); }
  };

  const begin = (fn: () => void): void => { disarm(); hide(); lockPointer(); fn(); };

  let first: HTMLElement | null = null;
  if (opts.hasSave) {
    first = menu.appendChild(makeItem('CONTINUE', opts.saveDepth ? `depth ${opts.saveDepth}` : '', () => begin(opts.onContinue)));
    const fresh = makeItem('NEW DESCENT', '', () => {
      if (!armed) {
        armed = true;
        if (warnEl) { warnEl.textContent = `abandon ${depthLabel}?`; warnEl.classList.add('armed'); }
        armTimer = window.setTimeout(disarm, ARM_MS);
        return;
      }
      begin(opts.onDescend);
    });
    fresh.dataset.arm = '';
    warnEl = fresh.querySelector('.s');
    if (warnEl) { warnEl.classList.add('warn'); warnEl.textContent = `abandons ${depthLabel}`; }
    menu.appendChild(fresh);
  } else {
    first = menu.appendChild(makeItem('DESCEND', '', () => begin(opts.onDescend)));
  }

  // ── The footer: everything else, quieter ──
  const foot = document.createElement('div');
  foot.className = 'ts-foot';
  const link = (label: string, act: () => void, badge = 0): void => { foot.appendChild(makeLink(label, act, badge)); };

  if (opts.onTutorial) link('TUTORIAL', () => { hide(); opts.onTutorial!(); });
  const stash = getStash();
  if (stash.length > 0) link('STASH', () => showStash(), stash.length);
  if (meta.enemiesSlain.length || meta.itemsFound.length || meta.notesRead.length) link('CODEX', () => showCodex());
  // STANDINGS — the deepest-descent leaderboard; fills in as others fall.
  link('STANDINGS', () => showLeaderboard());
  link('SETTINGS', () => openSettings());
  // CLAIM YOUR NAME — link an account so this delver's server identity survives
  // a lost device (docs/ALPHA-AND-BACKEND.md). Not a meta-save: that lives in
  // localStorage only.
  link('CLAIM YOUR NAME', () => { void startAccountUpgrade(); });
  // DISPATCHES — the patch log.
  link('DISPATCHES', () => showPatchlog());
  // COMMUNITY — hidden until COMMUNITY_URL is set (src/links.ts).
  if (hasCommunityLink()) link(COMMUNITY_LABEL, () => openCommunityLink());
  // Testing tools — DEVELOPER MODE only.
  const devMode = getSettings().developerMode;
  if (devMode && opts.onTestChambers) link('TEST', () => { hide(); opts.onTestChambers!(); });
  if (devMode && opts.onProvingGrounds) link('PROVING', () => { hide(); opts.onProvingGrounds!(); });
  col.appendChild(foot);

  document.body.appendChild(r);

  // ── One light: the lantern lights what you choose ──
  let lit = false;
  const place = (el: HTMLElement | null, animate: boolean): void => {
    if (!el || !root) return;
    const rr = r.getBoundingClientRect(), er = el.getBoundingClientRect(), lr = logo.getBoundingClientRect();
    const tx = er.left - rr.left + Math.min(er.width / 2, 140), ty = er.top - rr.top + er.height / 2;
    light.style.left = `${tx}px`; light.style.top = `${ty}px`;
    if (!lr.width) return;
    const lx = lr.left - rr.left + lr.width * LANTERN.x, ly = lr.top - rr.top + lr.height * LANTERN.y;
    lantern.style.left = `${lx}px`; lantern.style.top = `${ly}px`;
    if (!animate || reduceMotion() || typeof spark.animate !== 'function') return;
    spark.animate([
      { transform: `translate(${lx}px, ${ly}px)`, opacity: 0 },
      { transform: `translate(${lx}px, ${ly + 16}px)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${er.left - rr.left + 24}px, ${ty - er.height * 0.4}px)`, opacity: 0 },
    ], { duration: 560, easing: 'cubic-bezier(.5, 0, .7, 1)' });
    lantern.animate([{ opacity: 0.45 }, { opacity: 1 }, { opacity: 0.5 }], { duration: 720, easing: 'ease-out' });
  };

  scope = createFocusScope(r, {
    initial: first,
    isActive: () => topScreenId() === SCREEN_ID,
    onFocus: (el) => { if (el.dataset.arm === undefined) disarm(); place(el, lit); },
    onConfirm: (el) => (el as HTMLElement & { _act?: () => void })._act?.(),
  });
  unbindPrompts = bindPrompts(r);
  onResize = () => place(scope?.focused ?? null, false);
  window.addEventListener('resize', onResize);
  logo.addEventListener('load', () => place(scope?.focused ?? null, false));

  // Title screen: highest priority, hides the HUD, the live bonfire vignette
  // shows behind (no dim, no shared backdrop). A on a controller confirms here.
  openScreen({
    id: SCREEN_ID,
    onForceClose: () => hide(),
    onConfirm: () => { if (topScreenId() === SCREEN_ID) scope?.confirm(); },
    root: r,
    policy: {
      pausesWorld: true,
      hidesHud: true,
      dimsScene: false,
      needsBackdrop: false,
      layer: 'title',
    },
  });

  requestAnimationFrame(() => {
    if (!root) return;
    r.style.opacity = '1';
    r.classList.add('shown');
    place(scope?.focused ?? null, false);
    // The spark only falls once the screen has arrived, not for the first focus.
    setTimeout(() => { lit = true; }, 600);
  });
}

type Actionable = HTMLButtonElement & { _act?: () => void };

/** Wire one action to every way of taking it. Touch and mouse act on the press
 *  (it reads faster than click on a phone); keys and controller come through
 *  the focus scope's confirm, which calls the same _act. */
function wire(b: Actionable, act: () => void): void {
  b._act = act;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') noteKeyboardMouseActivity(); else noteTouchActivity();
    scope?.setFocus(b);
    act();
  });
  // keyboard activation of a focused native button is handled by the scope
  b.addEventListener('click', (e) => e.preventDefault());
}

function makeItem(label: string, note: string, act: () => void): Actionable {
  const b = document.createElement('button') as Actionable;
  b.className = 'ts-item';
  b.dataset.focus = '';
  b.type = 'button';
  b.innerHTML = `<span class="v"></span><span class="s"></span><span class="ts-key" data-key="confirm"></span>`;
  (b.querySelector('.v') as HTMLElement).textContent = label;
  (b.querySelector('.s') as HTMLElement).textContent = note;
  wire(b, act);
  return b;
}

function makeLink(label: string, act: () => void, badge: number): Actionable {
  const b = document.createElement('button') as Actionable;
  b.className = 'ts-link';
  b.dataset.focus = '';
  b.type = 'button';
  b.textContent = label;
  if (badge > 0) {
    const dot = document.createElement('span');
    dot.className = 'badge';
    dot.textContent = String(badge);
    b.appendChild(dot);
  }
  wire(b, act);
  return b;
}

function hide() {
  if (!root) return;
  const r = root;
  root = null;
  scope?.destroy(); scope = null;
  unbindPrompts?.(); unbindPrompts = null;
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 500);
  closeScreen(SCREEN_ID);
}
