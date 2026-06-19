import { depthStore, setDepthState, type DepthState } from '../state/hud-stores';
import { bindText, FONT_UI, COLORS } from './hud';

// Small top-left depth indicator. Just text — no border, no background.
// Stays out of the way; the player only glances at it. Bound to depthStore,
// so it updates whenever the depth is set (on level load) — no polling.

let label: HTMLDivElement | null = null;

export function createDepthCounter(depth: number) {
  if (label) return;
  setDepthState(depth);

  label = document.createElement('div');
  label.id = 'depth-counter'; label.classList.add('game-hud');
  Object.assign(label.style, {
    position: 'fixed',
    left: 'calc(16px + env(safe-area-inset-left, 0px))',
    top: 'calc(48px + env(safe-area-inset-top, 0px))',  // below the style switcher
    color: COLORS.parchment,
    fontFamily: FONT_UI,
    fontSize: '12px',
    fontWeight: '400',
    letterSpacing: '0.25em',
    textShadow: COLORS.shadow,
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(label);

  bindText(label, depthStore, ({ depth, sanctuary }: DepthState) =>
    sanctuary ? `DEPTH ${depth} — SANCTUARY` : `DEPTH ${depth}`,
  );
}

/** Set the depth readout. Kept as the public name existing callers (the level
 *  loader) import; now just drives the store the counter is bound to. */
export function setDepth(depth: number, sanctuary: boolean = false) {
  setDepthState(depth, sanctuary);
}
