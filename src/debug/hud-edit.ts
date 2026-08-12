import { DEV } from './dev';
import {
  THUMB_DEFAULTS, setThumbOverride, getThumbOverride, clearThumbOverrides,
  hudButtonScale, type ThumbButtonId,
} from '../controls/hud-layout';

// HUD LAYOUT DRAG MODE — DEV ONLY. `?hudedit=1`.
//
// Why this exists rather than a player-facing layout editor: the thumb buttons
// gate on `isDesktopLike()`, which tests TOUCH CAPABILITY and not viewport, so
// headless Chrome hides them at every size and `snap` cannot see the right rail
// at all. Their placement has only ever been checkable by arithmetic — which is
// exactly how the parry button's first draft shipped overlapping the weapon-swap
// chip's column.
//
// So: drag them on a REAL phone, read the numbers off the screen, bake them into
// THUMB_DEFAULTS. One person moving a button once beats a general editor for a
// two-button HUD (and see docs/UI-SYSTEM.md — "one layout, enhanced; never a
// second HUD"). Players get the size slider; this finds the defaults it scales.
//
// The readout is ON SCREEN, not in the console, because the entire point is that
// this runs on a phone where there is no console to read.
//
// Gated twice: the whole module no-ops unless DEV, and the URL flag is checked
// separately — so a production bundle dead-code-eliminates the body and the flag
// cannot turn anything on.

let active = false;
let readout: HTMLDivElement | null = null;
let dragging: ThumbButtonId | null = null;

const BUTTON_IDS: Record<ThumbButtonId, string> = {
  dodge: 'dodge-button',
  parry: 'parry-button',
};

/** True while drag mode owns the buttons — the press handlers check this so a
 *  drag never also dodges or parries. */
export function isHudEditActive(): boolean {
  return DEV && active;
}

export function initHudEdit(): void {
  if (!DEV) return;
  const params = new URLSearchParams(location.search);
  if (params.get('hudedit') !== '1') return;
  active = true;

  readout = document.createElement('div');
  Object.assign(readout.style, {
    position: 'fixed', left: '8px', top: '8px', zIndex: '9000',
    padding: '8px 10px', borderRadius: '6px',
    background: 'rgba(10,8,6,0.86)', border: '1px solid #6b5a44',
    color: '#e8dcc0', font: '11px/1.5 monospace', whiteSpace: 'pre',
    pointerEvents: 'none', maxWidth: '60vw',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(readout);

  // Bind on the document in CAPTURE phase so a drag beats each button's own
  // pointerdown (which would otherwise dodge or parry the moment you grabbed it).
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);

  paint();
}

function hitTest(x: number, y: number): ThumbButtonId | null {
  for (const id of Object.keys(BUTTON_IDS) as ThumbButtonId[]) {
    const el = document.getElementById(BUTTON_IDS[id]);
    if (!el || el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
  }
  return null;
}

function onDown(ev: PointerEvent): void {
  if (!active) return;
  const id = hitTest(ev.clientX, ev.clientY);
  if (!id) return;
  dragging = id;
  ev.preventDefault();
  ev.stopPropagation();   // the button's own handler must not fire
}

function onMove(ev: PointerEvent): void {
  if (!active || !dragging) return;
  ev.preventDefault();
  ev.stopPropagation();
  const k = hudButtonScale() || 1;
  const size = THUMB_DEFAULTS[dragging].size * k;
  // Pointer is treated as the button's CENTRE; convert to the right/bottom
  // anchors the layout table stores, then divide out the scale so what we bake
  // is a scale-1 number.
  const right = (window.innerWidth - ev.clientX - size / 2) / k;
  const bottom = (window.innerHeight - ev.clientY - size / 2) / k;
  setThumbOverride(dragging, Math.max(0, right), Math.max(0, bottom));
  paint();
}

function onUp(ev: PointerEvent): void {
  if (!active || !dragging) return;
  ev.preventDefault();
  ev.stopPropagation();
  dragging = null;
  paint();
}

function paint(): void {
  if (!readout) return;
  const lines = ['HUD EDIT  —  drag a button', ''];
  for (const id of Object.keys(BUTTON_IDS) as ThumbButtonId[]) {
    const o = getThumbOverride(id);
    const d = THUMB_DEFAULTS[id];
    const moved = o ? '*' : ' ';
    lines.push(
      `${moved}${id.padEnd(6)} right: ${String(Math.round(o?.right ?? d.right)).padStart(4)}` +
      `  bottom: ${String(Math.round(o?.bottom ?? d.bottom)).padStart(4)}`,
    );
  }
  lines.push('', 'bake into THUMB_DEFAULTS', '(controls/hud-layout.ts)');
  lines.push(`scale ${hudButtonScale().toFixed(2)}  ·  double-tap here to reset`);
  readout.textContent = lines.join('\n');
}

// Double-tap the readout to clear overrides — reachable on a phone, where there
// is no key to press.
let lastTap = 0;
if (DEV) {
  document.addEventListener('pointerdown', (ev) => {
    if (!active || !readout) return;
    const r = readout.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    const now = performance.now();
    if (now - lastTap < 400) { clearThumbOverrides(); paint(); }
    lastTap = now;
  }, true);
}
