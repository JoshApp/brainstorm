// End-of-run recap. Shows after the death sequence (slow-mo + vignette +
// initial epitaph) completes. Brief stats + a single action to start over.
//
// In-world voice — terse, no celebration, no "good job!" The epitaph
// stays the headline; stats are quiet metadata.

import { openScreen, closeScreen } from './screen-manager';

const SCREEN_ID = 'end';

export interface EndScreenStats {
  depth: number;
  kills: number;
  itemsFound: number;
  elapsed: string;  // pre-formatted "M:SS"
  epitaph: string;  // the in-world goodbye
}

let root: HTMLDivElement | null = null;

export function showEndScreen(stats: EndScreenStats, onRiseAgain: () => void) {
  if (root) return;

  root = document.createElement('div');
  root.id = 'end-screen';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    background: 'linear-gradient(180deg, rgba(0,0,0,0.94) 0%, rgba(10, 4, 2, 0.97) 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '22px',
    // z-index managed by the screen manager via policy.layer = 'title'.
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.9)',
    pointerEvents: 'auto',
    opacity: '0',
    transition: 'opacity 1.0s ease',
    padding: '0 20px',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);

  // Epitaph — the death message in italic, the visual anchor.
  const epi = document.createElement('div');
  epi.textContent = stats.epitaph;
  Object.assign(epi.style, {
    fontSize: 'clamp(18px, 4.5vw, 26px)',
    fontStyle: 'italic',
    color: 'rgba(230, 190, 150, 0.92)',
    letterSpacing: '0.08em',
    maxWidth: '560px',
    lineHeight: '1.4',
    textShadow: '0 0 18px rgba(140, 30, 20, 0.4)',
  });
  root.appendChild(epi);

  // Faint divider.
  const rule = document.createElement('div');
  Object.assign(rule.style, {
    width: '50px',
    height: '1px',
    background: 'rgba(180, 140, 90, 0.4)',
    margin: '6px 0',
  });
  root.appendChild(rule);

  // Stats grid — 2×2 small rows. Tight, restrained, the kind of thing
  // a clerk would note down without ceremony.
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    gap: '4px 24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    letterSpacing: '0.18em',
    color: 'rgba(180, 150, 120, 0.75)',
  });
  addStatRow(grid, 'DEPTH',  String(stats.depth));
  addStatRow(grid, 'KILLS',  String(stats.kills));
  addStatRow(grid, 'FOUND',  String(stats.itemsFound));
  addStatRow(grid, 'TIME',   stats.elapsed);
  root.appendChild(grid);

  // The single action.
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    marginTop: '8px',
    padding: '12px 36px',
    minWidth: '200px',
    borderRadius: '36px',
    border: '1px solid rgba(255, 190, 120, 0.55)',
    background: 'linear-gradient(180deg, rgba(80, 42, 22, 0.85), rgba(50, 24, 10, 0.85))',
    color: 'rgba(255, 230, 200, 0.98)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '17px',
    fontWeight: '600',
    letterSpacing: '0.26em',
    cursor: 'pointer',
    boxShadow: '0 0 24px rgba(255, 150, 60, 0.28), 0 2px 8px rgba(0,0,0,0.6)',
    transition: 'transform 0.08s ease',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  });
  btn.textContent = 'RISE AGAIN';
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.style.transform = 'scale(0.96)';
  });
  btn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    btn.style.transform = 'scale(1)';
    onRiseAgain();
  });
  btn.addEventListener('pointerleave', () => { btn.style.transform = 'scale(1)'; });
  root.appendChild(btn);

  document.body.appendChild(root);
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
  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
  });
}

function addStatRow(grid: HTMLElement, label: string, value: string) {
  const l = document.createElement('div');
  l.textContent = label;
  Object.assign(l.style, {
    textAlign: 'right',
    color: 'rgba(150, 120, 90, 0.75)',
  });
  grid.appendChild(l);

  const v = document.createElement('div');
  v.textContent = value;
  Object.assign(v.style, {
    textAlign: 'left',
    color: 'rgba(230, 200, 170, 0.95)',
    letterSpacing: '0.1em',
    fontWeight: '500',
  });
  grid.appendChild(v);
}

export function hideEndScreen() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 500);
  closeScreen(SCREEN_ID);
}
