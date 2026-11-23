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
import { interactPromptHeight, interactPromptBottomY } from './interact-label';
import { buildItemCard } from './item-card';
import { isAnyScreenOpen } from './screen-manager';
import { itemFraming } from './item-framing';
import { injectKitStyles } from './kit/style';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import { hexCss } from '../style/color-utils';
import { worldToScreen } from './hud';
import { cachedCanvasRect } from './canvas-rect';
import type { Interactable } from '../interactables/types';

let panel: HTMLDivElement | null = null;
let shownId: string | null = null;

function ensurePanel(): HTMLDivElement {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.classList.add('game-hud', 'lk-wtag');
  injectKitStyles();
  Object.assign(panel.style, {
    position: 'fixed',
    // Anchored each frame above the TAKE prompt using a layout-free transform.
    // translate(-50%, -100%) hangs the card UPWARD from its anchor point, so the
    // anchor is the card's bottom-centre — sitting it right on top of the prompt.
    left: '0', top: '0',
    transform: 'translate(-50%, -100%)',
    maxWidth: 'min(320px, 80vw)', width: 'max-content',
    zIndex: '35', pointerEvents: 'none', userSelect: 'none',
    opacity: '0', transition: 'opacity 0.12s ease',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);
  return panel;
}

// The TAKE prompt (interact-label) projects to the object at labelOffsetY and
// hangs UP from that point; we clear its height + a gap so the card sits just
// above it. Estimated, not measured — the prompt block is a fixed icon+verb
// stack, and projecting deterministically beats reading a sibling's live rect.
/**
 * Fallback clearance above the prompt, px — used only when the prompt is not
 * currently laid out and cannot be measured.
 *
 * This used to be THE number, and it was an approximation of something the DOM
 * knows exactly. A prompt wraps to two lines on a long verb and grew a numeric
 * cost chip; every time it was taller than 60px the card landed on top of it.
 */
const PROMPT_BLOCK_FALLBACK = 60;
const STACK_GAP = 8;
/**
 * Below this fraction of screen height the anchor has stopped meaning anything.
 *
 * Not a taste threshold — it is where the prompt itself has hit its on-screen
 * clamp, because the item you are standing on has gone off the bottom of the
 * viewport entirely. Tracking a point the camera is past does not convey
 * position, it just glues the card to the bottom edge.
 *
 * Deliberately LATE (0.80, not 0.62). An earlier version parked for most floor
 * items at ordinary range, which fixed nothing and cost the spatial link
 * between the card and the thing it describes.
 */
const PARK_BELOW_FRAC = 0.80;
/** Where a parked card's bottom sits, as a fraction of screen height. Above
 *  centre, so the prompt stays in view beneath it. */
const PARKED_BOTTOM_FRAC = 0.52;
const DEFAULT_LABEL_OFFSET_Y = 0.6;   // matches interact-label's VERTICAL_OFFSET_WORLD
// Keep the card clear of the depth header (top) and inside the side margins.
const TOP_MARGIN = 52;
/** On a short screen the depth title sits at the left, clear of a centred card. */
const TOP_MARGIN_SHORT = 10;
/** The least a cut card keeps: name, rule, kind and a line of flavour. */
const MIN_CARD_PX = 110;
const SIDE_MARGIN = 8;

const _tmp = new THREE.Vector3();

/** Project the interactable's prompt anchor to screen, place the card's
 *  bottom-centre just above the prompt block, and clamp it fully on-screen. */
function anchorAbovePrompt(
  p: HTMLDivElement, focus: Interactable, camera: THREE.Camera, canvas: HTMLCanvasElement,
): void {
  const vw = window.innerWidth, vh = window.innerHeight;
  // Same world point the TAKE prompt projects to (object pivot + label offset).
  const offsetY = focus.labelOffsetY ?? DEFAULT_LABEL_OFFSET_Y;
  _tmp.set(focus.position.x, focus.position.y + offsetY, focus.position.z);
  const proj = worldToScreen(_tmp, camera, cachedCanvasRect(canvas));

  // MEASURED, not assumed, and measured off the prompt AS PLACED.
  //
  // The clearance used to be a constant (60px) standing in for the prompt's
  // height — but a prompt wraps to two lines on a long verb and grew a numeric
  // cost chip, and every time it was taller than the guess the card landed on
  // top of it. Worse, re-deriving the anchor from the world point ignored the
  // prompt's own on-screen clamping, so near the viewport edge the two halves
  // of the stack drifted apart.
  //
  // So: ask the prompt where its bottom actually IS and how tall it actually
  // is. One source of truth for a stack of two.
  const promptH = interactPromptHeight() || PROMPT_BLOCK_FALLBACK;
  const promptBottom = interactPromptBottomY() || proj.y;

  let anchorX: number, anchorBottomY: number;
  if (proj.behind || proj.y > vh * PARK_BELOW_FRAC) {
    // Behind the camera, or so close the item has left the bottom of the
    // viewport. Either way the anchor is past being useful — park centred.
    anchorX = vw / 2;
    anchorBottomY = vh * PARKED_BOTTOM_FRAC;
  } else {
    anchorX = proj.x;
    anchorBottomY = promptBottom - promptH - STACK_GAP;
  }

  // Never over the prompt: the card's foot stays above the prompt's head.
  const shown = interactPromptHeight() > 0;
  if (shown) anchorBottomY = Math.min(anchorBottomY, promptBottom - promptH - STACK_GAP);

  // A short screen (a phone on its side) has less room above the prompt than
  // a full card needs. The card is cut to the room there is and fades out at
  // the cut, rather than being pushed down over the prompt: what it does
  // first (name, kind, flavour, the first effects) stays; the rest is in the
  // satchel once taken.
  const top = vh < 500 ? TOP_MARGIN_SHORT : TOP_MARGIN;
  const room = Math.max(MIN_CARD_PX, anchorBottomY - top);
  const body = p.querySelector<HTMLElement>('.lk-wt-body');
  if (body) {
    const headH = p.offsetHeight - body.offsetHeight;
    const bodyRoom = Math.max(MIN_CARD_PX - headH, room - headH);
    body.style.maxHeight = `${Math.max(0, bodyRoom)}px`;
    body.classList.toggle('lk-wt-cut', body.scrollHeight > bodyRoom + 1);
  }

  // Clamp the card's real box on-screen.
  const cw = p.offsetWidth, ch = p.offsetHeight;
  const halfW = cw / 2;
  anchorX = Math.max(halfW + SIDE_MARGIN, Math.min(vw - halfW - SIDE_MARGIN, anchorX));
  // The card hangs upward (translate -100% Y), so its top = anchorBottomY - ch.
  // Keep that below the header; and never let its bottom slide off-screen.
  if (anchorBottomY - ch < top) anchorBottomY = top + ch;
  anchorBottomY = Math.min(anchorBottomY, vh - SIDE_MARGIN);

  p.style.transform = `translate(${anchorX}px, ${anchorBottomY}px) translate(-50%, -100%)`;
}

/** The world tag for an item (Lamplight): its name over a rule bearing its
 *  domain's mark, what it is, then the card's body (flavour, what it does, what
 *  it replaces) on the tag's pool of dark, so it reads over any floor. A plain
 *  thing gets a plain rule and no colour: the absence is meaningful. */
function buildTag(item: ItemSpec, affixes: Interactable['previewAffixes']): HTMLElement[] {
  const f = itemFraming(item);
  const p = ensurePanel();
  p.style.setProperty('--tc', f ? hexTriplet(f.hex) : '200, 180, 150');

  const name = document.createElement('div');
  name.className = 'lk-wt-name lk-burn';
  name.textContent = item.name;

  const rule = document.createElement('div');
  rule.className = f ? 'lk-wt-rule' : 'lk-wt-rule plain';
  if (f?.art) {
    const img = document.createElement('img');
    img.src = f.art; img.alt = '';
    rule.appendChild(img);
  }

  const rarity = item.rarity ?? 'mundane';
  const kind = document.createElement('div');
  kind.className = 'lk-wt-kind';
  const r = document.createElement('span');
  r.textContent = rarity;
  r.style.color = hexCss(RARITY_COLORS[rarity]);
  kind.append(r, ` · ${item.kind}${f && rarity !== 'cursed' ? ` · ${f.label}` : ''}`);

  const body = buildItemCard(item, { affixes, compare: true, header: false });
  body.classList.add('lk-wt-body');
  return [name, rule, kind, body];
}

function hexTriplet(hex: number): string {
  return `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`;
}

function hide(p: HTMLDivElement): void {
  if (p.style.opacity !== '0') { p.style.opacity = '0'; shownId = null; }
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
    p.replaceChildren(...buildTag(item, focus?.previewAffixes));
  }

  // Ride above the TAKE prompt, clamped on-screen, then fade in.
  anchorAbovePrompt(p, focus, camera, canvas);
  p.style.opacity = '1';
}
