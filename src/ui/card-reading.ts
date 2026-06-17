// THE READING — fate deals you three, you keep one.
//
// The dealt-3-pick-1 draw (the Self scope — see docs/THE-CARDS.md), presented as
// real 3D cards: they fly out of the deck face-DOWN, flip face-up in sequence,
// lift to your hover, and the one you pick rises and is claimed (grantCard →
// straight into the stat pipeline). Built with CSS 3D (preserve-3d) so the faces
// stay crisp DOM (sigil + serif name + fate) and we get genuine flip/deal — no
// second WebGL context. (The in-world floor-drop card is a separate mesh later.)

import { createSheet } from './menu-shell';
import { isScreenOpen } from './screen-manager';
import { THEME, FONT_UI, displayHeading, applyCarvedFrame } from './theme';
import { CARDS, dealCards, type CardSpec } from '../content/cards';
import { grantCard, getHeldCards } from '../state/run-state';
import { DOMAIN_VISUAL } from '../art/domains';

const SCREEN_ID = 'card-reading';
const CARD_W = 168, CARD_H = 252, SPREAD = 188;
const BASE = import.meta.env.BASE_URL;  // shipped card art lives at <base>cards/<id>.webp

export function openCardReading(opts: { onDone?: () => void } = {}): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const dealt = dealCards(3, { arcana: 'minor' }).map((id) => CARDS[id]).filter(Boolean) as CardSpec[];
  if (dealt.length === 0) { opts.onDone?.(); return; }

  let picked = false;
  const s = createSheet({
    id: SCREEN_ID, width: 720, layer: 'modal',
    policy: { hidesHud: true, dimsScene: true },
    onClose() { opts.onDone?.(); },
  });
  s.root.style.background =
    'radial-gradient(120% 95% at 50% 122%, rgba(120, 56, 18, 0.5) 0%, rgba(28, 15, 9, 0.97) 54%, rgba(13, 8, 5, 0.98) 100%)';

  const intro = displayHeading('The fire deals your fate', { size: 17, glow: true });
  intro.style.textAlign = 'center'; intro.style.margin = '6px 0 4px';
  s.body.appendChild(intro);
  const sub = document.createElement('div');
  sub.textContent = 'Three are turned. Keep one.';
  Object.assign(sub.style, { fontFamily: FONT_UI, fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: THEME.faint, textAlign: 'center', marginBottom: '8px' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(sub);

  // 3D stage — perspective so flips read as depth, not a 2D squash.
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'relative', height: `${CARD_H + 110}px`, width: '100%',
    perspective: '1500px', perspectiveOrigin: '50% 42%',
  } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(stage);

  // A little deck stack at centre the cards appear to come from.
  for (let d = 0; d < 4; d++) {
    const slab = faceBack();
    Object.assign(slab.style, {
      position: 'absolute', left: `calc(50% - ${CARD_W / 2}px)`, top: `${52 - d * 1.5}px`,
      transform: `translateX(${d * 1.2}px) rotateZ(${(d - 1.5) * 0.8}deg)`, zIndex: '0', opacity: '0.85',
    } as Partial<CSSStyleDeclaration>);
    stage.appendChild(slab);
  }

  const finish = (id: string) => { if (picked) return; picked = true; grantCard(id); setTimeout(() => s.close(), 620); };

  dealt.forEach((card, i) => {
    const base = `translateX(${(i - (dealt.length - 1) / 2) * SPREAD}px) translateY(70px)`;
    const card3d = document.createElement('div');
    Object.assign(card3d.style, {
      position: 'absolute', left: `calc(50% - ${CARD_W / 2}px)`, top: '52px',
      width: `${CARD_W}px`, height: `${CARD_H}px`, transformStyle: 'preserve-3d',
      transform: 'translateX(0) translateY(0) rotateY(180deg)',  // start: stacked, face-down
      transition: 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s', cursor: 'pointer', zIndex: String(2 + i),
    } as Partial<CSSStyleDeclaration>);
    const front = faceFront(card); const back = faceBack();
    card3d.append(back, front);
    stage.appendChild(card3d);

    // deal out (still face-down), then flip face-up — staggered down the row.
    setTimeout(() => { card3d.style.transform = `${base} rotateY(180deg)`; }, 80 + i * 110);
    setTimeout(() => { card3d.style.transform = `${base} rotateY(0deg)`; }, 520 + i * 170);

    card3d.addEventListener('pointerenter', () => { if (!picked) card3d.style.transform = `${base} translateY(54px) rotateY(0deg) scale(1.05)`; });
    card3d.addEventListener('pointerleave', () => { if (!picked) card3d.style.transform = `${base} rotateY(0deg)`; });
    card3d.addEventListener('click', () => {
      if (picked) return;
      // chosen card rises and turns to face you; the others fall away.
      card3d.style.transition = 'transform 0.5s cubic-bezier(0.2,0.9,0.2,1), opacity 0.4s';
      card3d.style.transform = `translateX(0) translateY(20px) rotateY(0deg) scale(1.18)`;
      card3d.style.zIndex = '10';
      for (const sib of Array.from(stage.children)) {
        if (sib !== card3d && sib instanceof HTMLElement && sib.style.transformStyle === 'preserve-3d') {
          sib.style.opacity = '0'; sib.style.transform += ' translateY(60px)';
        }
      }
      finish(card.id);
    });
  });

  s.open();
}

/** The face — the real linocut art (baked webp) with a title strip + a carved
 *  edge; falls back to a data-driven face if the asset is missing. */
function faceFront(card: CardSpec): HTMLElement {
  const dv = card.domains[0] ? DOMAIN_VISUAL[card.domains[0]] : undefined;
  const accent = dv?.color ?? THEME.amber;
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute', inset: '0', backfaceVisibility: 'hidden', borderRadius: '5px', overflow: 'hidden',
    background: `linear-gradient(180deg, ${THEME.raised} 0%, ${THEME.panel} 60%)`,
    border: `1px solid ${accent}99`, boxShadow: THEME.shadow, color: THEME.text, fontFamily: FONT_UI,
  } as Partial<CSSStyleDeclaration>);

  const img = document.createElement('img');
  img.src = `${BASE}cards/${card.id}.webp`; img.alt = card.name;
  Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'block' } as Partial<CSSStyleDeclaration>);
  img.onerror = () => {  // asset missing → degrade to the domain sigil
    img.remove();
    if (dv) {
      const s = document.createElement('div');
      Object.assign(s.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent } as Partial<CSSStyleDeclaration>);
      s.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">${dv.svg}</svg>`;
      el.insertBefore(s, el.firstChild);
    }
  };
  el.appendChild(img);

  // title strip — name + arcana over a scrim along the bottom
  const scrim = document.createElement('div');
  Object.assign(scrim.style, { position: 'absolute', left: '0', right: '0', bottom: '0', padding: '24px 8px 9px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', background: `linear-gradient(transparent, ${THEME.void} 70%)` } as Partial<CSSStyleDeclaration>);
  const name = displayHeading(card.name, { size: 13, glow: true }); name.style.textAlign = 'center';
  scrim.appendChild(name);
  const arc = document.createElement('div');
  arc.textContent = card.arcana === 'major' ? 'Major Arcana' : 'Minor';
  Object.assign(arc.style, { fontFamily: FONT_UI, fontSize: '7px', letterSpacing: '0.28em', textTransform: 'uppercase', color: card.arcana === 'major' ? THEME.amber : THEME.dim } as Partial<CSSStyleDeclaration>);
  scrim.appendChild(arc);
  el.appendChild(scrim);

  applyCarvedFrame(el, { tickSize: 12, inset: 6 });
  return el;
}

/** The shared card-back — the baked back art on every reverse. */
function faceBack(): HTMLElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute', inset: '0', width: `${CARD_W}px`, height: `${CARD_H}px`,
    backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: '5px', overflow: 'hidden',
    background: 'radial-gradient(60% 50% at 50% 45%, rgba(60, 34, 16, 0.6), rgba(16, 10, 7, 0.98))',
    border: `1px solid ${THEME.ruleStrong}`, boxShadow: THEME.shadow,
  } as Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = `${BASE}cards/back.webp`; img.alt = 'card back';
  Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } as Partial<CSSStyleDeclaration>);
  el.appendChild(img);
  applyCarvedFrame(el, { tickSize: 12, inset: 6 });
  return el;
}

/** Whether the run currently holds any fate cards (for HUD/menus later). */
export function hasFateCards(): boolean {
  return getHeldCards().length > 0;
}
