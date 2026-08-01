// Title / start screen. First thing the player sees on a fresh load.
//
// Two actions:
//   DESCEND  — primary, always present. Wipes any save, starts a fresh run.
//   CONTINUE — only if a save exists. Resumes at the saved floor.
//
// Visually: full-screen black, big serif title in dungeon-amber, italic
// subtitle, then the two action pills. Tone matches in-world voice —
// no sponsor energy, no fanfare.

import { openScreen, closeScreen } from './screen-manager';
import { createSheet, menuButton } from './menu-shell';
import { getMeta, getStash } from '../state/meta-state';
import { getSettings } from '../settings/settings';
import { THEME, FONT_DISPLAY, FONT_TITLE, carvedRule, applyCarvedFrame } from './theme';
import { showCodex } from './codex-screen';
import { showStash } from './stash-screen';
import { showPatchlog } from './patchlog-screen';
import { showLeaderboard } from './leaderboard-screen';
import { startAccountUpgrade } from '../net/account-link';
import { hasCommunityLink, openCommunityLink, COMMUNITY_LABEL } from '../links';

const SCREEN_ID = 'start';

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

/** Desktop: capture the mouse for first-person look the moment the
 *  player enters the game — the pointerdown is a user gesture, so the
 *  lock is permitted. No-op on touch. */
function lockPointer(): void {
  try { (document.querySelector('canvas') as HTMLCanvasElement | null)?.requestPointerLock?.(); } catch { /* touch / denied */ }
}

export function showStartScreen(opts: StartScreenOptions) {
  if (root) return;

  root = document.createElement('div');
  root.id = 'start-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    // LEFT scrim only — the live bonfire vignette renders behind (main.ts mounts
    // it), so the right stays transparent to show the fire; the left is darkened
    // for menu legibility. Fades to clear by ~78% across.
    background: 'linear-gradient(90deg, rgba(8,5,3,0.94) 0%, rgba(8,5,3,0.72) 34%, rgba(8,5,3,0.28) 60%, rgba(8,5,3,0) 80%)',
    display: 'flex',
    flexDirection: 'column',
    // LEFT-anchored menu (mobile-first; the dark + fire live on the right, where
    // the live vignette scene will go later). The flex spacers still centre the
    // column vertically; alignItems hugs it to the left margin.
    alignItems: 'flex-start',
    gap: '14px',
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    paddingLeft: 'calc(env(safe-area-inset-left, 0px) + clamp(26px, 6vw, 78px))',
    paddingRight: 'env(safe-area-inset-right, 0px)',
    // Reserve room for the FIXED bottom-left footer (secondary links) so the last
    // action pill can never crowd or hide under it on a short landscape phone —
    // the "cramped on mobile" report. ~46px = footer row + its bottom offset.
    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 46px)',
    // z-index managed by the screen manager via policy.layer = 'title'.
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.9)',
    pointerEvents: 'auto',
    opacity: '0',
    transition: 'opacity 0.6s ease',
  } as Partial<CSSStyleDeclaration>);

  // Top spacer — grows to vertically centre the content when it fits,
  // collapses to its min (clearing the top safe-area) when content is
  // tall enough to scroll, keeping the title reachable from the top.
  const spacerTop = document.createElement('div');
  spacerTop.style.flex = '1 0 calc(20px + env(safe-area-inset-top, 0px))';
  root.appendChild(spacerTop);

  // (The warm glow is now the REAL bonfire vignette rendering behind this overlay
  // — main.ts mounts it at the title. No DOM flicker needed.)

  // Inject keyframes once.
  if (!document.getElementById('start-screen-keyframes')) {
    const style = document.createElement('style');
    style.id = 'start-screen-keyframes';
    style.textContent = `
      @keyframes startFlicker {
        0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
        50%      { opacity: 0.7; transform: translate(-50%, -50%) scale(1.06); }
      }
      @keyframes startTitleIn {
        from { letter-spacing: 0.6em; opacity: 0; }
        to   { letter-spacing: 0.18em; opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Masthead — the COVER SLAB of the carved object ───────────────────
  // Title + descent sigil + subtitle, wrapped in the same carved frame
  // (corner ticks + hot ember edge) the panels wear, so the title screen
  // reads as page one of one object rather than a separate screen.
  const masthead = document.createElement('div');
  Object.assign(masthead.style, {
    position: 'relative',
    zIndex: '1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'clamp(2px, 1vh, 8px)',
    padding: 'clamp(6px, 1.5vh, 18px) clamp(20px, 4vw, 34px)',
    marginBottom: 'clamp(6px, 1.8vh, 18px)',
  } as Partial<CSSStyleDeclaration>);

  // Descent sigil — a thin engraved double-chevron pointing DOWN: "the way
  // down." Faint amber, faint torch-glow, so it reads as a maker's mark
  // chiselled above the name.
  const sigil = document.createElement('div');
  sigil.innerHTML = `
    <svg width="40" height="20" viewBox="0 0 40 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 3 L20 13 L36 3" stroke="${THEME.tick}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9 9 L20 16 L31 9" stroke="${THEME.tick}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
    </svg>`;
  Object.assign(sigil.style, {
    lineHeight: '0',
    opacity: '0.75',
    filter: 'drop-shadow(0 0 6px rgba(255, 140, 60, 0.35))',
  } as Partial<CSSStyleDeclaration>);
  masthead.appendChild(sigil);

  // Big title — serif, amber, lit from the torch-glow behind it. The
  // text-shadow stack gives it dimension: a warm top edge, a dark lower lip,
  // and the soft ember bloom — form revealed by light out of black.
  const title = document.createElement('div');
  title.textContent = 'DELVE';
  Object.assign(title.style, {
    fontFamily: FONT_TITLE, // Cinzel — monumental engraved caps for the masthead
    // Height-AWARE: on a short landscape phone the masthead was crowding the
    // action pills, so cap tighter by height (13vh) — wide screens still get
    // 12vw up to 72px. Keeps DELVE monumental without eating the buttons' room.
    fontSize: 'clamp(30px, min(12vw, 13vh), 72px)',
    letterSpacing: '0.16em',
    color: 'rgba(232, 174, 96, 1)',
    textShadow: [
      '0 1px 0 rgba(255, 226, 180, 0.22)',   // lit top edge
      '0 2px 1px rgba(0, 0, 0, 0.85)',       // carved lower lip
      '0 0 30px rgba(255, 140, 60, 0.5)',    // torch bloom
    ].join(', '),
    fontWeight: '500',
    animation: 'startTitleIn 1.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards',
  });
  masthead.appendChild(title);

  // Subtitle — atmospheric, lowercase, italic.
  const sub = document.createElement('div');
  sub.textContent = 'the dungeon does not remember your name.';
  Object.assign(sub.style, {
    fontSize: 'clamp(11px, 2.4vw, 14px)',
    fontStyle: 'italic',
    color: 'rgba(180, 140, 100, 0.65)',
    letterSpacing: '0.06em',
    marginTop: '2px',
  });
  masthead.appendChild(sub);

  applyCarvedFrame(masthead, { tickSize: 16, inset: 0 });
  root.appendChild(masthead);

  // Lifetime records line — only renders if the player has actually
  // attempted a run before. Subtle, italic, small caps. The "you've
  // been here before" tease.
  const meta = getMeta();
  if (meta.runsAttempted > 0) {
    const records = document.createElement('div');
    Object.assign(records.style, {
      fontSize: '10px',
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
      color: 'rgba(180, 140, 100, 0.5)',
      fontFamily: 'system-ui, sans-serif',
      marginTop: '-12px',
      marginBottom: '16px',
      position: 'relative',
      zIndex: '1',
    });
    const parts: string[] = [];
    if (meta.deepestDepth > 0) parts.push(`deepest · ${meta.deepestDepth}`);
    parts.push(`${meta.runsAttempted} descent${meta.runsAttempted === 1 ? '' : 's'}`);
    records.textContent = parts.join('   ·   ');
    root.appendChild(records);
  }

  // Buttons row.
  const buttons = document.createElement('div');
  Object.assign(buttons.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '10px',
    position: 'relative',
    zIndex: '1',
  });

  if (opts.hasSave) {
    // A run is live → CONTINUE is the hero; starting anew is a MUTED,
    // CONFIRM-GATED action (DESCEND wipes the save — was a footgun as the
    // big primary button).
    const sub2 = opts.saveDepth ? `resume at depth ${opts.saveDepth}` : 'resume previous run';
    const cont = makePill('CONTINUE', sub2, true);
    cont.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      lockPointer();
      opts.onContinue();
    });
    buttons.appendChild(cont);

    const fresh = makePill('NEW RUN', 'abandons your descent', false);
    fresh.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      confirmAbandon(opts.saveDepth, () => { hide();
      lockPointer(); opts.onDescend(); });
    });
    buttons.appendChild(fresh);
  } else {
    // No save → DESCEND is the primary (nothing to lose, no confirm).
    const descend = makePill('DESCEND', 'begin a fresh run', true);
    descend.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      lockPointer();
      opts.onDescend();
    });
    buttons.appendChild(descend);
  }

  root.appendChild(buttons);

  // SECONDARY ACTIONS — STASH + CODEX. In the flex-column flow under
  // the primary buttons (no absolute positioning — that was overlapping
  // the buttons on shorter viewports). Smaller font, fainter colour, so
  // they read as secondary without crowding DESCEND.
  const links = document.createElement('div');
  Object.assign(links.style, {
    // The secondary cluster lives as a BOTTOM-LEFT footer (out of the centred
    // column) so it can never push DESCEND off a short landscape phone. Spans to
    // the right edge so it wraps into few rows.
    position: 'fixed',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
    left: 'calc(env(safe-area-inset-left, 0px) + clamp(26px, 6vw, 78px))',
    right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: '2px 4px',              // tight — faint dot separators carry the spacing
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '10px',
    letterSpacing: '0.22em',
    zIndex: '2',
  } as Partial<CSSStyleDeclaration>);

  // Append a link with a faint "·" separator before it (except the first)
  // so the footer reads as one compact de-emphasized row.
  const pushLink = (link: HTMLButtonElement) => {
    if (links.childElementCount > 0) {
      const sep = document.createElement('span');
      sep.textContent = '·';
      Object.assign(sep.style, {
        color: 'rgba(150, 110, 70, 0.4)',
        fontSize: '11px',
        pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>);
      links.appendChild(sep);
    }
    links.appendChild(link);
  };

  // TUTORIAL — small text link, always available. Returning players
  // can revisit the antechamber if they want to refresh the loop or
  // show someone the controls without resetting their save.
  if (opts.onTutorial) {
    const link = makeSecondaryLink('TUTORIAL', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      opts.onTutorial!();
    });
    pushLink(link);
  }

  const stash = getStash();
  if (stash.length > 0) {
    const link = makeSecondaryLink('STASH', stash.length);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showStash();
    });
    pushLink(link);
  }
  if (meta.enemiesSlain.length || meta.itemsFound.length || meta.notesRead.length) {
    const link = makeSecondaryLink('CODEX', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showCodex();
    });
    pushLink(link);
  }
  // STANDINGS — the deepest-descent leaderboard (async multiplayer). Always
  // available; reads the shared death table, so it fills in as others fall.
  {
    const link = makeSecondaryLink('STANDINGS', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showLeaderboard();
    });
    pushLink(link);
  }
  // SAVE PROGRESS — link an account (Google / Discord / Twitch) so this
  // delver survives a lost device. The 2-tap upgrade; merges onto the
  // current player. See docs/ALPHA-AND-BACKEND.md.
  {
    const link = makeSecondaryLink('SAVE PROGRESS', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      void startAccountUpgrade();
    });
    pushLink(link);
  }
  // DISPATCHES — the patch log. Always available; it's the public
  // record of what's changed. Factual now; the announcer voice is a
  // later view over the same data.
  {
    const link = makeSecondaryLink('DISPATCHES', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showPatchlog();
    });
    pushLink(link);
  }
  // COMMUNITY — built in public: the Discord where suggestions become commits.
  // Hidden until COMMUNITY_URL is set (src/links.ts), so no dead link ever ships.
  if (hasCommunityLink()) {
    const link = makeSecondaryLink(COMMUNITY_LABEL, 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      openCommunityLink();
    });
    pushLink(link);
  }

  // Testing tools last — TEST (hand-authored feature chambers) and PROVING
  // (generate a floor around any weapon / mob / boss / event). Grouped at the
  // end so the player-facing records read first. DEVELOPER MODE only — the
  // player build never sees them (the callbacks are wired in dev, but the gate
  // keeps the title clean unless dev mode is on).
  const devMode = getSettings().developerMode;
  if (devMode && opts.onTestChambers) {
    const link = makeSecondaryLink('TEST', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      opts.onTestChambers!();
    });
    pushLink(link);
  }
  if (devMode && opts.onProvingGrounds) {
    const link = makeSecondaryLink('PROVING', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      opts.onProvingGrounds!();
    });
    pushLink(link);
  }

  if (links.childElementCount > 0) root.appendChild(links);

  // Bottom spacer — balances spacerTop so content centres when it fits.
  const spacerBottom = document.createElement('div');
  // Tall enough to clear the fixed bottom-left links footer so the centred column never overlaps it.
  spacerBottom.style.flex = '1 0 calc(58px + env(safe-area-inset-bottom, 0px))';
  root.appendChild(spacerBottom);

  document.body.appendChild(root);

  // Title screen: highest priority screen, hides the gameplay HUD,
  // dims the WebGL scene, brings its OWN background (no shared backdrop).
  openScreen({
    id: SCREEN_ID,
    root,
    policy: {
      pausesWorld: true,
      hidesHud: true,
      dimsScene: false,   // show the live bonfire vignette behind the menu
      needsBackdrop: false,
      layer: 'title',
    },
  });

  // Fade in next frame.
  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
  });
}

function makePill(label: string, hint: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  Object.assign(b.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    // Hero vs secondary: DESCEND is bigger, glows, dominates; CONTINUE is
    // a slim muted pill clearly beneath it.
    padding: primary ? '15px 44px' : '9px 26px',
    minWidth: primary ? '220px' : '160px',
    minHeight: '44px',
    borderRadius: '36px',
    border: primary
      ? '1px solid rgba(255, 190, 120, 0.65)'
      : '1px solid rgba(150, 110, 70, 0.35)',
    background: primary
      ? 'linear-gradient(180deg, rgba(86, 46, 24, 0.9), rgba(52, 26, 11, 0.9))'
      : 'rgba(30, 22, 16, 0.5)',
    color: primary ? 'rgba(255, 232, 202, 0.98)' : 'rgba(200, 170, 140, 0.8)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    transition: 'transform 0.08s ease, background 0.15s ease, box-shadow 0.2s ease',
    boxShadow: primary
      ? '0 0 30px rgba(255, 150, 60, 0.32), 0 2px 10px rgba(0,0,0,0.6)'
      : '0 2px 6px rgba(0,0,0,0.4)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  });

  const main = document.createElement('div');
  main.textContent = label;
  Object.assign(main.style, {
    fontSize: primary ? '21px' : '14px',
    fontWeight: primary ? '700' : '600',
    letterSpacing: primary ? '0.26em' : '0.20em',
  });
  b.appendChild(main);

  const sub = document.createElement('div');
  sub.textContent = hint;
  Object.assign(sub.style, {
    fontSize: primary ? '10px' : '9px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(220, 190, 160, 0.5)',
  });
  b.appendChild(sub);

  // Press feedback.
  b.addEventListener('pointerdown', () => { b.style.transform = 'scale(0.96)'; });
  b.addEventListener('pointerup',   () => { b.style.transform = 'scale(1)'; });
  b.addEventListener('pointerleave',() => { b.style.transform = 'scale(1)'; });

  return b;
}

function makeSecondaryLink(label: string, badge: number): HTMLButtonElement {
  const b = document.createElement('button');
  Object.assign(b.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '44px',          // touch target (was a ~20px-tall text link)
    padding: '6px 8px',
    background: 'transparent',
    border: 'none',
    color: 'rgba(190, 160, 130, 0.55)',   // fainter — clearly subordinate to DESCEND
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '10px',
    fontWeight: '500',
    letterSpacing: '0.16em',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    transition: 'color 0.15s ease',
  } as Partial<CSSStyleDeclaration>);
  b.textContent = label;
  if (badge > 0) {
    const dot = document.createElement('span');
    dot.textContent = String(badge);
    Object.assign(dot.style, {
      display: 'inline-block',
      minWidth: '16px',
      height: '16px',
      lineHeight: '14px',
      padding: '0 4px',
      borderRadius: '8px',
      background: 'rgba(255, 150, 70, 0.85)',
      color: 'rgba(20, 8, 4, 0.95)',
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0',
      textAlign: 'center',
    });
    b.appendChild(dot);
  }
  b.addEventListener('pointerenter', () => { b.style.color = 'rgba(255, 220, 180, 0.95)'; });
  b.addEventListener('pointerleave', () => { b.style.color = 'rgba(190, 160, 130, 0.55)'; });
  return b;
}

/** Confirm before abandoning a live run (DESCEND wipes the save). The
 *  SAFE choice (keep) is the prominent button; abandon is muted. Built on
 *  the menu shell so it's dismissable (✕ / backdrop = cancel) and frees
 *  the cursor on PC. */
function confirmAbandon(depth: number | undefined, onConfirm: () => void) {
  const sheet = createSheet({
    id: 'abandon-confirm',
    title: 'ABANDON RUN?',
    width: 440,
    layer: 'title',   // above the start screen (both 'title'; later stacks on top)
  });
  const msg = document.createElement('div');
  msg.textContent = depth
    ? `Your descent reached depth ${depth}. To begin anew is to leave it behind — the dungeon keeps what it took.`
    : 'To begin anew is to leave your current descent behind — there is no returning to it.';
  Object.assign(msg.style, {
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    fontStyle: 'italic',
    fontSize: '14px',
    lineHeight: '1.55',
    color: 'rgba(205, 175, 140, 0.85)',
    textAlign: 'center',
    padding: '4px 2px',
  } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(msg);

  const abandon = menuButton('ABANDON', () => { sheet.close(); onConfirm(); });
  const keep = menuButton('KEEP DESCENDING', () => sheet.close(), { primary: true });
  sheet.footer.append(abandon, keep);
  sheet.open();
}

function hide() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 500);
  closeScreen(SCREEN_ID);
}
