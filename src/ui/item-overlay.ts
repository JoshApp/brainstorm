// The floor ITEM OVERLAY — "see before you take". One shared panel that shows the
// FULL item card (ui/item-card.ts) whenever the focused interactable OFFERS an
// item (a floor pickup, an altar reward). It FLOATS OVER the item — projected to
// screen each frame from the world-ui system off getInRangeInteractable(). No
// per-interactable DOM. Replaces the altar preview's truncated one-liner.

import * as THREE from 'three';
import { getInRangeInteractable } from '../interactables/system';
import { buildItemCard } from './item-card';
import { THEME } from './theme';
import { isAnyScreenOpen } from './screen-manager';
import { itemFraming, applyDomainFrame } from './item-framing';

let panel: HTMLDivElement | null = null;
let shownId: string | null = null;
const _v = new THREE.Vector3();

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    left: '0', top: '0',
    // Anchored by its BOTTOM-CENTRE so it hovers just above the item's screen point.
    transform: 'translate(-50%, -100%)',
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

  // Project the item's world point (lifted a little) → screen.
  _v.copy(focus!.position); _v.y += 0.55;
  _v.project(camera);
  if (_v.z > 1) { hide(p); return; }   // behind the camera

  const w = canvas.clientWidth, h = canvas.clientHeight;
  const cw = p.offsetWidth, ch = p.offsetHeight;
  let sx = (_v.x * 0.5 + 0.5) * w;
  let sy = (-_v.y * 0.5 + 0.5) * h - 12;   // a hair above the point
  // Keep the whole card on screen (it extends up + is centred on sx).
  sx = Math.max(cw / 2 + 8, Math.min(w - cw / 2 - 8, sx));
  sy = Math.max(ch + 10, sy);
  p.style.left = `${sx}px`;
  p.style.top = `${sy}px`;
  p.style.opacity = '1';
}
