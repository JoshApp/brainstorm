import { openScreen, closeScreen, type ScreenLayer, type ScreenPolicy } from './screen-manager';
import { THEME, FONT_DISPLAY, FONT_UI, applyCarvedFrame, injectThemeKeyframes } from './theme';

// ── Menu shell — the ONE mobile-first sheet every panel-style menu uses ──
//
// The game is landscape-locked (index.html rotate-gate), so on a phone the
// viewport is WIDE but SHORT. The recurring breakage was vertical: content
// ran off the bottom, action buttons got pushed off-screen, scroll regions
// were bounded inconsistently (some 230px, some 92vh, some not at all), and
// a few panels couldn't be dismissed.
//
// A Sheet fixes all of that structurally with three bands:
//
//   ┌──────────────────────────┐
//   │ header   (title • tabs ✕) │  flex:0 — never scrolls away
//   ├──────────────────────────┤
//   │ body  (the ONLY scroller) │  flex:1; min-height:0; overflow-y:auto
//   ├──────────────────────────┤
//   │ footer    (fixed actions) │  flex:0 — EQUIP/spend/etc always reachable
//   └──────────────────────────┘
//
// Height is bounded by dvh (dynamic viewport — dodges the mobile-browser
// `vh` bug) minus safe-area insets, so it never sits under a notch or runs
// taller than the screen. Sits ON TOP of the existing screen-manager
// (policy / backdrop / dismiss), it doesn't replace it.

const EDGE = 12;   // px gap from the viewport edge (before safe-area insets)

export interface SheetOptions {
  /** Unique screen id (screen-manager). */
  id: string;
  /** Title shown at the left of the header. Omit for a chromeless sheet. */
  title?: string;
  /** Desktop max content width in px (clamped to the viewport on mobile).
   *  Default 520 — comfortable single-column. Wide panels (inventory) pass
   *  more. */
  width?: number;
  /** Screen-manager layer. Default 'panel'. */
  layer?: ScreenLayer;
  /** Extra policy overrides merged into the screen-manager handle. */
  policy?: Partial<ScreenPolicy>;
  /** Called when the sheet closes (X, backdrop tap, or programmatic close)
   *  — use it to unsubscribe listeners etc. The sheet handles its own
   *  teardown; this is just the hook. */
  onClose?: () => void;
}

export interface Sheet {
  /** The fixed, centered container. */
  root: HTMLDivElement;
  /** The header band (title + ✕). Append tabs / extra controls here. */
  header: HTMLDivElement;
  /** The scroll region. Append content here — it's the only thing that
   *  scrolls, and it's correctly bounded so it always works on mobile. */
  body: HTMLDivElement;
  /** The fixed action band. Append menuButton()s here; it auto-hides while
   *  empty and shows once you add an action. */
  footer: HTMLDivElement;
  /** Mount + register with the screen-manager. */
  open(): void;
  /** Unmount + deregister (also fired by ✕ / backdrop). Idempotent. */
  close(): void;
  /** Replace the header title text. */
  setTitle(t: string): void;
}

/** Build a mobile-first sheet. The caller appends to `body`/`footer`, then
 *  calls `open()`. */
export function createSheet(opts: SheetOptions): Sheet {
  const width = opts.width ?? 520;
  let closed = false;
  injectThemeKeyframes();

  const root = document.createElement('div');
  root.id = `${opts.id}-sheet`;
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    flexDirection: 'column',
    // Width clamps to the viewport minus edge gaps + horizontal safe-area
    // (landscape notches live on the sides).
    width: `min(${width}px, calc(100vw - ${EDGE * 2}px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))`,
    // Carved slab: near-black fill with a faint top-lit gradient so the
    // surface reads as stone catching torchlight, a hairline chiselled edge,
    // and barely-rounded corners (the corner ticks do the "carved" work).
    background: `linear-gradient(180deg, ${THEME.raised} 0%, ${THEME.panel} 14%, ${THEME.panel} 100%)`,
    border: `1px solid ${THEME.ruleStrong}`,
    borderRadius: '3px',
    boxShadow: `${THEME.shadow}, inset 0 0 60px rgba(0,0,0,0.4)`,
    color: THEME.text,
    fontFamily: FONT_UI,
    overflow: 'hidden',   // root clips; the body scrolls (NB: not "overflow-y")
  } as Partial<CSSStyleDeclaration>);
  // Height bound, set as a fallback chain so it survives a browser that
  // chokes on dvh-inside-calc: plain vh first (universal), then the
  // dynamic-viewport refinement (dvh tracks the real visible height as
  // mobile browser chrome shows/hides). If the second value is invalid
  // on this browser it's rejected and the vh fallback stays — so the
  // sheet is ALWAYS bounded and never runs off a short landscape screen.
  root.style.maxHeight = '92vh';
  root.style.maxHeight = `calc(100dvh - ${EDGE * 2}px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))`;

  // ── Header ───────────────────────────────────────────────────────────
  const header = document.createElement('div');
  Object.assign(header.style, {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '12px 14px 11px',
    borderBottom: `1px solid ${THEME.rule}`,
  } as Partial<CSSStyleDeclaration>);

  // Title in the display SERIF — the menu "voice" register, small-caps, amber
  // torchlight. (The dense controls below stay sans.)
  const titleEl = document.createElement('div');
  titleEl.textContent = opts.title ?? '';
  Object.assign(titleEl.style, {
    fontFamily: FONT_DISPLAY,
    fontSize: '15px',
    fontWeight: '500',
    letterSpacing: '0.28em',
    textTransform: 'uppercase',
    color: THEME.amber,
    textShadow: THEME.textShadow,
    flex: '1 1 auto',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);

  const closeBtn = document.createElement('button');
  closeBtn.setAttribute('aria-label', 'close');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    flex: '0 0 auto',
    width: '44px',
    height: '44px',
    margin: '-8px -8px -8px 0',   // big hit area without bloating the header height
    background: 'transparent',
    border: 'none',
    color: THEME.dim,
    fontSize: '18px',
    lineHeight: '1',
    cursor: 'pointer',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    transition: 'color 0.12s ease',
  } as Partial<CSSStyleDeclaration>);
  closeBtn.addEventListener('pointerenter', () => { closeBtn.style.color = THEME.ember; });
  closeBtn.addEventListener('pointerleave', () => { closeBtn.style.color = THEME.dim; });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });

  header.append(titleEl, closeBtn);
  root.appendChild(header);

  // ── Body (scroll region) ─────────────────────────────────────────────
  const body = document.createElement('div');
  Object.assign(body.style, {
    flex: '1 1 auto',
    minHeight: '0',               // lets the flex child shrink → scroll engages
    overflowY: 'auto',            // the inline "overflow-y" opts into touch pan-y (index.html)
    touchAction: 'pan-y',         // explicit, belt-and-suspenders over the index.html rule
    WebkitOverflowScrolling: 'touch',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(body);

  // ── Footer (fixed actions) ───────────────────────────────────────────
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    flex: '0 0 auto',
    display: 'none',              // shown at open() if it has actions
    gap: '8px',
    justifyContent: 'center',
    padding: '11px 14px',
    borderTop: `1px solid ${THEME.rule}`,
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(footer);

  // Carved corner ticks — appended LAST so they paint over the bands. The
  // signature "chiselled slab" mark that ties every menu together.
  applyCarvedFrame(root);

  function open(): void {
    document.body.appendChild(root);
    footer.style.display = footer.childElementCount > 0 ? 'flex' : 'none';
    openScreen({
      id: opts.id,
      root,
      policy: { layer: opts.layer ?? 'panel', ...opts.policy },
      onDismissRequest: close,
    });
  }

  function close(): void {
    if (closed) return;
    closed = true;
    opts.onClose?.();
    root.remove();
    closeScreen(opts.id);
  }

  function setTitle(t: string): void { titleEl.textContent = t; }

  return { root, header, body, footer, open, close, setTitle };
}

/** A touch-sized menu button (≥44px tall — the iOS/Android minimum). Use
 *  for every actionable control in a sheet so targets never go sub-44px.
 *  Three registers in the carved language:
 *    - default — a flat slab: dark fill, hairline edge, amber-dim text.
 *    - primary — the ONE hot action: ember-lit fill + glow.
 *    - danger  — destructive (abandon / quit / delete): blood edge + text.
 *  `small` (36px) is for dense inline rows. */
export function menuButton(
  label: string,
  onClick: () => void,
  opts: { primary?: boolean; small?: boolean; danger?: boolean } = {},
): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;

  // Resting + hover treatments per register, so press/hover feedback can
  // restore the right resting look.
  const rest = opts.primary
    ? { bg: `linear-gradient(180deg, rgba(150, 86, 36, 0.95), rgba(96, 50, 20, 0.95))`, border: THEME.ember, color: 'rgba(255, 236, 210, 0.98)', glow: THEME.emberGlow }
    : opts.danger
    ? { bg: THEME.sunken, border: `rgba(206, 64, 52, 0.55)`, color: 'rgba(232, 150, 140, 0.95)', glow: 'none' }
    : { bg: THEME.sunken, border: THEME.ruleStrong, color: THEME.text, glow: 'none' };

  Object.assign(b.style, {
    minHeight: opts.small ? '36px' : '44px',
    padding: opts.small ? '6px 16px' : '11px 24px',
    background: rest.bg,
    border: `1px solid ${rest.border}`,
    color: rest.color,
    fontFamily: FONT_UI,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    borderRadius: '2px',
    boxShadow: rest.glow === 'none' ? 'none' : rest.glow,
    cursor: 'pointer',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.08s ease, box-shadow 0.15s ease, border-color 0.15s ease',
  } as Partial<CSSStyleDeclaration>);

  // Hover/press: warm the edge + ember the glow; secondary buttons borrow a
  // little heat so the whole set feels lit by the same torch.
  const warm = opts.danger ? 'rgba(230, 90, 76, 0.9)' : THEME.ember;
  b.addEventListener('pointerenter', () => {
    b.style.borderColor = warm;
    b.style.boxShadow = opts.danger ? '0 0 16px rgba(206, 64, 52, 0.28)' : THEME.emberGlow;
  });
  b.addEventListener('pointerleave', () => {
    b.style.borderColor = rest.border;
    b.style.boxShadow = rest.glow === 'none' ? 'none' : rest.glow;
    b.style.transform = 'scale(1)';
  });
  b.addEventListener('pointerdown', () => { b.style.transform = 'scale(0.97)'; });
  b.addEventListener('pointerup',   () => { b.style.transform = 'scale(1)'; });
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}
