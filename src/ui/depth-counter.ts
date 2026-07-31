import { depthStore, setDepthState, type DepthState } from '../state/hud-stores';
import { bindText, COLORS } from './hud';
import { FONT_TITLE } from './theme';

// Top-left depth indicator — carved title (Cinzel) over a small skull rule.
// This is the ornate-HUD treatment promoted to DEFAULT (was gated behind
// ?ui=ornate). Bound to depthStore, so it updates on level load — no polling.

// Skull-and-rule ornament drawn under the DEPTH title. Inline data-URI SVG so
// it's self-contained (CSP-safe, no asset).
const SKULL_RULE =
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='16' viewBox='0 0 120 16'>` +
    `<line x1='0' y1='8' x2='46' y2='8' stroke='#8a6f3e' stroke-width='1'/>` +
    `<line x1='74' y1='8' x2='120' y2='8' stroke='#8a6f3e' stroke-width='1'/>` +
    `<path d='M60 3 a6 6 0 0 1 6 6 v2 a3 3 0 0 1 -3 3 h-6 a3 3 0 0 1 -3 -3 v-2 a6 6 0 0 1 6 -6 z' fill='#8a6f3e'/>` +
    `<circle cx='57.5' cy='8.5' r='1.4' fill='#160f09'/><circle cx='62.5' cy='8.5' r='1.4' fill='#160f09'/>` +
    `</svg>`,
  )}")`;

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
    color: '#d8bd8e',
    fontFamily: FONT_TITLE,             // Cinzel — the carved-title register
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.34em',
    textShadow: COLORS.shadow,
    paddingBottom: '12px',             // room for the skull rule beneath
    background: `${SKULL_RULE} bottom center / 120px 14px no-repeat`,
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
