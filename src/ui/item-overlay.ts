// The floor ITEM OVERLAY — "see before you take". One shared panel that shows the
// FULL item card (ui/item-card.ts) whenever the focused interactable OFFERS an
// item (a floor pickup, an altar reward), driven each frame from the world-ui
// system off getInRangeInteractable(). No per-interactable DOM.
//
// PINNED, not projected: it used to hover the item's projected screen point, but
// a floor pickup sits at the player's FEET, so that point falls off the bottom of
// the screen and the card vanished under the TAKE button + thumb (the reported
// "relics/potions show only TAKE, no card" bug). A fixed anchor — centred, just
// above the TAKE prompt — reads reliably for floor loot AND altar rewards.

import * as THREE from 'three';
import { getInRangeInteractable } from '../interactables/system';
import { buildItemCard } from './item-card';
import { THEME } from './theme';
import { isAnyScreenOpen } from './screen-manager';
import { itemFraming, applyDomainFrame } from './item-framing';

let panel: HTMLDivElement | null = null;
let shownId: string | null = null;

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.classList.add('game-hud');
  Object.assign(panel.style, {
    position: 'fixed',
    // PINNED, not projected. A floor pickup sits at the player's feet — its world
    // point projects off the bottom of the screen, so a "hover over the item"
    // card vanished under the TAKE button + thumb (that was the see-before-you-
    // take bug). A fixed anchor — centred, just above the TAKE prompt — reads
    // reliably for BOTH floor loot and altar rewards and never hides under a thumb.
    left: '50%',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
    transform: 'translate(-50%, 0)',
    maxWidth: 'min(320px, 80vw)', width: 'max-content',
    padding: '9px 13px',
    background: THEME.panel,
    border: `1px solid ${THEME.ruleStrong}`,
    borderRadius: '5px',
    color: THEME.text, fontFamily: 'serif', fontSize: '12px', lineHeight: '1.4',
    zIndex: '35', pointerEvents: 'none', userSelect: 'none',
    opacity: '0', transition: 'opacity 0.12s ease',
    boxShadow: '0 4px 18px rgba(0,0,0,0.6)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);
  return panel;
}

function hide(p: HTMLDivElement): void {
  if (p.style.opacity !== '0') { p.style.opacity = '0'; shownId = null; }
}

/** Restore the panel's neutral border/shadow before a (re-)frame — the domain
 *  frame overwrites these, so a plain (domainless) item must fall back to them. */
function resetPanelChrome(p: HTMLDivElement): void {
  p.style.border = `1px solid ${THEME.ruleStrong}`;
  p.style.boxShadow = '0 4px 18px rgba(0,0,0,0.6)';
}

/** Per-frame: float the focused item's full card above it, or fade out. */
export function tickItemOverlay(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
  const p = ensurePanel();
  const focus = getInRangeInteractable();
  const item = focus?.previewItem;
  if (!item || isAnyScreenOpen()) { hide(p); return; }

  // Rebuild only when the focused item changes (cheap steady state).
  if (shownId !== item.id) {
    shownId = item.id;
    p.replaceChildren(buildItemCard(item, { affixes: focus?.previewAffixes, compare: true }));
    // DRESS the preview in the item's domain — the frame/wash/watermark take the
    // domain colour so a blood relic glows crimson before it's read. Reset the
    // panel's default chrome first (replaceChildren cleared old decoration).
    resetPanelChrome(p);
    const f = itemFraming(item);
    if (f) applyDomainFrame(p, f);
  }

  // Pinned position (set in ensurePanel) — just fade in.
  p.style.opacity = '1';
}
