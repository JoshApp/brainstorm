import { isScreenOpen } from './screen-manager';
import { createSheet, menuButton, type Sheet } from './menu-shell';
import {
  getCharacter,
  onCharacterChanged,
  spendAttributePoint,
  type AttributeKind,
} from '../state/character';
import { getLevel, getXpInLevel, getXpForNextLevel } from '../state/run-state';
import { ATTR_DEFS } from './attribute-defs';

// ── THE BONFIRE — sit, and the fire takes your measure ───────────────
//
// The payoff screen. Resting at any bonfire opens this; it's where the
// levels you earned in the dark actually become STRENGTH. Big, warm,
// mobile-native: a hero LEVEL plate over the embers, a glowing count of
// what you have to spend, and four broad attribute cards you tap to
// raise. Spending is allowed HERE and only here — you carry your unspent
// points until you find a fire and commit them (Souls pacing, ungated
// from "safe rooms only" so every bonfire is a real rest).
//
// The tome pillar reads the same numbers back to you, but it never lets
// you change them — the book reflects, the fire grows.

const SCREEN_ID = 'levelup';
const FONT_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

interface CardRefs {
  kind: AttributeKind;
  root: HTMLButtonElement;
  valueEl: HTMLDivElement;
  plus: HTMLDivElement;
}

let sheet: Sheet | null = null;
let unsub: (() => void) | null = null;
let levelEl: HTMLDivElement | null = null;
let barFill: HTMLDivElement | null = null;
let barText: HTMLDivElement | null = null;
let pointsBanner: HTMLDivElement | null = null;
let cards: CardRefs[] = [];

export function openLevelUpMenu(): void {
  if (isScreenOpen(SCREEN_ID)) return;

  const s = createSheet({
    id: SCREEN_ID,
    width: 900,
    layer: 'modal',
    policy: { hidesHud: true, dimsScene: true },
    onClose() {
      unsub?.();
      unsub = null;
      sheet = null;
      levelEl = null;
      barFill = null;
      barText = null;
      pointsBanner = null;
      cards = [];
    },
  });
  sheet = s;

  // Warm the panel from the embers up — a radial glow rising off the
  // bottom-centre (where the fire sits in the world) sells "you are at
  // the fire" without any art.
  s.root.style.background =
    'radial-gradient(120% 85% at 50% 118%, rgba(120, 56, 18, 0.55) 0%, rgba(40, 20, 10, 0.97) 48%, rgba(16, 10, 7, 0.98) 100%)';
  s.root.style.boxShadow = '0 8px 48px rgba(0, 0, 0, 0.92), 0 0 80px rgba(180, 90, 30, 0.18)';

  s.body.appendChild(buildHero());
  s.body.appendChild(buildPointsBanner());
  s.body.appendChild(buildCardGrid());

  s.footer.appendChild(menuButton('RISE', () => s.close(), { primary: true }));

  unsub = onCharacterChanged(refresh);
  refresh();
  s.open();
}

export function closeLevelUpMenu(): void {
  sheet?.close();
}

// ── Hero: the LEVEL plate + XP bar ───────────────────────────────────
function buildHero(): HTMLDivElement {
  const hero = document.createElement('div');
  Object.assign(hero.style, {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '6px', padding: '4px 0 2px',
  } as Partial<CSSStyleDeclaration>);

  const eyebrow = document.createElement('div');
  eyebrow.textContent = 'THE FIRE TAKES YOUR MEASURE';
  Object.assign(eyebrow.style, {
    fontSize: '10px', letterSpacing: '0.42em',
    color: 'rgba(220, 150, 90, 0.62)',
    textTransform: 'uppercase',
  } as Partial<CSSStyleDeclaration>);
  hero.appendChild(eyebrow);

  levelEl = document.createElement('div');
  Object.assign(levelEl.style, {
    fontFamily: FONT_SERIF,
    fontSize: 'clamp(34px, 8vh, 60px)',
    fontWeight: '600',
    letterSpacing: '0.04em',
    lineHeight: '1.05',
    color: 'rgba(255, 224, 178, 0.98)',
    textShadow: '0 0 26px rgba(255, 150, 60, 0.55), 0 2px 4px rgba(0, 0, 0, 0.8)',
  } as Partial<CSSStyleDeclaration>);
  hero.appendChild(levelEl);

  // XP bar — thin ember line under the level.
  const barWrap = document.createElement('div');
  Object.assign(barWrap.style, {
    width: 'min(360px, 70%)', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: '4px', marginTop: '2px',
  } as Partial<CSSStyleDeclaration>);
  const track = document.createElement('div');
  Object.assign(track.style, {
    width: '100%', height: '5px', borderRadius: '3px',
    background: 'rgba(50, 30, 18, 0.9)', overflow: 'hidden',
    border: '1px solid rgba(120, 70, 40, 0.4)',
  } as Partial<CSSStyleDeclaration>);
  barFill = document.createElement('div');
  Object.assign(barFill.style, {
    height: '100%', width: '0%',
    background: 'linear-gradient(to right, rgba(200, 110, 40, 0.95), rgba(255, 200, 110, 0.98))',
    boxShadow: '0 0 8px rgba(255, 170, 70, 0.6)',
    transition: 'width 0.3s ease',
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(barFill);
  barText = document.createElement('div');
  Object.assign(barText.style, {
    fontSize: '10px', fontFamily: 'monospace',
    color: 'rgba(200, 160, 120, 0.6)', letterSpacing: '0.1em',
  } as Partial<CSSStyleDeclaration>);
  barWrap.append(track, barText);
  hero.appendChild(barWrap);

  return hero;
}

// ── Points banner — the headline of WHY you're here ──────────────────
function buildPointsBanner(): HTMLDivElement {
  pointsBanner = document.createElement('div');
  Object.assign(pointsBanner.style, {
    textAlign: 'center', margin: '10px 0 4px',
    fontSize: '14px', fontWeight: '700', letterSpacing: '0.18em',
    transition: 'color 0.2s ease, text-shadow 0.2s ease',
  } as Partial<CSSStyleDeclaration>);
  return pointsBanner;
}

// ── The four attribute cards ─────────────────────────────────────────
function buildCardGrid(): HTMLDivElement {
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
    gap: '10px', marginTop: '6px',
  } as Partial<CSSStyleDeclaration>);

  cards = ATTR_DEFS.map((def) => {
    // The whole card is the tap target — broad, thumb-friendly, no
    // fiddly little +. A lit border + the corner + mark say "raise me".
    const card = document.createElement('button');
    card.setAttribute('aria-label', `raise ${def.label}`);
    Object.assign(card.style, {
      position: 'relative',
      flex: '1 1 180px', minWidth: '160px', maxWidth: '210px',
      display: 'flex', flexDirection: 'column', gap: '4px',
      padding: '14px 14px 16px',
      background: 'rgba(34, 20, 12, 0.7)',
      border: '1px solid rgba(150, 95, 55, 0.4)',
      borderRadius: '6px',
      color: 'inherit', textAlign: 'left',
      cursor: 'default', font: 'inherit',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
      transition: 'border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
    } as Partial<CSSStyleDeclaration>);

    const top = document.createElement('div');
    Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as Partial<CSSStyleDeclaration>);
    const label = document.createElement('div');
    label.textContent = def.label;
    Object.assign(label.style, {
      fontSize: '13px', fontWeight: '700', letterSpacing: '0.2em',
      color: 'rgba(255, 222, 180, 0.95)',
    } as Partial<CSSStyleDeclaration>);
    const tagline = document.createElement('div');
    tagline.textContent = def.tagline;
    Object.assign(tagline.style, {
      fontSize: '9px', letterSpacing: '0.24em',
      color: 'rgba(200, 130, 80, 0.55)',
    } as Partial<CSSStyleDeclaration>);
    top.append(label, tagline);

    const valueEl = document.createElement('div');
    Object.assign(valueEl.style, {
      fontFamily: FONT_SERIF, fontSize: '40px', fontWeight: '600',
      lineHeight: '1', color: 'rgba(255, 235, 200, 0.98)',
      textShadow: '0 2px 4px rgba(0, 0, 0, 0.7)',
      transition: 'transform 0.18s cubic-bezier(0.2, 1.4, 0.4, 1)',
    } as Partial<CSSStyleDeclaration>);

    const effect = document.createElement('div');
    effect.textContent = def.effect;
    Object.assign(effect.style, {
      fontSize: '11px', fontStyle: 'italic', lineHeight: '1.4',
      color: 'rgba(200, 160, 125, 0.72)',
    } as Partial<CSSStyleDeclaration>);

    // The "raise" mark — a + that lights only when points remain.
    const plus = document.createElement('div');
    plus.textContent = '+';
    Object.assign(plus.style, {
      position: 'absolute', right: '12px', bottom: '10px',
      width: '30px', height: '30px', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '20px', fontWeight: '700', lineHeight: '1',
      color: 'rgba(255, 230, 160, 0.98)',
      background: 'rgba(120, 70, 30, 0.85)',
      border: '1px solid rgba(255, 190, 110, 0.7)',
      boxShadow: '0 0 14px rgba(255, 160, 70, 0.5)',
      opacity: '0', transition: 'opacity 0.18s ease',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    card.append(top, valueEl, effect, plus);
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      if (getCharacter().unspentPoints <= 0) return;
      if (spendAttributePoint(def.kind)) {
        // Pop the number — refresh() (via onCharacterChanged) writes the
        // new value; the transform replay reads as a punch of growth.
        valueEl.style.transform = 'scale(1.35)';
        void valueEl.offsetWidth;
        requestAnimationFrame(() => { valueEl.style.transform = 'scale(1)'; });
      }
    });

    grid.appendChild(card);
    return { kind: def.kind, root: card, valueEl, plus };
  });

  return grid;
}

// ── Reactive refresh — runs on open + every character change ─────────
function refresh(): void {
  if (!levelEl || !barFill || !barText || !pointsBanner) return;
  const c = getCharacter();
  const points = c.unspentPoints;

  levelEl.textContent = `LEVEL ${getLevel()}`;

  const inLevel = getXpInLevel();
  const forNext = getXpForNextLevel();
  barFill.style.width = forNext > 0 ? `${Math.min(100, (inLevel / forNext) * 100)}%` : '100%';
  barText.textContent = `${inLevel} / ${forNext} to next`;

  if (points > 0) {
    pointsBanner.textContent = points === 1 ? '1 POINT TO SPEND' : `${points} POINTS TO SPEND`;
    pointsBanner.style.color = 'rgba(255, 214, 130, 0.98)';
    pointsBanner.style.textShadow = '0 0 18px rgba(255, 170, 70, 0.6)';
  } else {
    pointsBanner.textContent = 'nothing more to give — for now';
    pointsBanner.style.color = 'rgba(180, 140, 105, 0.55)';
    pointsBanner.style.textShadow = 'none';
    pointsBanner.style.fontStyle = 'italic';
    pointsBanner.style.fontWeight = '400';
  }
  if (points > 0) { pointsBanner.style.fontStyle = 'normal'; pointsBanner.style.fontWeight = '700'; }

  const canSpend = points > 0;
  for (const card of cards) {
    card.valueEl.textContent = String(c.attributes[card.kind]);
    card.plus.style.opacity = canSpend ? '1' : '0';
    card.root.style.cursor = canSpend ? 'pointer' : 'default';
    card.root.style.borderColor = canSpend ? 'rgba(255, 175, 95, 0.7)' : 'rgba(150, 95, 55, 0.35)';
    card.root.style.boxShadow = canSpend ? '0 0 20px rgba(200, 100, 40, 0.22)' : 'none';
    card.root.style.background = canSpend ? 'rgba(48, 28, 16, 0.78)' : 'rgba(30, 18, 11, 0.6)';
  }
}
