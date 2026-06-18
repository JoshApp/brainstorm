// THE READING — fate deals you three, you keep one.
//
// The dealt-3-pick-1 draw (the Self scope — docs/THE-CARDS.md). A draw pile up
// top; three cards below flip up from face-down (the watching-eye back) to the
// fully-framed linocut card. Tap one to claim it (grantCard → the stat pipeline).
//
// Responsive: the cards size to the VIEWPORT (clamp + aspect-ratio), so they're
// big on a desktop window and shrink to fit a phone in landscape — capped so
// they never get absurd. Body never scrolls; hover lift is contained. A FRAME
// toggle flips between the framed card and the raw illustration to compare.

import { createSheet } from './menu-shell';
import { isScreenOpen } from './screen-manager';
import { displayHeading } from './theme';
import { FONT_BLACK, FONT_SERIF } from './fonts';
import { CARDS, dealCards, type CardSpec } from '../content/cards';
import { grantCard, getHeldCards } from '../state/run-state';

const SCREEN_ID = 'card-reading';
const BASE = import.meta.env.BASE_URL;
// viewport-relative card height — big on PC, fits a landscape phone, capped.
const CARD_H = 'clamp(150px, 44vh, 360px)';
const CARD_ASPECT = '768 / 1312';

export function openCardReading(opts: { onDone?: (picked: boolean) => void } = {}): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const dealt = dealCards(3, { arcana: 'minor' }).map((id) => CARDS[id]).filter(Boolean) as CardSpec[];
  if (dealt.length === 0) { opts.onDone?.(false); return; }

  let picked = false;
  const fronts: Array<{ img: HTMLImageElement; id: string }> = [];

  const s = createSheet({
    id: SCREEN_ID, width: 860, layer: 'modal',
    policy: { hidesHud: true, dimsScene: true },
    onClose() { opts.onDone?.(picked); },
  });
  s.root.style.background =
    'radial-gradient(120% 95% at 50% 120%, rgba(120, 56, 18, 0.5) 0%, rgba(26, 14, 8, 0.97) 56%, rgba(12, 8, 5, 0.98) 100%)';
  s.body.style.overflow = 'hidden';
  Object.assign(s.body.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', paddingTop: '4px' } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'Choose Your Fate';
  Object.assign(title.style, { fontFamily: FONT_BLACK, fontWeight: '700', fontSize: 'clamp(22px, 5vw, 38px)', lineHeight: '1', letterSpacing: '0.02em', color: 'rgba(232, 188, 120, 0.98)', textShadow: '0 0 24px rgba(180, 90, 30, 0.5)', textAlign: 'center' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(title);
  const sub = document.createElement('div');
  sub.textContent = 'The fire deals three. You keep one.';
  Object.assign(sub.style, { fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: '13px', color: 'rgba(190, 150, 110, 0.72)', textAlign: 'center', margin: '2px 0 1px' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(sub);
  s.body.appendChild(deckPile());

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: 'clamp(10px, 3vw, 30px)', justifyContent: 'center', alignItems: 'flex-start', padding: 'clamp(10px,2vh,20px) 4px 4px', flexWrap: 'nowrap' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(row);

  dealt.forEach((card, i) => {
    const slot = document.createElement('div');
    Object.assign(slot.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', cursor: 'pointer', perspective: '900px', transition: 'transform 0.16s', willChange: 'transform' } as Partial<CSSStyleDeclaration>);

    const flip = document.createElement('div');
    Object.assign(flip.style, { position: 'relative', height: CARD_H, aspectRatio: CARD_ASPECT, transformStyle: 'preserve-3d', transform: 'rotateY(180deg)', transition: 'transform 0.55s cubic-bezier(0.2,0.8,0.2,1)' } as Partial<CSSStyleDeclaration>);
    const front = faceImg();
    fronts.push({ img: front, id: card.id });
    flip.append(faceBack(), front);
    slot.appendChild(flip);

    const cap = displayHeading(card.name, { size: 12, glow: true });
    cap.style.textAlign = 'center'; cap.style.opacity = '0'; cap.style.transition = 'opacity 0.3s';
    slot.appendChild(cap);

    row.appendChild(slot);
    setTimeout(() => { flip.style.transform = 'rotateY(0deg)'; cap.style.opacity = '1'; }, 360 + i * 180);

    slot.addEventListener('pointerenter', () => { if (!picked) slot.style.transform = 'translateY(-14px)'; });
    slot.addEventListener('pointerleave', () => { if (!picked) slot.style.transform = 'none'; });
    slot.addEventListener('click', () => {
      if (picked) return;
      picked = true; grantCard(card.id);
      slot.style.transform = 'translateY(-20px) scale(1.06)';
      for (const sib of Array.from(row.children)) if (sib !== slot && sib instanceof HTMLElement) { sib.style.opacity = '0'; sib.style.transform = 'translateY(30px)'; sib.style.transition = 'opacity 0.4s, transform 0.4s'; }
      setTimeout(() => s.close(), 560);
    });
  });

  // the framed linocut card faces (compare-toggle retired — the framed card won)
  for (const { img, id } of fronts) img.src = `${BASE}cards/${id}.webp`;

  s.open();
}

function deckPile(): HTMLElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'relative', height: 'clamp(44px, 12vh, 92px)', aspectRatio: CARD_ASPECT } as Partial<CSSStyleDeclaration>);
  for (let d = 0; d < 4; d++) {
    const slab = document.createElement('img');
    slab.src = `${BASE}cards/back.webp`;
    Object.assign(slab.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', transform: `translate(${d * 2.2}px, ${(3 - d) * 1.2}px) rotate(${(d - 1.5) * 1.1}deg)`, opacity: '0.92', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.7))' } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(slab);
  }
  return wrap;
}

/** A face <img> filling the flip plane (src set by applyMode). */
function faceImg(): HTMLImageElement {
  const el = document.createElement('img');
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', backfaceVisibility: 'hidden', display: 'block', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.7))' } as Partial<CSSStyleDeclaration>);
  return el;
}

function faceBack(): HTMLImageElement {
  const el = document.createElement('img');
  el.src = `${BASE}cards/back.webp`; el.alt = 'card back';
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: '4px', display: 'block', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.7))' } as Partial<CSSStyleDeclaration>);
  return el;
}

/** Whether the run currently holds any fate cards (for HUD/menus later). */
export function hasFateCards(): boolean {
  return getHeldCards().length > 0;
}
