// THE READING — fate deals you three, you keep one.
//
// The dealt-3-pick-1 draw (the Self scope — docs/THE-CARDS.md). A small draw
// pile sits at the top; three cards lie below it face-DOWN (the watching-eye
// back) and flip up in turn, each the fully-FRAMED linocut card (baked by
// scripts/bake-cards.ts). Tap one to claim it (grantCard → the stat pipeline).
// Mobile-first: a fixed flex row that fits landscape, body never scrolls, the
// hover lift is contained.

import { createSheet } from './menu-shell';
import { isScreenOpen } from './screen-manager';
import { THEME, FONT_UI, displayHeading } from './theme';
import { CARDS, dealCards, type CardSpec } from '../content/cards';
import { grantCard, getHeldCards } from '../state/run-state';

const SCREEN_ID = 'card-reading';
const CW = 122, CH = Math.round(CW * 1312 / 768);  // baked-card aspect (~209)
const BASE = import.meta.env.BASE_URL;

export function openCardReading(opts: { onDone?: () => void } = {}): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const dealt = dealCards(3, { arcana: 'minor' }).map((id) => CARDS[id]).filter(Boolean) as CardSpec[];
  if (dealt.length === 0) { opts.onDone?.(); return; }

  let picked = false;
  const s = createSheet({
    id: SCREEN_ID, width: 640, layer: 'modal',
    policy: { hidesHud: true, dimsScene: true },
    onClose() { opts.onDone?.(); },
  });
  s.root.style.background =
    'radial-gradient(120% 95% at 50% 120%, rgba(120, 56, 18, 0.5) 0%, rgba(26, 14, 8, 0.97) 56%, rgba(12, 8, 5, 0.98) 100%)';
  s.body.style.overflow = 'hidden';                 // the reading never scrolls
  Object.assign(s.body.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', paddingTop: '6px' } as Partial<CSSStyleDeclaration>);

  const intro = displayHeading('The fire deals your fate', { size: 15, glow: true });
  intro.style.textAlign = 'center';
  s.body.appendChild(intro);
  s.body.appendChild(deckPile());                   // the draw pile, up top — never hidden
  const sub = document.createElement('div');
  sub.textContent = 'Three are turned. Keep one.';
  Object.assign(sub.style, { fontFamily: FONT_UI, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: THEME.faint, textAlign: 'center' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(sub);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '18px', justifyContent: 'center', alignItems: 'flex-start', padding: '14px 4px 6px' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(row);

  dealt.forEach((card, i) => {
    // slot = perspective host; holds the flipping card + a name caption below.
    const slot = document.createElement('div');
    Object.assign(slot.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', cursor: 'pointer', perspective: '800px', transition: 'transform 0.16s', willChange: 'transform' } as Partial<CSSStyleDeclaration>);

    const flip = document.createElement('div');
    Object.assign(flip.style, { position: 'relative', width: `${CW}px`, height: `${CH}px`, transformStyle: 'preserve-3d', transform: 'rotateY(180deg)', transition: 'transform 0.55s cubic-bezier(0.2,0.8,0.2,1)' } as Partial<CSSStyleDeclaration>);
    flip.append(faceBack(), faceFront(card));
    slot.appendChild(flip);

    const cap = displayHeading(card.name, { size: 11, glow: true });
    cap.style.textAlign = 'center'; cap.style.opacity = '0'; cap.style.transition = 'opacity 0.3s';
    slot.appendChild(cap);

    row.appendChild(slot);
    setTimeout(() => { flip.style.transform = 'rotateY(0deg)'; cap.style.opacity = '1'; }, 360 + i * 180);

    slot.addEventListener('pointerenter', () => { if (!picked) slot.style.transform = 'translateY(-12px)'; });
    slot.addEventListener('pointerleave', () => { if (!picked) slot.style.transform = 'none'; });
    slot.addEventListener('click', () => {
      if (picked) return;
      picked = true;
      grantCard(card.id);
      slot.style.transform = 'translateY(-18px) scale(1.06)';
      for (const sib of Array.from(row.children)) if (sib !== slot && sib instanceof HTMLElement) { sib.style.opacity = '0'; sib.style.transform = 'translateY(28px)'; sib.style.transition = 'opacity 0.4s, transform 0.4s'; }
      setTimeout(() => s.close(), 560);
    });
  });

  s.open();
}

/** A small static draw pile — a few stacked backs, so the deck is always read. */
function deckPile(): HTMLElement {
  const wrap = document.createElement('div');
  const w = Math.round(CW * 0.46), h = Math.round(CH * 0.46);
  Object.assign(wrap.style, { position: 'relative', width: `${w + 10}px`, height: `${h + 6}px` } as Partial<CSSStyleDeclaration>);
  for (let d = 0; d < 4; d++) {
    const slab = document.createElement('img');
    slab.src = `${BASE}cards/back.webp`;
    Object.assign(slab.style, { position: 'absolute', left: `${d * 2.4}px`, top: `${(3 - d) * 1.4}px`, width: `${w}px`, height: `${h}px`, borderRadius: '3px', boxShadow: '0 2px 8px rgba(0,0,0,0.7)', transform: `rotate(${(d - 1.5) * 1.1}deg)`, opacity: '0.92' } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(slab);
  }
  return wrap;
}

/** The face — the baked FRAMED linocut card (frame + art + organic edge). */
function faceFront(card: CardSpec): HTMLElement {
  const el = document.createElement('img');
  el.src = `${BASE}cards/${card.id}.webp`; el.alt = card.name;
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', backfaceVisibility: 'hidden', display: 'block', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.7))' } as Partial<CSSStyleDeclaration>);
  return el;
}

/** The shared card-back — the baked watching-eye back. */
function faceBack(): HTMLElement {
  const el = document.createElement('img');
  el.src = `${BASE}cards/back.webp`; el.alt = 'card back';
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: '4px', display: 'block', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.7))' } as Partial<CSSStyleDeclaration>);
  return el;
}

/** Whether the run currently holds any fate cards (for HUD/menus later). */
export function hasFateCards(): boolean {
  return getHeldCards().length > 0;
}
