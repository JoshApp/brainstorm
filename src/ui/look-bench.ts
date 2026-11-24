// LOOK BENCH — judge the LOOK TEST switches in play, without the settings menu
// (Josh, 2026-11-24: "something that can also do the side by side comparison,
// or at least quick toggle so I can see the differences").
//
//   L        open / close the bench (a small panel, the game keeps running)
//   1 to 5   flip a switch, live
//   hold B   the shipped look while held; let go and your picks are back
//   V        SPLIT: the frame frozen twice, shipped on the left and your
//            picks on the right, a divider that follows the mouse (or a
//            finger). 1 to 5 still flip, and the right side re-renders.
//
// The switches are the settings' own (style/look-lab.ts), so the menu and the
// bench always agree, and what you keep here is what the game keeps. DEV, or
// ?looklab=1 on the live site.

import { getSettings, updateSettings, onSettingsChanged } from '../settings/settings';
import { applyLook, lookFromSettings, LOOK_SWITCHES, SHIPPED_LOOK } from '../style/look-lab';
import { openScreen, closeScreen, isScreenOpen } from './screen-manager';
import { isTextEntryMode } from '../controls/input-mode';
import { injectKitStyles } from './kit/style';

type Capture = () => Promise<{ data: Uint8Array; width: number; height: number } | null>;

const SPLIT_ID = 'look-split';
let capture: Capture | null = null;
let panel: HTMLDivElement | null = null;
let rows: HTMLDivElement[] = [];
let holdTag: HTMLDivElement | null = null;
let holding = false;

export function initLookBench(cap: Capture): void {
  const allowed = import.meta.env.DEV || new URLSearchParams(location.search).get('looklab') === '1';
  if (!allowed) return;
  capture = cap;
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  onSettingsChanged(() => { refreshPanel(); if (isScreenOpen(SPLIT_ID)) void renderSplit(true); });
}

function swallow(e: KeyboardEvent): void { e.preventDefault(); e.stopImmediatePropagation(); }

function onKeyDown(e: KeyboardEvent): void {
  if (isTextEntryMode() || e.ctrlKey || e.metaKey || e.altKey) return;
  const splitOpen = isScreenOpen(SPLIT_ID);
  if (e.code === 'KeyL' && !splitOpen) { swallow(e); togglePanel(); return; }
  if (!panel && !splitOpen) return;
  const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
  if (n >= 1 && n <= LOOK_SWITCHES.length) {
    swallow(e);
    if (!e.repeat) flip(n - 1);
    return;
  }
  if (e.code === 'KeyB' && !splitOpen) {
    swallow(e);
    if (!e.repeat && !holding) { holding = true; applyLook(SHIPPED_LOOK); showHoldTag(true); }
    return;
  }
  if (e.code === 'KeyV') {
    swallow(e);
    if (!e.repeat) { if (splitOpen) closeSplit(); else void openSplit(); }
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code !== 'KeyB' || !holding) return;
  swallow(e);
  holding = false;
  applyLook(lookFromSettings(getSettings()));
  showHoldTag(false);
}

function flip(i: number): void {
  const sw = LOOK_SWITCHES[i];
  const s = getSettings();
  updateSettings({ [sw.setting]: !s[sw.setting] } as never);
}

function picksLabel(): string {
  const s = getSettings();
  const on = LOOK_SWITCHES.filter((sw) => s[sw.setting]).map((sw) => sw.name);
  return on.length ? on.join(' · ') : 'nothing on yet: press 1 to 5';
}

// ── The panel ───────────────────────────────────────────────────────────────

function togglePanel(): void {
  if (panel) { panel.remove(); panel = null; rows = []; return; }
  injectKitStyles();
  panel = document.createElement('div');
  panel.className = 'game-hud';
  Object.assign(panel.style, {
    position: 'fixed', top: '140px', right: '16px', zIndex: '60', width: '230px',
    padding: '12px 14px', borderRadius: '14px', background: 'rgba(7, 5, 3, .86)',
    boxShadow: '0 0 22px 10px rgba(7, 5, 3, .7)', border: '1px solid rgba(255, 200, 140, .18)',
    color: '#ecd8bc', font: "13px/1.35 'EB Garamond', 'Iowan Old Style', serif",
    display: 'flex', flexDirection: 'column', gap: '6px', userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  const title = document.createElement('div');
  title.textContent = 'LOOK BENCH';
  Object.assign(title.style, { font: "600 12px/1 'Cinzel', serif", letterSpacing: '.22em', color: '#ffc88c', marginBottom: '4px' } as Partial<CSSStyleDeclaration>);
  panel.appendChild(title);
  rows = LOOK_SWITCHES.map((sw, i) => {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer' } as Partial<CSSStyleDeclaration>);
    const key = document.createElement('span');
    key.className = 'lk-key';
    key.textContent = String(i + 1);
    const name = document.createElement('span');
    name.textContent = sw.name;
    Object.assign(name.style, { flex: '1', font: "600 11px/1 'Cinzel', serif", letterSpacing: '.14em' } as Partial<CSSStyleDeclaration>);
    const state = document.createElement('span');
    Object.assign(state.style, { font: '600 10px/1 system-ui, sans-serif', letterSpacing: '.12em' } as Partial<CSSStyleDeclaration>);
    row.append(key, name, state);
    row.addEventListener('click', (e) => { e.stopPropagation(); flip(i); });
    panel!.appendChild(row);
    return row;
  });
  const help = document.createElement('div');
  help.innerHTML = 'hold <b>B</b> &nbsp;the shipped look<br><b>V</b> &nbsp;split view, shipped | yours<br><b>L</b> &nbsp;close';
  Object.assign(help.style, { marginTop: '6px', fontSize: '11px', fontStyle: 'italic', color: 'rgba(200, 170, 135, .75)' } as Partial<CSSStyleDeclaration>);
  panel.appendChild(help);
  document.body.appendChild(panel);
  refreshPanel();
}

function refreshPanel(): void {
  if (!panel) return;
  const s = getSettings();
  LOOK_SWITCHES.forEach((sw, i) => {
    const on = !!s[sw.setting];
    const row = rows[i];
    row.style.color = on ? '#ffd7a0' : 'rgba(200, 175, 145, .55)';
    (row.lastChild as HTMLElement).textContent = on ? 'ON' : 'off';
    (row.lastChild as HTMLElement).style.color = on ? '#ffb45a' : 'rgba(160, 140, 120, .6)';
  });
}

function showHoldTag(on: boolean): void {
  if (!on) { holdTag?.remove(); holdTag = null; return; }
  holdTag = document.createElement('div');
  holdTag.textContent = 'SHIPPED LOOK';
  Object.assign(holdTag.style, {
    position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: '60',
    padding: '6px 14px', borderRadius: '10px', background: 'rgba(7, 5, 3, .8)', pointerEvents: 'none',
    font: "600 12px/1 'Cinzel', serif", letterSpacing: '.22em', color: '#ffc88c',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(holdTag);
}

// ── The split view ──────────────────────────────────────────────────────────

let splitRoot: HTMLDivElement | null = null;
let leftCv: HTMLCanvasElement | null = null;
let rightCv: HTMLCanvasElement | null = null;
let rightLabel: HTMLDivElement | null = null;
let divider: HTMLDivElement | null = null;
let splitX = 0.5;
let busy = false;
/** A switch flipped mid-render: render the right side again when done. */
let again = false;

function toCanvas(cv: HTMLCanvasElement, cap: { data: Uint8Array; width: number; height: number }): void {
  cv.width = cap.width; cv.height = cap.height;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(cap.width, cap.height);
  img.data.set(cap.data);
  ctx.putImageData(img, 0, 0);
}

function placeDivider(): void {
  if (!rightCv || !divider) return;
  const pct = (splitX * 100).toFixed(2);
  rightCv.style.clipPath = `inset(0 0 0 ${pct}%)`;
  divider.style.left = `${pct}%`;
}

async function openSplit(): Promise<void> {
  if (!capture || busy) return;
  injectKitStyles();
  splitRoot = document.createElement('div');
  Object.assign(splitRoot.style, {
    position: 'fixed', inset: '0', background: '#000', cursor: 'ew-resize', touchAction: 'none', userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  const mk = (): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', imageRendering: 'pixelated' } as Partial<CSSStyleDeclaration>);
    return c;
  };
  leftCv = mk(); rightCv = mk();
  divider = document.createElement('div');
  Object.assign(divider.style, {
    position: 'absolute', top: '0', bottom: '0', width: '2px', marginLeft: '-1px',
    background: 'rgba(255, 200, 140, .85)', boxShadow: '0 0 10px rgba(255, 180, 100, .7)', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  const tag = (text: string, side: 'left' | 'right'): HTMLDivElement => {
    const t = document.createElement('div');
    t.textContent = text;
    Object.assign(t.style, {
      position: 'absolute', top: '16px', [side]: '16px', maxWidth: '44%', padding: '7px 12px', borderRadius: '10px',
      background: 'rgba(7, 5, 3, .8)', font: "600 11px/1.4 'Cinzel', serif", letterSpacing: '.16em',
      color: '#ffc88c', pointerEvents: 'none', textAlign: side,
    } as Partial<CSSStyleDeclaration>);
    return t;
  };
  rightLabel = tag('', 'right');
  const foot = document.createElement('div');
  foot.textContent = 'drag to compare · 1 to 5 flip a switch · V or Esc to return';
  Object.assign(foot.style, {
    position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', borderRadius: '10px',
    background: 'rgba(7, 5, 3, .75)', font: "italic 12px/1 'EB Garamond', serif", color: 'rgba(220, 190, 150, .85)', pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  splitRoot.append(leftCv, rightCv, divider, tag('SHIPPED', 'left'), rightLabel, foot);
  const move = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' && e.buttons === 0) return;
    splitX = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
    placeDivider();
  };
  splitRoot.addEventListener('pointermove', move);
  splitRoot.addEventListener('pointerdown', (e) => { move(e); });
  document.body.appendChild(splitRoot);
  placeDivider();
  openScreen({
    id: SPLIT_ID, root: splitRoot,
    policy: { pausesWorld: true, hidesHud: true, needsCursor: true, layer: 'modal' },
    onDismissRequest: closeSplit,
    onForceClose: closeSplit,
  });
  await renderSplit(false);
}

/** Render both sides (or only the right, after a switch flipped). */
async function renderSplit(rightOnly: boolean): Promise<void> {
  if (!capture || !leftCv || !rightCv) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    const picks = lookFromSettings(getSettings());
    if (!rightOnly) {
      applyLook(SHIPPED_LOOK);
      const a = await capture();
      if (a && leftCv) toCanvas(leftCv, a);
    }
    applyLook(picks);
    const b = await capture();
    if (b && rightCv) toCanvas(rightCv, b);
    if (rightLabel) rightLabel.textContent = `YOURS: ${picksLabel()}`;
  } finally {
    applyLook(lookFromSettings(getSettings()));
    busy = false;
  }
  if (again) { again = false; await renderSplit(true); }
}

function closeSplit(): void {
  if (!splitRoot) return;
  splitRoot.remove();
  splitRoot = null; leftCv = null; rightCv = null; rightLabel = null; divider = null;
  closeScreen(SPLIT_ID);
}
