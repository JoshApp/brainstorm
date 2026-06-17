// THE READING — fate deals you three, you keep one.
//
// The dealt-3-pick-1 draw (the Self scope of the card mechanic — see
// docs/THE-CARDS.md). Opens at the bonfire: three minor cards are dealt
// face-up, you tap one to claim it into your Spread (grantCard → it feeds the
// stat pipeline immediately, like any other modifier source).
//
// Faces are data-driven for now (name · sigil · domain colour · fate line) —
// the AI art on the card face + the 3D quad/flip presentation are the next
// layer; this proves the LOOP, shippable today.

import { createSheet, type Sheet } from './menu-shell';
import { isScreenOpen } from './screen-manager';
import { THEME, FONT_UI, displayHeading, applyCarvedFrame } from './theme';
import { CARDS, dealCards, type CardSpec } from '../content/cards';
import { grantCard, getHeldCards } from '../state/run-state';
import { DOMAIN_VISUAL } from '../art/domains';

const SCREEN_ID = 'card-reading';

/** Open the bonfire reading. `onDone` fires after a pick (or if nothing to
 *  deal), so the caller can e.g. spend the draw / disable its button. */
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
    'radial-gradient(120% 90% at 50% 120%, rgba(120, 56, 18, 0.5) 0%, rgba(30, 16, 9, 0.97) 52%, rgba(14, 9, 6, 0.98) 100%)';

  const intro = displayHeading('The fire deals your fate', { size: 17, glow: true });
  intro.style.textAlign = 'center';
  intro.style.margin = '6px 0 4px';
  s.body.appendChild(intro);
  const sub = document.createElement('div');
  sub.textContent = 'Three are turned. Keep one.';
  Object.assign(sub.style, { fontFamily: FONT_UI, fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: THEME.faint, textAlign: 'center', marginBottom: '18px' } as Partial<CSSStyleDeclaration>);
  s.body.appendChild(sub);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', paddingBottom: '8px' } as Partial<CSSStyleDeclaration>);
  for (const card of dealt) {
    row.appendChild(cardFace(card, () => {
      if (picked) return;
      picked = true;
      grantCard(card.id);
      s.close();
    }));
  }
  s.body.appendChild(row);
  s.open();
}

/** A single dealt card face — the whole card is the tap target. */
function cardFace(card: CardSpec, onPick: () => void): HTMLElement {
  const dv = card.domains[0] ? DOMAIN_VISUAL[card.domains[0]] : undefined;
  const accent = dv?.color ?? THEME.amber;

  const btn = document.createElement('button');
  Object.assign(btn.style, {
    position: 'relative', width: '168px', minHeight: '252px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 14px 16px', background: `linear-gradient(180deg, ${THEME.raised} 0%, ${THEME.panel} 60%)`,
    border: `1px solid ${THEME.ruleStrong}`, borderRadius: '4px', color: THEME.text,
    fontFamily: FONT_UI, boxShadow: THEME.shadow, transition: 'transform 0.12s, box-shadow 0.12s, border-color 0.12s',
  } as Partial<CSSStyleDeclaration>);
  applyCarvedFrame(btn, { tickSize: 12, inset: 6 });

  // sigil (domain mark, tinted)
  const sig = document.createElement('div');
  Object.assign(sig.style, { color: accent, lineHeight: '0', filter: `drop-shadow(0 0 6px ${accent}55)` } as Partial<CSSStyleDeclaration>);
  if (dv) sig.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">${dv.svg}</svg>`;
  btn.appendChild(sig);

  // name + arcana
  const mid = document.createElement('div');
  mid.style.textAlign = 'center';
  const name = displayHeading(card.name, { size: 15, glow: true });
  name.style.textAlign = 'center';
  mid.appendChild(name);
  const arc = document.createElement('div');
  arc.textContent = card.arcana === 'major' ? 'Major Arcana' : 'Minor';
  Object.assign(arc.style, { fontFamily: FONT_UI, fontSize: '8px', letterSpacing: '0.28em', textTransform: 'uppercase', color: card.arcana === 'major' ? THEME.amber : THEME.dim, marginTop: '6px' } as Partial<CSSStyleDeclaration>);
  mid.appendChild(arc);
  btn.appendChild(mid);

  // fate line
  const fate = document.createElement('div');
  fate.textContent = card.fate;
  Object.assign(fate.style, { fontFamily: FONT_UI, fontSize: '11px', fontStyle: 'italic', lineHeight: '1.35', color: THEME.dim, textAlign: 'center' } as Partial<CSSStyleDeclaration>);
  btn.appendChild(fate);

  btn.onpointerenter = () => { btn.style.transform = 'translateY(-6px)'; btn.style.borderColor = accent; btn.style.boxShadow = `${THEME.shadow}, 0 0 22px ${accent}44`; };
  btn.onpointerleave = () => { btn.style.transform = 'none'; btn.style.borderColor = THEME.ruleStrong; btn.style.boxShadow = THEME.shadow; };
  btn.onclick = onPick;
  return btn;
}

/** Whether the run currently holds any fate cards (for HUD/menus later). */
export function hasFateCards(): boolean {
  return getHeldCards().length > 0;
}
