// The floor ITEM OVERLAY — "see before you take". One shared panel that shows the
// FULL item card (ui/item-card.ts) whenever the focused interactable OFFERS an
// item (a floor pickup, an altar reward, an event deal), driven each frame from
// the world-ui system off getInRangeInteractable(). No per-interactable DOM — this
// is THE single-preview system every priced/loot interactable reuses.
//
// STACKED ABOVE THE PROMPT, IN WORLD: the card rides directly above the TAKE
// prompt (#interact-label), which itself projects onto the object — so preview +
// action read as one in-world stack that follows the item. `updateInteractLabel`
// runs immediately before this in the world-ui tick, so the label's rect is
// current when we anchor to it. The card is CLAMPED on-screen (kept below the
// depth header, within the side margins) so a floor pickup at the player's feet —
// whose prompt sits low — never pushes the card off the top or sides. If the
// prompt isn't visible (rare), the card falls back to a centred anchor. This
// fixes both the old off-screen bug AND the "it should float in the world above
// the take" ask in one positioning pass.

import * as THREE from 'three';
import { getInRangeInteractable } from '../interactables/system';
import { buildItemCard } from './item-card';
import { THEME } from './theme';
import { isAnyScreenOpen } from './screen-manager';
import { itemFraming, applyDomainFrame } from './item-framing';
import { worldToScreen } from './hud';
import { cachedCanvasRect } from './canvas-rect';
import type { Interactable } from '../interactables/types';

let panel: HTMLDivElement | null = null;
let shownId: string | null = null;

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.classList.add('game-hud');
  Object.assign(panel.style, {
    position: 'fixed',
    // Anchored each frame above the TAKE prompt (left/top set in tickItemOverlay).
    // translate(-50%, -100%) hangs the card UPWARD from its anchor point, so the
    // anchor is the card's bottom-centre — sitting it right on top of the prompt.
    left: '50%', top: '50%',
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

// The TAKE prompt (interact-label) projects to the object at labelOffsetY and
// hangs UP from that point; we clear its height + a gap so the card sits just
// above it. Estimated, not measured — the prompt block is a fixed icon+verb
// stack, and projecting deterministically beats reading a sibling's live rect.
const PROMPT_BLOCK = 60;   // approx height of the icon+verb prompt, px
const STACK_GAP = 8;
const DEFAULT_LABEL_OFFSET_Y = 0.6;   // matches interact-label's VERTICAL_OFFSET_WORLD
// Keep the card clear of the depth header (top) and inside the side margins.
const TOP_MARGIN = 52;
const SIDE_MARGIN = 8;

const _tmp = new THREE.Vector3();

/** Project the interactable's prompt anchor to screen, place the card's
 *  bottom-centre just above the prompt block, and clamp it fully on-screen. */
function anchorAbovePrompt(
  p: HTMLDivElement, focus: Interactable, camera: THREE.Camera, canvas: HTMLCanvasElement,
): void {
  const vw = window.innerWidth, vh = window.innerHeight;
  // applyDomainFrame() sets position:relative on the panel (to anchor its
  // watermark) — re-assert fixed so the card stays viewport-anchored, not in
  // document flow. (Absolute watermark children still anchor to a fixed panel.)
  p.style.position = 'fixed';
  // Same world point the TAKE prompt projects to (object pivot + label offset).
  const offsetY = focus.labelOffsetY ?? DEFAULT_LABEL_OFFSET_Y;
  _tmp.set(focus.position.x, focus.position.y + offsetY, focus.position.z);
  const proj = worldToScreen(_tmp, camera, cachedCanvasRect(canvas));

  let anchorX: number, anchorBottomY: number;
  if (!proj.behind) {
    anchorX = proj.x;
    // The prompt hangs up from proj.y by ~PROMPT_BLOCK; sit the card above that.
    anchorBottomY = proj.y - PROMPT_BLOCK - STACK_GAP;
  } else {
    anchorX = vw / 2;
    anchorBottomY = vh - 150;
  }

  // Clamp the card's real box on-screen.
  const cw = p.offsetWidth, ch = p.offsetHeight;
  const halfW = cw / 2;
  anchorX = Math.max(halfW + SIDE_MARGIN, Math.min(vw - halfW - SIDE_MARGIN, anchorX));
  // The card hangs upward (translate -100% Y), so its top = anchorBottomY - ch.
  // Keep that below the header; and never let its bottom slide off-screen.
  if (anchorBottomY - ch < TOP_MARGIN) anchorBottomY = TOP_MARGIN + ch;
  anchorBottomY = Math.min(anchorBottomY, vh - SIDE_MARGIN);

  p.style.left = `${anchorX}px`;
  p.style.top = `${anchorBottomY}px`;
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

  // Ride above the TAKE prompt, clamped on-screen, then fade in.
  anchorAbovePrompt(p, focus, camera, canvas);
  p.style.opacity = '1';
}
