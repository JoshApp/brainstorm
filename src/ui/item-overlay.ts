// The floor ITEM OVERLAY — "see before you take". One shared panel that shows the
// FULL item card (ui/item-card.ts) whenever the focused interactable OFFERS an
// item (a floor pickup, an altar reward, an event deal), driven each frame from
// the world-ui system off getInRangeInteractable(). No per-interactable DOM — this
// is THE single-preview system every priced/loot interactable reuses.
//
// ONE STACK WITH THE PROMPT, IN WORLD: the card and the TAKE prompt
// (#interact-label) are hung on the object together. The prompt places the
// stack, since it knows the thing and which side of it has room (above, or
// below when the thing is high on screen); the card takes the place left for
// it and reports its height back. The card is never resized by where the camera
// is, and never sits on the prompt. `updateInteractLabel` runs immediately
// before this in the world-ui tick.

import * as THREE from 'three';
import { getInRangeInteractable } from '../interactables/system';
import {
  interactPromptHeight, interactPromptBottomY, interactStackSide, setPromptCompanionHeight, stackTopMargin, PROMPT_FLOOR,
} from './interact-label';
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

/**
 * Fallback clearance above the prompt, px — used only when the prompt is not
 * currently laid out and cannot be measured.
 *
 * This used to be THE number, and it was an approximation of something the DOM
 * knows exactly. A prompt wraps to two lines on a long verb and grew a numeric
 * cost chip; every time it was taller than 60px the card landed on top of it.
 */
const PROMPT_BLOCK_FALLBACK = 60;
/** Between the card and its prompt. Wide enough that the card's pool of dark
 *  (its soft shadow) doesn't fall across the prompt's verb. */
const STACK_GAP = 14;
/** Where a card with no prompt to stand on parks: its bottom at this fraction
 *  of screen height. */
const PARKED_BOTTOM_FRAC = 0.52;
const DEFAULT_LABEL_OFFSET_Y = 0.6;   // matches interact-label's VERTICAL_OFFSET_WORLD
/** The least a cut card keeps: name, rule, kind and a line of flavour. */
const MIN_CARD_PX = 110;
const SIDE_MARGIN = 8;

const _tmp = new THREE.Vector3();

/** Size the card for the viewport, report it to the prompt, and set it on
 *  the side of the prompt the stack hangs from. */
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
  const promptShown = interactPromptHeight() > 0;
  const promptH = interactPromptHeight() || PROMPT_BLOCK_FALLBACK;
  const promptBottom = interactPromptBottomY() || proj.y;

  // The card's size is the VIEWPORT's business, not the camera's: it is cut
  // only when the whole screen can't hold it with its prompt (a phone on its
  // side, a long card), and then at the same place every frame. It used to be
  // cut to whatever room sat above the prompt, so it shrank and grew as you
  // moved (Josh, 2026-11-24).
  const top = stackTopMargin();
  const body = p.querySelector<HTMLElement>('.lk-wt-body');
  if (body) {
    const headH = p.offsetHeight - body.offsetHeight;
    const bodyRoom = Math.max(MIN_CARD_PX - headH, vh - top - PROMPT_FLOOR - promptH - STACK_GAP - headH);
    const want = `${Math.max(0, Math.floor(bodyRoom))}px`;
    if (body.style.maxHeight !== want) body.style.maxHeight = want;
    body.classList.toggle('lk-wt-cut', body.scrollHeight > bodyRoom + 1);
  }
  const cw = p.offsetWidth, ch = p.offsetHeight;
  // The prompt places the stack (interact-label: it knows the thing and which
  // side has room); the card takes the place left for it, one frame late.
  setPromptCompanionHeight(ch + STACK_GAP);

  let anchorX = proj.x;
  let edgeY: number;            // the card's bottom when above, its top when below
  let below = false;
  if (!promptShown || proj.behind) {
    // No prompt to stand on, or the thing is behind you: park centred.
    anchorX = vw / 2;
    edgeY = vh * PARKED_BOTTOM_FRAC;
  } else if (interactStackSide() === 'below') {
    below = true;
    edgeY = promptBottom + STACK_GAP;
  } else {
    edgeY = promptBottom - promptH - STACK_GAP;
  }
  const halfW = cw / 2;
  anchorX = Math.max(halfW + SIDE_MARGIN, Math.min(vw - halfW - SIDE_MARGIN, anchorX));
  p.style.transform = below
    ? `translate(${anchorX}px, ${edgeY}px) translate(-50%, 0)`
    : `translate(${anchorX}px, ${Math.max(edgeY, top + ch)}px) translate(-50%, -100%)`;
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
  setPromptCompanionHeight(0);
  if (p.style.opacity !== '0') { p.style.opacity = '0'; shownId = null; }
}

/** Per-frame: float the focused item's full card above it, or fade out. */
export function tickItemOverlay(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
  const p = ensurePanel();
  const focus = getInRangeInteractable();
  const item = focus?.previewItem;
  if (!item || isAnyScreenOpen()) { hide(p); return; }

  // Rebuild only when the focused item changes (cheap steady state).
  let fresh = false;
  if (shownId !== item.id) {
    shownId = item.id;
    fresh = true;
    p.replaceChildren(...buildTag(item, focus?.previewAffixes));
  }

  // Ride with the TAKE prompt, then fade in. A fresh card stays unseen for the
  // one frame the prompt needs to make room for it.
  anchorAbovePrompt(p, focus, camera, canvas);
  if (fresh) { p.style.opacity = '0'; return; }
  p.style.opacity = '1';
}
