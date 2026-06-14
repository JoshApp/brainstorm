// ── DELVE UI — "carved from the deep" ────────────────────────────────────
//
// The ONE source of truth for menu CHROME — the title screen, the settings
// panel, and the satchel/inventory sheets all pull from here so they read as
// one object, not three. (The in-game HUD has its own tokens in hud.ts /
// hud-design.ts and is deliberately NOT governed by this — gameplay readouts
// answer to combat legibility, menus answer to atmosphere.)
//
// The language: menus look INSCRIBED INTO DARK STONE AND LIT BY TORCHLIGHT,
// not boxes floating over the game. Three rules carry it:
//
//   1. CARVED, NOT BOXED. Hairline rules + corner ticks instead of heavy
//      filled borders. A panel reads like a slab with chiselled edges.
//   2. SERIF SPEAKS, SANS COUNTS. The display serif (the title font) carries
//      headings + voice; the UI sans is reserved for dense data (stats,
//      sliders, numbers) where legibility beats character.
//   3. COLOUR IS MEANING. Amber = torchlight (headings, the live/active
//      thing). Ember = heat (the one primary action, hover glow). Blood =
//      destructive. Arcane violet is RESERVED so it never competes with the
//      XP signal. Everything else is degrees of dim parchment on near-black.

export const FONT_DISPLAY = '"Iowan Old Style", "Palatino", "Times New Roman", serif';
export const FONT_UI = 'system-ui, -apple-system, sans-serif';

export const THEME = {
  // ── Grounds — near-black, warm-tinted so the dark still feels lit ──
  void:   'rgba(8, 5, 3, 0.97)',     // deepest backdrop (full-screen scrims)
  panel:  'rgba(20, 14, 10, 0.96)',  // the slab — panel fill
  raised: 'rgba(36, 26, 18, 0.7)',   // cards / raised insets on the slab
  sunken: 'rgba(12, 8, 5, 0.55)',    // wells, inputs, tab troughs

  // ── Text — parchment, three weights of presence ──
  text:  'rgba(230, 200, 170, 0.95)',
  dim:   'rgba(160, 130, 100, 0.85)',
  faint: 'rgba(100, 80, 60, 0.6)',

  // ── Accents — each carries one meaning, never decoration ──
  amber:  'rgba(255, 200, 140, 0.95)', // torchlight — headings, active/live
  ember:  'rgba(255, 150, 60, 0.92)',  // heat — the primary action, hot edge
  blood:  'rgba(206, 64, 52, 0.92)',   // destructive — abandon / quit / delete
  arcane: 'rgba(170, 110, 240, 0.9)',  // RESERVED (XP/arcane); avoid in chrome

  // ── Lines — hairline rules are the primary structural element ──
  rule:       'rgba(180, 130, 90, 0.28)',
  ruleStrong: 'rgba(180, 130, 90, 0.55)',
  tick:       'rgba(220, 160, 100, 0.6)', // corner-tick chisel marks

  // ── FX ──
  shadow:     '0 10px 40px rgba(0, 0, 0, 0.92)',
  textShadow: '0 0 6px rgba(0, 0, 0, 0.85)',
  emberGlow:  '0 0 18px rgba(255, 140, 60, 0.30)',
} as const;

// ── One-time keyframe injection (ember breath behind focal elements) ──
let injected = false;
export function injectThemeKeyframes(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'delve-theme-keyframes';
  style.textContent = `
    @keyframes delveEmberBreath {
      0%, 100% { opacity: 0.55; }
      50%      { opacity: 0.85; }
    }
  `;
  document.head.appendChild(style);
}

// ── Carved frame — corner ticks + a hot top edge ─────────────────────────
// Adds the signature "chiselled slab" treatment to a (position:relative|fixed)
// element: four L-shaped corner ticks and a faint ember line along the top, so
// the panel reads as carved rather than a soft rounded box. Idempotent-ish —
// pass a unique element; it appends its own decoration children.
export function applyCarvedFrame(
  el: HTMLElement,
  opts: { tickSize?: number; inset?: number; topEmber?: boolean } = {},
): void {
  const size = opts.tickSize ?? 11;
  const inset = opts.inset ?? 5;
  const corners: Array<[string, Partial<CSSStyleDeclaration>]> = [
    ['tl', { top: `${inset}px`, left: `${inset}px`, borderTop: `1px solid ${THEME.tick}`, borderLeft: `1px solid ${THEME.tick}` }],
    ['tr', { top: `${inset}px`, right: `${inset}px`, borderTop: `1px solid ${THEME.tick}`, borderRight: `1px solid ${THEME.tick}` }],
    ['bl', { bottom: `${inset}px`, left: `${inset}px`, borderBottom: `1px solid ${THEME.tick}`, borderLeft: `1px solid ${THEME.tick}` }],
    ['br', { bottom: `${inset}px`, right: `${inset}px`, borderBottom: `1px solid ${THEME.tick}`, borderRight: `1px solid ${THEME.tick}` }],
  ];
  for (const [, css] of corners) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      pointerEvents: 'none',
      opacity: '0.85',
      ...css,
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(t);
  }
  if (opts.topEmber !== false) {
    const ember = document.createElement('div');
    Object.assign(ember.style, {
      position: 'absolute',
      top: '0', left: '14%', right: '14%',
      height: '1px',
      background: `linear-gradient(90deg, transparent, ${THEME.ember}, transparent)`,
      opacity: '0.5',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(ember);
  }
}

// ── A hairline divider, optionally with a centred chisel diamond ─────────
export function carvedRule(opts: { glyph?: boolean; margin?: string } = {}): HTMLDivElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: opts.margin ?? '2px 0',
  } as Partial<CSSStyleDeclaration>);
  const mkLine = () => {
    const l = document.createElement('div');
    Object.assign(l.style, {
      flex: '1 1 auto',
      height: '1px',
      background: `linear-gradient(90deg, transparent, ${THEME.rule}, transparent)`,
    } as Partial<CSSStyleDeclaration>);
    return l;
  };
  wrap.appendChild(mkLine());
  if (opts.glyph) {
    const d = document.createElement('div');
    d.textContent = '◆';
    Object.assign(d.style, {
      flex: '0 0 auto',
      fontSize: '7px',
      color: THEME.tick,
      lineHeight: '1',
    } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(d);
    wrap.appendChild(mkLine());
  }
  return wrap;
}

// ── Serif display heading — the menu "voice" register ────────────────────
export function displayHeading(text: string, opts: { size?: number; glow?: boolean } = {}): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    fontFamily: FONT_DISPLAY,
    fontSize: `${opts.size ?? 15}px`,
    fontWeight: '500',
    letterSpacing: '0.28em',
    color: THEME.amber,
    textTransform: 'uppercase',
    textShadow: opts.glow ? `${THEME.textShadow}, ${THEME.emberGlow}` : THEME.textShadow,
  } as Partial<CSSStyleDeclaration>);
  return el;
}

// ── Small uppercase sans label — for dense data sections ("STATS", "BAG") ──
export function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    fontFamily: FONT_UI,
    fontSize: '10px', fontWeight: '500', letterSpacing: '0.25em',
    color: THEME.dim,
    borderBottom: `1px solid ${THEME.rule}`,
    paddingBottom: '4px',
  } as Partial<CSSStyleDeclaration>);
  return el;
}
