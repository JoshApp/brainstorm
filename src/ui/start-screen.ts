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
import { getMeta, getStash } from '../state/meta-state';
import { showCodex } from './codex-screen';
import { showStash } from './stash-screen';

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
}

let root: HTMLDivElement | null = null;

export function showStartScreen(opts: StartScreenOptions) {
  if (root) return;

  root = document.createElement('div');
  root.id = 'start-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    background: 'radial-gradient(ellipse at center, rgba(28, 18, 10, 1) 0%, rgba(6, 4, 2, 1) 70%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    // z-index managed by the screen manager via policy.layer = 'title'.
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.9)',
    pointerEvents: 'auto',
    opacity: '0',
    transition: 'opacity 0.6s ease',
  } as Partial<CSSStyleDeclaration>);

  // Animated subtle vignette behind everything — a flicker of warm light
  // pulsing slowly, like a distant torch you're walking toward.
  const flicker = document.createElement('div');
  Object.assign(flicker.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '600px',
    height: '600px',
    transform: 'translate(-50%, -50%)',
    background: 'radial-gradient(circle, rgba(255, 140, 60, 0.10) 0%, transparent 60%)',
    pointerEvents: 'none',
    animation: 'startFlicker 4.2s ease-in-out infinite',
  });
  root.appendChild(flicker);

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

  // Big title.
  const title = document.createElement('div');
  title.textContent = 'DELVE';
  Object.assign(title.style, {
    fontSize: 'clamp(54px, 12vw, 84px)',
    letterSpacing: '0.18em',
    color: 'rgba(230, 170, 90, 1)',
    textShadow: '0 0 24px rgba(255, 140, 60, 0.45), 0 2px 0 rgba(0,0,0,0.8)',
    fontWeight: '500',
    position: 'relative',
    zIndex: '1',
    animation: 'startTitleIn 1.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards',
  });
  root.appendChild(title);

  // Subtitle — atmospheric, lowercase, italic.
  const sub = document.createElement('div');
  sub.textContent = 'the dungeon does not remember your name.';
  Object.assign(sub.style, {
    fontSize: 'clamp(11px, 2.4vw, 14px)',
    fontStyle: 'italic',
    color: 'rgba(180, 140, 100, 0.65)',
    letterSpacing: '0.06em',
    marginTop: '-4px',
    marginBottom: '22px',
    position: 'relative',
    zIndex: '1',
  });
  root.appendChild(sub);

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
    alignItems: 'center',
    gap: '10px',
    position: 'relative',
    zIndex: '1',
  });

  // DESCEND — primary action.
  const descend = makePill('DESCEND', 'begin a fresh run', true);
  descend.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hide();
    opts.onDescend();
  });
  buttons.appendChild(descend);

  // CONTINUE — only if save exists.
  if (opts.hasSave) {
    const sub2 = opts.saveDepth ? `resume at depth ${opts.saveDepth}` : 'resume previous run';
    const cont = makePill('CONTINUE', sub2, false);
    cont.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      opts.onContinue();
    });
    buttons.appendChild(cont);
  }

  root.appendChild(buttons);

  // SECONDARY ACTIONS — STASH + CODEX. In the flex-column flow under
  // the primary buttons (no absolute positioning — that was overlapping
  // the buttons on shorter viewports). Smaller font, fainter colour, so
  // they read as secondary without crowding DESCEND.
  const links = document.createElement('div');
  Object.assign(links.style, {
    display: 'flex',
    gap: '32px',
    marginTop: '26px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.28em',
    position: 'relative',
    zIndex: '1',
  } as Partial<CSSStyleDeclaration>);

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
    links.appendChild(link);
  }

  if (opts.onTestChambers) {
    const link = makeSecondaryLink('TEST', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide();
      opts.onTestChambers!();
    });
    links.appendChild(link);
  }

  const stash = getStash();
  if (stash.length > 0) {
    const link = makeSecondaryLink('STASH', stash.length);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showStash();
    });
    links.appendChild(link);
  }
  if (meta.enemiesSlain.length || meta.itemsFound.length || meta.notesRead.length) {
    const link = makeSecondaryLink('CODEX', 0);
    link.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      showCodex();
    });
    links.appendChild(link);
  }
  if (links.childElementCount > 0) root.appendChild(links);

  document.body.appendChild(root);

  // Title screen: highest priority screen, hides the gameplay HUD,
  // dims the WebGL scene, brings its OWN background (no shared backdrop).
  openScreen({
    id: SCREEN_ID,
    root,
    policy: {
      pausesWorld: true,
      hidesHud: true,
      dimsScene: true,
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
    padding: '12px 32px',
    minWidth: '180px',
    borderRadius: '36px',
    border: primary
      ? '1px solid rgba(255, 190, 120, 0.6)'
      : '1px solid rgba(150, 110, 70, 0.4)',
    background: primary
      ? 'linear-gradient(180deg, rgba(80, 42, 22, 0.85), rgba(50, 24, 10, 0.85))'
      : 'rgba(30, 22, 16, 0.6)',
    color: primary ? 'rgba(255, 230, 200, 0.98)' : 'rgba(200, 170, 140, 0.85)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    transition: 'transform 0.08s ease, background 0.15s ease, box-shadow 0.2s ease',
    boxShadow: primary
      ? '0 0 26px rgba(255, 150, 60, 0.28), 0 2px 8px rgba(0,0,0,0.6)'
      : '0 2px 8px rgba(0,0,0,0.5)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  });

  const main = document.createElement('div');
  main.textContent = label;
  Object.assign(main.style, {
    fontSize: '18px',
    fontWeight: '600',
    letterSpacing: '0.24em',
  });
  b.appendChild(main);

  const sub = document.createElement('div');
  sub.textContent = hint;
  Object.assign(sub.style, {
    fontSize: '10px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(220, 190, 160, 0.55)',
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
    gap: '6px',
    padding: '6px 4px',
    background: 'transparent',
    border: 'none',
    color: 'rgba(200, 170, 140, 0.65)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.28em',
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
  b.addEventListener('pointerleave', () => { b.style.color = 'rgba(200, 170, 140, 0.65)'; });
  return b;
}

function hide() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 500);
  closeScreen(SCREEN_ID);
}
