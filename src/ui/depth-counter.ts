import { depthStore, setDepthState, type DepthState } from '../state/hud-stores';
import { bindText, COLORS } from './hud';
import { FONT_TITLE } from './theme';
import LOGO_RULE from '../assets/ui/logo-rule.webp?url';

// Top-left depth indicator — carved title (Cinzel) over a small skull rule.
// This is the ornate-HUD treatment promoted to DEFAULT (was gated behind
// ?ui=ornate). Bound to depthStore, so it updates on level load — no polling.

// The skull rule under the DEPTH title is the logo's own carved bar with its
// skull plate, cut from the logo art (scripts/logo-parts.py), so the
// HUD, the title and the loading screens wear one carving.
const SKULL_RULE = `url("${LOGO_RULE}")`;
const RULE_W = 150;                                   // px; the cut is 685x88
const RULE_H = Math.round(RULE_W * 88 / 685);

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
    paddingBottom: `${RULE_H + 2}px`,  // room for the skull rule beneath
    minWidth: `${RULE_W}px`,
    textAlign: 'center',
    background: `${SKULL_RULE} bottom center / ${RULE_W}px ${RULE_H}px no-repeat`,
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
