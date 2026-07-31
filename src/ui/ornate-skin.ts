// ── ORNATE UI SKIN — "the interface belongs inside the dungeon" ──────────────
//
// A PROTOTYPE reskin of the in-game HUD toward the illuminated-manuscript look:
// aged-parchment cards with inked thorn frames + wax seals, and forged-brass
// rings around the touch controls, instead of the clean floating circles.
//
// Design intent (from the concept pass): the UI stops reading as "modern app
// over a retro game" and starts reading as ritual objects — carved stone,
// brass engraving, parchment, wax. It's the single biggest "that's Delve"
// identity lever that carries NO renderer risk, because it's pure DOM/CSS/SVG.
//
// ── How it works (why it doesn't touch any widget) ───────────────────────────
// The HUD widgets keep their markup + inline styles. This module injects ONE
// stylesheet scoped under `:root[data-ui="ornate"]` that overrides the visual
// properties with `!important` (inline styles otherwise win). Nothing here
// changes layout, hit-testing, or logic — only paint. Flip it off and the
// original look returns byte-for-byte.
//
//   Gate:  ?ui=ornate     (default off → live A/B, same as the grade presets)
//   DEV:   window.__ui('ornate' | 'classic')   toggle live on the phone
//
// Targets (all pre-existing, stable ids):
//   #pickup-notification  the item toast ("A USURER'S SEAL")  → manuscript card
//   #note-card            corpse-note reading overlay         → manuscript + drop-cap
//   #health-hearts        the hearts row                      → carved plaque
//   #rite-button          the RITE action                     → forged brass ring
//   #consumable-bar       the flask                           → forged brass ring
//   #gold-hud             the gold count                      → brass cartouche
//   #depth-counter        the DEPTH label                     → carved header + rule

import { FONT_DISPLAY, FONT_TITLE } from './theme';

/** URL-encode an inline SVG as a data URI (small, cache-free, CSP-safe). */
function svg(markup: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

// Inked thorn-and-filigree frame, authored as a border-image source: a gold
// hairline rectangle with a curled bracket + stud at each corner. border-image
// slices the corners out (preserved) and tiles the straight edges between them,
// so any card size gets a proportional ornate frame from one 120×120 asset.
const CORNER = `
  <g fill="none" stroke="%COL%" stroke-width="2" stroke-linecap="round">
    <path d="M9 34 L9 15 Q9 9 15 9 L34 9"/>
    <path d="M16 16 q7 -1 11 3"/>
  </g>
  <circle cx="9" cy="9" r="2.4" fill="%COL%"/>`;
function frameSvg(col = '#c9a75a'): string {
  const c = CORNER.replaceAll('%COL%', col);
  return svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>` +
      // straight frame lines (become the repeated edge slices)
      `<rect x='9' y='9' width='102' height='102' fill='none' stroke='${col}' stroke-width='1' opacity='0.55'/>` +
      // four corner flourishes (preserved corner slices)
      `<g>${c}</g>` +
      `<g transform='translate(120,0) scale(-1,1)'>${c}</g>` +
      `<g transform='translate(0,120) scale(1,-1)'>${c}</g>` +
      `<g transform='translate(120,120) scale(-1,-1)'>${c}</g>` +
      `</svg>`,
  );
}

// Red wax seal with an inked sigil — hangs off the left edge of the item card.
const SEAL = svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44'>` +
    `<circle cx='22' cy='22' r='19' fill='#6f1310' stroke='#340a08' stroke-width='2.5'/>` +
    `<circle cx='22' cy='22' r='19' fill='none' stroke='#a53a2c' stroke-width='1' opacity='0.55'/>` +
    `<path d='M22 10 L22 34 M14 17 L30 17' stroke='#3d0b09' stroke-width='2.6' fill='none' stroke-linecap='round'/>` +
    `<circle cx='22' cy='27' r='2.2' fill='#3d0b09'/>` +
    `</svg>`,
);

// Small skull-and-rule ornament for the DEPTH header.
const SKULL_RULE = svg(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='16' viewBox='0 0 120 16'>` +
    `<line x1='0' y1='8' x2='46' y2='8' stroke='#8a6f3e' stroke-width='1'/>` +
    `<line x1='74' y1='8' x2='120' y2='8' stroke='#8a6f3e' stroke-width='1'/>` +
    `<path d='M60 3 a6 6 0 0 1 6 6 v2 a3 3 0 0 1 -3 3 h-6 a3 3 0 0 1 -3 -3 v-2 a6 6 0 0 1 6 -6 z' fill='#8a6f3e'/>` +
    `<circle cx='57.5' cy='8.5' r='1.4' fill='#160f09'/><circle cx='62.5' cy='8.5' r='1.4' fill='#160f09'/>` +
    `</svg>`,
);

// Parchment fill shared by the manuscript cards.
const PARCHMENT =
  'radial-gradient(130% 150% at 50% -10%, rgba(60,44,26,0.98), rgba(22,15,9,0.985))';

// Forged-brass ring: a beveled metallic border + an outer engraved ring drawn
// as a masked conic-gradient pseudo-element (border-image can't round, so the
// ring is a ::before). Applied to the circular touch buttons.
function brassRing(selector: string, keepBg?: string): string {
  const bg = keepBg ? `background: ${keepBg} !important;` : '';
  return `
  :root[data-ui="ornate"] ${selector} {
    ${bg}
    border: 2px solid #b28a3c !important;
    box-shadow:
      0 0 0 1px rgba(0,0,0,0.7),
      inset 0 0 0 1px rgba(38,24,10,0.85),
      inset 0 2px 6px rgba(255,214,140,0.18),
      inset 0 -4px 9px rgba(0,0,0,0.6),
      0 5px 16px rgba(0,0,0,0.6) !important;
  }
  :root[data-ui="ornate"] ${selector}::before {
    content: ''; position: absolute; inset: -6px; border-radius: 50%;
    background: conic-gradient(from 210deg, #5c4018, #d8b45c, #6e5020, #e6c777, #5c4018);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
            mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
    opacity: 0.85; pointer-events: none; z-index: -1;
  }`;
}

function buildCss(): string {
  return `
  /* ── Manuscript cards: item toast + note overlay ─────────────────── */
  :root[data-ui="ornate"] #pickup-notification,
  :root[data-ui="ornate"] #note-card {
    background: ${PARCHMENT} !important;
    border: 1px solid rgba(120,86,40,0.5) !important;
    border-image: ${frameSvg()} 30 !important;
    border-image-width: 16px !important;
    border-image-outset: 5px !important;
    border-radius: 0 !important;
    box-shadow: 0 12px 38px rgba(0,0,0,0.78), inset 0 0 34px rgba(120,80,30,0.10) !important;
    font-family: ${cssFont(FONT_DISPLAY)} !important;
    color: #ecd6ad !important;
  }
  /* Item toast: hang a wax seal off the left, give the name a carved-title feel. */
  :root[data-ui="ornate"] #pickup-notification {
    padding: 13px 24px 13px 30px !important;
    overflow: visible !important;
  }
  :root[data-ui="ornate"] #pickup-notification::before {
    content: ''; position: absolute; left: -16px; top: 50%;
    width: 34px; height: 34px; margin-top: -17px;
    background: ${SEAL} center / contain no-repeat;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.65));
  }
  :root[data-ui="ornate"] #pickup-notification > div:first-child {
    font-family: ${cssFont(FONT_TITLE)} !important;
    font-style: normal !important;
    letter-spacing: 0.12em !important;
    text-transform: uppercase !important;
  }
  /* Note overlay: illuminated drop-cap on the body's first letter. */
  :root[data-ui="ornate"] #note-card { padding: 26px 30px !important; }
  :root[data-ui="ornate"] #note-card p:first-of-type::first-letter,
  :root[data-ui="ornate"] #note-card > div:first-child::first-letter {
    font-family: ${cssFont(FONT_TITLE)};
    font-size: 3.1em; line-height: 0.8; float: left;
    margin: 0.02em 0.09em -0.06em 0;
    color: #d8ab52; text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }

  /* ── Hearts: a carved parchment plaque instead of floating pips ──── */
  :root[data-ui="ornate"] #health-hearts {
    padding: 7px 16px !important;
    background: ${PARCHMENT} !important;
    border: 1px solid rgba(120,86,40,0.5) !important;
    border-image: ${frameSvg('#a6813f')} 30 !important;
    border-image-width: 13px !important;
    border-image-outset: 3px !important;
    box-shadow: 0 6px 20px rgba(0,0,0,0.6), inset 0 0 20px rgba(120,80,30,0.10) !important;
  }

  /* ── Forged-brass rings on the touch controls ────────────────────── */
  ${brassRing('#rite-button', 'radial-gradient(circle at 50% 36%, #7c1712, #470c08 72%)')}
  ${brassRing('#consumable-bar')}

  /* ── Gold: a small brass cartouche ───────────────────────────────── */
  :root[data-ui="ornate"] #gold-hud {
    padding: 4px 12px !important;
    border: 1px solid #a07f3a !important;
    border-radius: 2px !important;
    background: linear-gradient(180deg, rgba(46,33,16,0.7), rgba(24,16,8,0.7)) !important;
    box-shadow: inset 0 0 0 1px rgba(20,13,6,0.8), 0 3px 10px rgba(0,0,0,0.5) !important;
  }

  /* ── Depth header: carved title + skull rule beneath ─────────────── */
  :root[data-ui="ornate"] #depth-counter {
    font-family: ${cssFont(FONT_TITLE)} !important;
    letter-spacing: 0.34em !important;
    color: #d8bd8e !important;
    padding-bottom: 12px !important;
    background: ${SKULL_RULE} bottom center / 120px 14px no-repeat !important;
  }`;
}

/** Quote a font-family value safely for CSS (names with spaces need quotes). */
function cssFont(f: string): string {
  // theme fonts are already usable family strings; wrap the primary token if it
  // has spaces and isn't already a stack. Cheap + good enough for the prototype.
  return f.includes(',') || f.startsWith('"') ? f : `"${f}"`;
}

let styleEl: HTMLStyleElement | null = null;

/** Turn the ornate skin on/off. Idempotent; injects the stylesheet once. */
export function setOrnateUI(on: boolean): void {
  const root = document.documentElement;
  if (on) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ornate-skin';
      styleEl.textContent = buildCss();
      document.head.appendChild(styleEl);
    }
    root.setAttribute('data-ui', 'ornate');
  } else {
    root.removeAttribute('data-ui');
  }
}

/** Read ?ui=ornate at boot and apply. Safe to call before the HUD exists — the
 *  stylesheet applies to widgets whenever they mount. */
export function initOrnateSkin(): void {
  if (typeof window === 'undefined') return;
  const want = new URLSearchParams(window.location.search).get('ui');
  if (want === 'ornate') setOrnateUI(true);
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__ui = (mode?: string) => {
      setOrnateUI(mode !== 'classic' && mode !== 'off');
      return document.documentElement.getAttribute('data-ui') ?? 'classic';
    };
  }
}
