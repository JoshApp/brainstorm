import { staminaStore, type StaminaState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { bind } from './hud';

// MINIMAL-style stamina indicator — a thin GREEN bar sitting just
// above the hearts row at the bottom-centre. Replaces the original
// crosshair arc (too busy in the middle of the action). Green to keep
// it distinct from the amber Classic bar and the red heart row.
//
//   - Idle (rested + full): hidden.
//   - Spending: depletes RIGHT-to-LEFT so the leading edge tracks
//     toward empty (matches the heart-row read).
//   - Exhausted: tints red and holds visible until refilled.
//
// Cheap: one container + one fill div. Only the fill's transform
// updates per state change.

const BAR_W = 220;
const BAR_H = 4;

let root: HTMLDivElement | null = null;
let fill: HTMLDivElement | null = null;
let unsubStyle: (() => void) | null = null;

export function createStaminaArc(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'stamina-line';
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    // Sit just above the heart row. Hearts: bottom 14px + 28px tall +
    // a small gap.
    bottom: `calc(50px + env(safe-area-inset-bottom, 0px))`,
    transform: 'translateX(-50%)',
    width: `${BAR_W}px`,
    height: `${BAR_H}px`,
    borderRadius: '2px',
    background: 'rgba(8, 16, 12, 0.55)',
    border: '1px solid rgba(120, 180, 140, 0.28)',
    boxShadow: 'inset 0 0 3px rgba(0,0,0,0.7)',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '10',
    opacity: '0',
    transition: 'opacity 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    transformOrigin: 'left center',
    background: 'linear-gradient(180deg, rgba(150, 220, 160, 0.92), rgba(60, 140, 90, 0.92))',
    boxShadow: '0 0 5px rgba(140, 220, 160, 0.45)',
    transition: 'transform 140ms ease-out, background 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(fill);

  // ── Segment dividers (matches the Classic bar's split) ─────────────
  // Continuous fill, three pips' worth of visual budget. Dodge / ranged
  // = one segment; heavy = half a segment.
  for (const x of [33.33, 66.67]) {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'absolute',
      left: `${x}%`,
      top: '0', bottom: '0',
      width: '2px',
      marginLeft: '-1px',
      background: 'rgba(0, 0, 0, 0.85)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    root.appendChild(div);
  }

  document.body.appendChild(root);

  unsubStyle = hudStyleStore.subscribe(() => applyVisibility());

  bind(staminaStore, render);
}

function applyVisibility(): void {
  if (!root) return;
  if (getHudStyle().stamina !== 'breath') root.style.opacity = '0';
}

function render({ frac, rested, exhausted }: StaminaState): void {
  if (!root || !fill) return;
  if (getHudStyle().stamina !== 'breath') {
    root.style.opacity = '0';
    return;
  }
  const f = Math.max(0, Math.min(1, frac));
  // Hide entirely when rested and full — the bar should ONLY appear
  // when stamina is in motion.
  const visible = !rested || exhausted || f < 0.999;
  root.style.opacity = visible ? (exhausted ? '1' : '0.88') : '0';

  fill.style.transform = `scaleX(${f.toFixed(3)})`;

  // Red tint when nearly empty; restored green once safely above the floor.
  fill.style.background = f < 0.2
    ? 'linear-gradient(180deg, rgba(220, 110, 90, 0.92), rgba(160, 60, 50, 0.92))'
    : 'linear-gradient(180deg, rgba(150, 220, 160, 0.92), rgba(60, 140, 90, 0.92))';
}

export function disposeStaminaArc(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  fill = null;
}
