// Title / start screen. First thing the player sees on a fresh load.
//
// Two actions:
//   DESCEND  — primary, always present. Wipes any save, starts a fresh run.
//   CONTINUE — only if a save exists. Resumes at the saved floor.
//
// Visually: full-screen black, big serif title in dungeon-amber, italic
// subtitle, then the two action pills. Tone matches in-world voice —
// no sponsor energy, no fanfare.

export interface StartScreenOptions {
  hasSave: boolean;
  saveDepth?: number;
  onDescend: () => void;
  onContinue: () => void;
}

let root: HTMLDivElement | null = null;

export function showStartScreen(opts: StartScreenOptions) {
  if (root) return;
  document.body.classList.add('hud-hidden');

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
    zIndex: '9000',
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
  document.body.appendChild(root);

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

function hide() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 500);
  document.body.classList.remove('hud-hidden');
}
