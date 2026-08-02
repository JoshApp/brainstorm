// THE READING — fate deals you three; you keep one.
//
// A FULL-BLEED standalone screen (not a centred dialog): it owns the whole
// viewport edge-to-edge — no floating box, no margin, no ✕. The exit IS the action
// (claim a card); system-back is the only escape hatch. This is the mobile-first
// pattern for a primary moment (docs/UI-CHARTER.md), vs createSheet's dialog frame.
//
// Layout (flex column, full height): a thin title hugs the TOP edge; the three
// cards are the HERO and fill the middle; the chosen fate + the Claim seal hug the
// BOTTOM edge (thumb zone). Each card shows what it DOES (formatModifier) so you
// compare before committing; tap to select → its FATE (one-line identity) appears.

import { openScreen, closeScreen, isScreenOpen } from './screen-manager';
import { FONT_UI } from './theme';
import { FONT_BLACK, FONT_SERIF } from './fonts';
import { formatModifier } from './item-format';
import { CARDS, dealCards, type CardSpec, type CardCondition, type CardSynergy, type CardTrigger } from '../content/cards';
import type { Transform } from '../combat/transforms';
import { grantCard, getHeldCards } from '../state/run-state';
import { BUFFS } from '../content/buffs';
import { flashDomainGlow } from './vignette';
import { showInscription } from './inscription';
import { domainVisual } from './domain-icons';

const SCREEN_ID = 'card-reading';
const BASE = import.meta.env.BASE_URL;

// Harness hook: while a reading is open, this selects+claims card `i`. Cleared on
// close. Lets the bot RESOLVE the draw (a fate draw must be PICKED, not dismissed —
// dismissing leaves the fate gate armed + the safe-room stairs sealed).
let activePick: ((i: number) => void) | null = null;

/** DEV/harness: auto-pick the first dealt card of an open reading (grants it +
 *  clears the fate gate). No-op returning false if no reading is open. */
export function autoPickFirstCard(): boolean {
  if (!activePick) return false;
  activePick(0);
  return true;
}
const CARD_ASPECT = '768 / 1312';
// Card height bounded by BOTH viewport height (60vh) AND width (46vw — so three
// + gaps always fit across), floored + capped. Fills the screen without a fragile
// flex-aspect grow that would blow the cards too wide on a tall/landscape tablet.
const CARD_H = 'clamp(150px, min(60vh, 46vw), 360px)';
const AMBER = 'rgba(232, 188, 120, 0.98)';
// safe-area-aware edge padding (landscape notches live on the sides)
const PAD_X = 'max(18px, env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px))';

/** Readable phrase for a conditional's predicate (BRINK). */
function conditionPhrase(c: CardCondition): string {
  const pct = Math.round(c.value * 100);
  return c.kind === 'below-hp-pct' ? `while below ${pct}% life` : `while above ${pct}% life`;
}

/** Readable phrase for a synergy's "per X" count basis (RESONANCE). */
function synergyPer(s: CardSynergy): string {
  return s.per === 'card' ? 'per fate held'
    : s.per === 'major' ? 'per major held'
    : s.per === 'minor' ? 'per minor held'
    : `per ${s.domain} card`;
}

/** Readable phrase for a proc (PROC). Reads the unified EffectSpec — names the
 *  buff via its registry label, or describes a heal/damage effect. */
function triggerPhrase(t: CardTrigger): string {
  const e = t.effect;
  const what = e.type === 'apply-buff' ? (BUFFS[e.buffId ?? '']?.displayName ?? e.buffId ?? 'a hex').toLowerCase()
    : e.type === 'heal' ? 'you mend'
    : 'they wound';
  const when = t.on === 'kill' ? 'on a kill' : t.on === 'crit' ? 'on a crit' : 'on hit';
  const odds = t.chance < 1 ? ` (${Math.round(t.chance * 100)}%)` : '';
  return `${when}: ${what}${odds}`;
}

/** Readable phrase for a TRANSFORM — the rule this card REWRITES. These are the
 *  defining verbs of the grotesque majors (Red Thirst et al.) and were invisible
 *  in the reading before, so a transform card showed only its side-triggers and
 *  read as doing almost nothing. Named plainly so you know the pact you're taking. */
function transformPhrase(t: Transform): string {
  if (t.rule === 'suppress-passive-heal') return 'no mending but by the blade';
  if (t.rule === 'hp-drain') {
    return t.per === 'out-of-combat' ? 'bleed at rest, down to half' : 'lose life with each descent';
  }
  return '';
}

/** What the card DOES, terse — covers all five verb-types so you can compare
 *  before committing: transform (the rule it rewrites), passive (PACT),
 *  conditional (BRINK), synergy (RESONANCE), trigger (PROC). Transforms lead —
 *  they're the card's identity. */
function effectLines(card: CardSpec): string[] {
  const e = card.effect;
  const out: string[] = [];
  for (const t of e.transform ?? []) { const p = transformPhrase(t); if (p) out.push(p); }
  for (const m of e.modifiers ?? []) out.push(formatModifier(m));
  for (const c of e.conditional ?? []) {
    for (const m of c.modifiers) out.push(`${formatModifier(m)} · ${conditionPhrase(c.condition)}`);
  }
  for (const s of e.synergy ?? []) {
    for (const m of s.modifiers) out.push(`${formatModifier(m)} · ${synergyPer(s)}`);
  }
  for (const t of e.triggers ?? []) out.push(triggerPhrase(t));
  return out;
}

export function openCardReading(
  opts: { arcana?: 'minor' | 'major'; onDone?: (picked: boolean) => void } = {},
): void {
  if (isScreenOpen(SCREEN_ID)) return;
  const arcana = opts.arcana ?? 'minor';
  const dealt = dealCards(3, { arcana }).map((id) => CARDS[id]).filter(Boolean) as CardSpec[];
  if (dealt.length === 0) { opts.onDone?.(false); return; }

  let picked = false;
  let selected = -1;
  const cols: HTMLElement[] = [];
  const fronts: Array<{ img: HTMLImageElement; id: string }> = [];

  // ── full-bleed root ────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = `${SCREEN_ID}-screen`;
  Object.assign(root.style, {
    position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center',
    background: 'radial-gradient(130% 100% at 50% 128%, rgba(122,58,18,0.62) 0%, rgba(28,15,8,0.98) 52%, rgba(8,5,3,1) 100%)',
    color: AMBER, fontFamily: FONT_UI, overflow: 'hidden',
    paddingTop: 'max(10px, env(safe-area-inset-top, 0px))',
    paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
  } as Partial<CSSStyleDeclaration>);

  // ── title — hugs the top edge, thin ──
  const title = document.createElement('div');
  // Majors are the rare, weighty draw (the boss/harbor fire) — they get the
  // grave "Choose Your Fate". Minors are the frequent found-fire draw — lighter.
  title.textContent = arcana === 'major' ? 'Choose Your Fate' : 'The Cards Turn';
  Object.assign(title.style, { fontFamily: FONT_BLACK, fontWeight: '700', fontSize: 'clamp(19px,4vw,34px)', lineHeight: '1', letterSpacing: '0.03em', color: AMBER, textShadow: '0 0 24px rgba(180,90,30,0.55)', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  root.appendChild(title);

  // ── cards — the HERO, fills the middle ──
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: 'clamp(12px,3.5vw,44px)', justifyContent: 'center', alignItems: 'center', flex: '1 1 auto', minHeight: '0', width: '100%', padding: `6px ${PAD_X}` } as Partial<CSSStyleDeclaration>);
  root.appendChild(row);

  dealt.forEach((card, i) => {
    const col = document.createElement('div');
    Object.assign(col.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'clamp(4px,1vh,9px)', cursor: 'pointer', opacity: '0', transition: 'transform 0.18s, opacity 0.22s', perspective: '1000px', willChange: 'transform' } as Partial<CSSStyleDeclaration>);
    cols.push(col);

    const flip = document.createElement('div');
    Object.assign(flip.style, { position: 'relative', flex: '0 0 auto', height: CARD_H, aspectRatio: CARD_ASPECT, transformStyle: 'preserve-3d', transform: 'rotateY(180deg)', transition: 'transform 0.55s cubic-bezier(0.2,0.8,0.2,1)' } as Partial<CSSStyleDeclaration>);
    const front = faceImg();
    fronts.push({ img: front, id: card.id });
    flip.append(faceBack(), front);
    col.appendChild(flip);

    const name = document.createElement('div');
    name.textContent = card.name;
    Object.assign(name.style, { fontFamily: FONT_SERIF, fontWeight: '600', fontSize: 'clamp(13px,2.4vw,19px)', color: '#e8d8b8', textAlign: 'center', lineHeight: '1.1', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
    col.appendChild(name);

    const fx = document.createElement('div');
    fx.textContent = effectLines(card).join('  ·  ');
    Object.assign(fx.style, { fontFamily: FONT_UI, fontSize: 'clamp(9px,1.7vw,12px)', letterSpacing: '0.02em', color: 'rgba(208,178,128,0.82)', textAlign: 'center', lineHeight: '1.3', maxWidth: '15em', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
    col.appendChild(fx);

    row.appendChild(col);
    setTimeout(() => { flip.style.transform = 'rotateY(0deg)'; col.style.opacity = '1'; }, 300 + i * 165);
    col.addEventListener('click', () => { if (!picked) select(i); });
  });

  // ── fate + claim — hug the bottom edge (thumb zone) ──
  const bottom = document.createElement('div');
  Object.assign(bottom.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', flex: '0 0 auto', minHeight: '46px', width: '100%', padding: `0 ${PAD_X}` } as Partial<CSSStyleDeclaration>);
  const fateLine = document.createElement('div');
  Object.assign(fateLine.style, { fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 'clamp(13px,2.5vw,19px)', color: 'rgba(222,182,132,0.92)', textAlign: 'center', minHeight: '1.2em', lineHeight: '1.2', opacity: '0', transition: 'opacity 0.25s' } as Partial<CSSStyleDeclaration>);
  const claim = document.createElement('button');
  claim.textContent = 'Claim this Fate';
  Object.assign(claim.style, { fontFamily: FONT_UI, fontSize: '13px', fontWeight: '700', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#f3e6cf', background: 'radial-gradient(circle at 50% 35%, #b8281f, #a4231c)', border: '1px solid #5e120d', borderRadius: '40px', padding: '12px 34px', minHeight: '46px', cursor: 'pointer', boxShadow: '0 4px 16px rgba(120,20,16,0.55), inset 0 1px 2px rgba(255,255,255,0.22)', opacity: '0.3', pointerEvents: 'none', transition: 'opacity 0.2s, transform 0.1s' } as Partial<CSSStyleDeclaration>);
  claim.addEventListener('pointerdown', () => { if (selected >= 0) claim.style.transform = 'scale(0.97)'; });
  claim.addEventListener('pointerup', () => { claim.style.transform = 'scale(1)'; });
  claim.onclick = () => { if (selected >= 0 && !picked) claimCard(selected); };
  bottom.append(fateLine, claim);
  root.appendChild(bottom);

  function select(i: number): void {
    selected = i;
    cols.forEach((c, j) => {
      const on = j === i;
      c.style.transform = on ? 'translateY(-8px) scale(1.05)' : 'scale(0.9)';
      c.style.opacity = on ? '1' : '0.42';
    });
    fateLine.textContent = dealt[i].fate;
    fateLine.style.opacity = '1';
    claim.style.opacity = '1'; claim.style.pointerEvents = 'auto';
  }

  function claimCard(i: number): void {
    picked = true; grantCard(dealt[i].id);
    const card = dealt[i];
    // The two unchosen fates sink away; the taken one is DRAWN INTO YOU.
    cols.forEach((c, j) => { if (j !== i) { c.style.opacity = '0'; c.style.transform = 'translateY(28px)'; } });
    claim.style.pointerEvents = 'none'; claim.style.opacity = '0';
    fateLine.style.opacity = '0';

    // The fate's DOMAIN floods the screen as it enters you (the acquisition
    // language, tuned strong for a major beat), and the deep marks the taking.
    const dom = card.domains[0];
    const accent = dom ? domainVisual(dom).color : 'rgb(206,64,52)';
    // The flood is fired late, so its bloom lands as the modal closes and washes
    // over the GAME view (behind the modal it'd be invisible) — the fate's domain
    // pouring into you as you return to the dark.
    setTimeout(() => { try { flashDomainGlow(accent, 1); } catch { /* presentation */ } }, 760);
    // NO top-right pop (that channel is reserved for achievements + genuine
    // firsts) — taking a fate is diegetic: the domain flood + the reading-channel
    // inscription carry it, not an out-of-run notification.
    // READ the fate as it enters you — the card's identity line rises through the
    // reading channel (the same inscription trinkets/relics use), fired as the
    // modal dissolves so it lands on the game view, not behind the card.
    setTimeout(() => { try { showInscription(card.fate); } catch { /* presentation */ } }, 900);

    // The chosen card IGNITES then is pulled down into the delver, dissolving to
    // embers — "you took it into yourself", not "a menu closed".
    igniteEmbers(cols[i], accent);
    cols[i].animate(
      [
        { transform: 'translateY(-14px) scale(1.12)', filter: 'brightness(1)', opacity: 1, offset: 0 },
        { transform: 'translateY(-46px) scale(1.32)', filter: `brightness(1.9) saturate(1.4) drop-shadow(0 0 26px ${accent})`, opacity: 1, offset: 0.28 },
        { transform: 'translateY(70vh) scale(0.12)', filter: `brightness(2.4) blur(3px) drop-shadow(0 0 30px ${accent})`, opacity: 0, offset: 1 },
      ],
      { duration: 900, easing: 'cubic-bezier(0.5, 0, 0.75, 0.2)', fill: 'forwards' },
    );
    setTimeout(close, 1000);
  }

  // A short-lived warm flame-wash + rising embers over the taken card, so it
  // reads as BURNING as it's drawn in (not just shrinking).
  function igniteEmbers(host: HTMLElement, accent: string): void {
    if (!host.style.position) host.style.position = 'relative';
    const flame = document.createElement('div');
    Object.assign(flame.style, {
      position: 'absolute', inset: '-8%', borderRadius: '8px', pointerEvents: 'none',
      background: `radial-gradient(ellipse at 50% 60%, ${accent} 0%, rgba(255,150,60,0.5) 35%, transparent 70%)`,
      mixBlendMode: 'screen', opacity: '0',
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(flame);
    flame.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], { duration: 820, easing: 'ease-out' });
    for (let k = 0; k < 8; k++) {
      const e = document.createElement('div');
      const sz = 3 + Math.round((k % 3) * 2);
      Object.assign(e.style, {
        position: 'absolute', left: `${18 + (k * 9) % 64}%`, bottom: '32%',
        width: `${sz}px`, height: `${sz}px`, borderRadius: '50%',
        background: k % 2 ? accent : 'rgba(255,180,90,0.95)',
        boxShadow: `0 0 6px ${accent}`, pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>);
      host.appendChild(e);
      e.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 0.95 },
          { transform: `translate(${(k % 2 ? 1 : -1) * (10 + k * 3)}px, ${-40 - k * 8}px) scale(0.2)`, opacity: 0 },
        ],
        { duration: 560 + k * 40, easing: 'ease-out', fill: 'forwards' },
      );
    }
  }

  function close(): void {
    if (!root.isConnected) return;
    activePick = null;
    root.remove();
    closeScreen(SCREEN_ID);
    opts.onDone?.(picked);
  }

  // Expose select+claim for the harness bot (resolve the draw by picking).
  activePick = (i: number) => { if (!picked && dealt[i]) { select(i); claimCard(i); } };

  for (const { img, id } of fronts) img.src = `${BASE}cards/${id}.webp`;
  document.body.appendChild(root);
  openScreen({ id: SCREEN_ID, root, policy: { layer: 'modal', hidesHud: true, dimsScene: true }, onDismissRequest: close });
}

// The deep's line as a fate is taken — the voice in the deep, cruel + amused,
// present-tense. Not the in-world grimdark register; this is IT talking about you.
const CLAIM_LINES = [
  (n: string) => `${n} is yours now. It was always going to be.`,
  (n: string) => `You took ${n} into yourself. The deep felt it go in.`,
  (n: string) => `${n}. A fine choice, or a fine mistake. I do enjoy both.`,
  (n: string) => `You wear ${n} now, whether you meant to or not.`,
];
let claimLineIdx = 0;
function claimLine(name: string): string {
  const f = CLAIM_LINES[claimLineIdx % CLAIM_LINES.length];
  claimLineIdx++;
  return f(name);
}

/** A face <img> filling the flip plane (src set after deal). */
function faceImg(): HTMLImageElement {
  const el = document.createElement('img');
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', backfaceVisibility: 'hidden', display: 'block', filter: 'drop-shadow(0 5px 14px rgba(0,0,0,0.75))' } as Partial<CSSStyleDeclaration>);
  return el;
}

function faceBack(): HTMLImageElement {
  const el = document.createElement('img');
  el.src = `${BASE}cards/back.webp`; el.alt = 'card back';
  Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: '4px', display: 'block', filter: 'drop-shadow(0 5px 14px rgba(0,0,0,0.75))' } as Partial<CSSStyleDeclaration>);
  return el;
}

/** Whether the run currently holds any fate cards (for HUD/menus later). */
export function hasFateCards(): boolean {
  return getHeldCards().length > 0;
}
