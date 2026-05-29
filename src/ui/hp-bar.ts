import { hpStore, type HpState } from '../state/hud-stores';
import { bind } from './hud';

// Segmented HP indicator at the bottom-center of the screen. One pip per HP
// point so the player can see exactly how many hits they have left, the way
// Resident Evil / Souls health bars work — discrete, readable at a glance.
// Pips fade when lost rather than disappearing, so the maximum is always
// visible. Warm orange palette matches the dungeon's torchlight.
//
// Data flow: bound to hpStore (synced once per frame). The render only runs
// when hp/max actually change, so there's no per-frame DOM churn and no
// hand-kept lastHp/lastMax cache to drift.

let container: HTMLDivElement | null = null;
let pips: HTMLDivElement[] = [];
let builtMax = -1;

const PIP_W = 36;
const PIP_H = 12;
const PIP_GAP = 5;

export function createHpBar() {
  if (container) return;
  container = document.createElement('div');
  container.id = 'hp-bar';
  Object.assign(container.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: `${PIP_GAP}px`,
    zIndex: '10',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(container);

  bind(hpStore, render);
}

function render({ hp, max }: HpState) {
  if (!container) return;

  // Rebuild pip elements when max HP changes (startup or a stat change).
  if (max !== builtMax) {
    container.replaceChildren();
    pips = [];
    for (let i = 0; i < max; i++) {
      const p = document.createElement('div');
      Object.assign(p.style, {
        width: `${PIP_W}px`,
        height: `${PIP_H}px`,
        borderRadius: '2px',
        border: '1px solid rgba(255, 180, 110, 0.45)',
        background: 'rgba(0, 0, 0, 0.4)',
        boxShadow: 'inset 0 0 4px rgba(0,0,0,0.7)',
        transition: 'background 0.18s ease-out, box-shadow 0.18s ease-out',
      } as Partial<CSSStyleDeclaration>);
      container.appendChild(p);
      pips.push(p);
    }
    builtMax = max;
  }

  for (let i = 0; i < pips.length; i++) {
    const filled = i < hp;
    pips[i].style.background = filled
      ? 'linear-gradient(180deg, rgba(255, 140, 70, 0.95), rgba(200, 60, 30, 0.95))'
      : 'rgba(20, 10, 6, 0.45)';
    pips[i].style.boxShadow = filled
      ? 'inset 0 0 4px rgba(0,0,0,0.6), 0 0 8px rgba(255, 100, 40, 0.35)'
      : 'inset 0 0 4px rgba(0,0,0,0.7)';
  }
}
