// The floor ITEM OVERLAY — "see before you take". One shared panel that shows the
// FULL item card (ui/item-card.ts) whenever the focused interactable OFFERS an
// item (a floor pickup, an altar reward). Driven each frame from the world-ui
// system off getInRangeInteractable(); no per-interactable DOM. Replaces the
// altar preview's truncated one-liner.

import { getInRangeInteractable } from '../interactables/system';
import { buildItemCard } from './item-card';
import { THEME } from './theme';
import { isAnyScreenOpen } from './screen-manager';

let panel: HTMLDivElement | null = null;
let shownId: string | null = null;

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    top: 'calc(14px + env(safe-area-inset-top, 0px))',
    left: '50%', transform: 'translateX(-50%)',
    maxWidth: 'min(340px, 82vw)', width: 'max-content',
    padding: '10px 14px',
    background: THEME.panel,
    border: `1px solid ${THEME.ruleStrong}`,
    borderRadius: '5px',
    color: THEME.text, fontFamily: 'serif', fontSize: '12px', lineHeight: '1.4',
    zIndex: '35', pointerEvents: 'none', userSelect: 'none',
    opacity: '0', transition: 'opacity 0.14s ease',
    boxShadow: '0 4px 18px rgba(0,0,0,0.55)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);
  return panel;
}

/** Per-frame refresh. Show the focused interactable's item card, or fade out. */
export function tickItemOverlay(): void {
  const p = ensurePanel();
  const focus = getInRangeInteractable();
  const item = focus?.previewItem;
  if (!item || isAnyScreenOpen()) {
    if (p.style.opacity !== '0') { p.style.opacity = '0'; shownId = null; }
    return;
  }
  // Rebuild only when the focused item changes (cheap steady state).
  if (shownId !== item.id) {
    shownId = item.id;
    p.replaceChildren(buildItemCard(item, { affixes: focus?.previewAffixes, compare: true }));
  }
  p.style.opacity = '1';
}
