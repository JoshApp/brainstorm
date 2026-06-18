// THE READING — fate deals you three; you keep one.
//
// The dealt-3-pick-1 draw (docs/THE-CARDS.md). Cards flip up from face-down (the
// watching-eye back). Each shows its name + what it DOES (formatModifier — the same
// vocabulary as item tooltips), so you compare all three before committing. Tap a
// card to SELECT: it lifts, the others recede, and its FATE (the one-line identity,
// broadcast voice) + a Claim seal rise into the thumb zone. Claim commits.
//
// Mobile-first (docs/UI-CHARTER.md): full-bleed dark ritual ground so the linocut
// cards read out of black; sized to the landscape viewport; thumb-zone confirm.

import { createSheet } from './menu-shell';
import { isScreenOpen } from './screen-manager';
import { FONT_UI } from './theme';
import { FONT_BLACK, FONT_SERIF } from './fonts';
import { formatModifier } from './item-format';
import { CARDS, dealCards, type CardSpec } from '../content/cards';
import { grantCard, getHeldCards } from '../state/run-state';

const SCREEN_ID = 'card-reading';
const BASE = import.meta.env.BASE_URL;
const CARD_H = 'clamp(124px, 38vh, 280px)';
const CARD_ASPECT = '768 / 1312';
const AMBER = 'rgba(232, 188, 120, 0.98)';

/** What the card DOES, terse — the same numbers an item tooltip shows. */
function effectLines(card: CardSpec): string[] {
  const e = card.effect;
  const out: string[] = [];
  for (const m of e.modifiers ?? []) out.push(formatModifier(m));
  for (const c of e.conditional ?? []) for (const m of c.modifiers) out.push(`${formatModifier(m)} · when low`);
  if (e.triggers?.length) out.push('a power that wakes in battle');
  return out;
}

export function openCardReading(opts: { onDone?: (picked: boolean) => void } = {}): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const dealt = dealCards(3, { arcana: 'minor' }).map((id) => CARDS[id]).filter(Boolean) as CardSpec[];
  if (dealt.length === 0) { opts.onDone?.(false); return; }

  let picked = false;
  let selected = -1;
  const cols: HTMLElement[] = [];
  const fronts: Array<{ img: HTMLImageElement; id: string }> = [];

  const s = createSheet({
    id: SCREEN_ID, width: 980, layer: 'modal',
    policy: { hidesHud: true, dimsScene: true },
    onClose() { opts.onDone?.(picked); },
  });
  s.root.style.background =
    'radial-gradient(120% 95% at 50% 120%, rgba(120, 56, 18, 0.5) 0%, rgba(26, 14, 8, 0.97) 56%, rgba(12, 8, 5, 0.98) 100%)';
  s.body.style.overflow = 'hidden';
  Object.assign(s.body.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(3px,1vh,10px)', paddingTop: '2px' } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'Choose Your Fate';
  Object.assign(title.style, { fontFamily: FONT_BLACK, fontWeight: '700', fontSize: 'clamp(18px,4vw,32px)', lineHeight: '1', letterSpacing: '0.02em', color: AMBER, textShadow: '0 0 22px rgba(180,90,30,0.5)', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(title);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: 'clamp(10px,3vw,36px)', justifyContent: 'center', alignItems: 'center', flex: '1 1 auto', width: '100%' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(row);

  dealt.forEach((card, i) => {
    const col = document.createElement('div');
    Object.assign(col.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', cursor: 'pointer', opacity: '0', transition: 'transform 0.18s, opacity 0.22s', perspective: '900px', willChange: 'transform' } as Partial<CSSStyleDeclaration>);
    cols.push(col);

    const flip = document.createElement('div');
    Object.assign(flip.style, { position: 'relative', height: CARD_H, aspectRatio: CARD_ASPECT, transformStyle: 'preserve-3d', transform: 'rotateY(180deg)', transition: 'transform 0.55s cubic-bezier(0.2,0.8,0.2,1)' } as Partial<CSSStyleDeclaration>);
    const front = faceImg();
    fronts.push({ img: front, id: card.id });
    flip.append(faceBack(), front);
    col.appendChild(flip);

    const name = document.createElement('div');
    name.textContent = card.name;
    Object.assign(name.style, { fontFamily: FONT_SERIF, fontWeight: '600', fontSize: 'clamp(13px,2.4vw,18px)', color: '#e8d8b8', textAlign: 'center', lineHeight: '1.1' } as Partial<CSSStyleDeclaration>);
    col.appendChild(name);

    const fx = document.createElement('div');
    fx.textContent = effectLines(card).join('  ·  ');
    Object.assign(fx.style, { fontFamily: FONT_UI, fontSize: 'clamp(9px,1.7vw,12px)', letterSpacing: '0.02em', color: 'rgba(208,178,128,0.85)', textAlign: 'center', lineHeight: '1.3', maxWidth: '15em' } as Partial<CSSStyleDeclaration>);
    col.appendChild(fx);

    row.appendChild(col);
    setTimeout(() => { flip.style.transform = 'rotateY(0deg)'; col.style.opacity = '1'; }, 320 + i * 170);
    col.addEventListener('click', () => { if (!picked) select(i); });
  });

  // thumb-zone strip — the selected card's FATE + the Claim seal
  const bottom = document.createElement('div');
  Object.assign(bottom.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', flex: '0 0 auto', minHeight: '44px', paddingBottom: '2px' } as Partial<CSSStyleDeclaration>);
  const fateLine = document.createElement('div');
  Object.assign(fateLine.style, { fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 'clamp(12px,2.3vw,17px)', color: 'rgba(222,182,132,0.92)', textAlign: 'center', minHeight: '1.2em', lineHeight: '1.2', opacity: '0', transition: 'opacity 0.25s' } as Partial<CSSStyleDeclaration>);
  const claim = document.createElement('button');
  claim.textContent = 'Claim this Fate';
  Object.assign(claim.style, { fontFamily: FONT_UI, fontSize: '12px', fontWeight: '700', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#f3e6cf', background: 'radial-gradient(circle at 50% 35%, #b8281f, #a4231c)', border: '1px solid #5e120d', borderRadius: '40px', padding: '9px 26px', minHeight: '42px', cursor: 'pointer', boxShadow: '0 3px 12px rgba(120,20,16,0.5), inset 0 1px 2px rgba(255,255,255,0.22)', opacity: '0.3', pointerEvents: 'none', transition: 'opacity 0.2s' } as Partial<CSSStyleDeclaration>);
  claim.onclick = () => { if (selected >= 0 && !picked) claimCard(selected); };
  bottom.append(fateLine, claim);
  s.body.appendChild(bottom);

  function select(i: number): void {
    selected = i;
    cols.forEach((c, j) => {
      const on = j === i;
      c.style.transform = on ? 'translateY(-10px) scale(1.04)' : 'scale(0.92)';
      c.style.opacity = on ? '1' : '0.46';
    });
    fateLine.textContent = dealt[i].fate;
    fateLine.style.opacity = '1';
    claim.style.opacity = '1'; claim.style.pointerEvents = 'auto';
  }

  function claimCard(i: number): void {
    picked = true; grantCard(dealt[i].id);
    cols.forEach((c, j) => { if (j !== i) { c.style.opacity = '0'; c.style.transform = 'translateY(26px)'; } });
    cols[i].style.transform = 'translateY(-18px) scale(1.1)';
    claim.style.pointerEvents = 'none';
    setTimeout(() => s.close(), 560);
  }

  for (const { img, id } of fronts) img.src = `${BASE}cards/${id}.webp`;
  s.open();
}

/** A face <img> filling the flip plane (src set after deal). */
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
