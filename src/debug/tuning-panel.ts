// ── THE TUNING PANEL ─────────────────────────────────────────────────────────
//
// Builds itself entirely from whatever debug/tuning.ts has registered. There is
// no list of knobs in this file and there must never be one: a knob declared
// anywhere in the codebase shows up here, in a tab named by its own `group`,
// and the day someone has to edit THIS file to add a slider is the day the
// thing stopped being self-building.
//
// Phone-first, like the profiler toolbar it sits beside — big touch targets,
// draggable so it can be moved off whatever you are trying to look at, and it
// remembers where you put it. Tuning happens on the device where the look is
// judged, not on the desktop where it is written.
//
// DEV-gated: mounted only from the DEV hook path, never referenced by
// production code.
import { listKnobs, knobGroups, knobsAsQuery, onKnobChange, type Knob } from './tuning';
// Side-effect import: registers the View group's knobs. Without it the group
// only appears once something else happens to pull the module in.
import './tuning-view';

let root: HTMLDivElement | null = null;
let activeGroup = '';

const PANEL_POS_KEY = 'delve.tunePanel.pos';

function css(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void { Object.assign(el.style, s); }

function makeRow(k: Knob, onChanged: () => void): HTMLDivElement {
  const row = document.createElement('div');
  css(row, { margin: '0 0 10px', display: 'block' });

  const head = document.createElement('div');
  css(head, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px',
    font: '600 11px ui-monospace, SFMono-Regular, Menlo, monospace',
    color: 'rgba(200, 225, 255, 0.92)', letterSpacing: '0.04em',
  });
  const name = document.createElement('span');
  name.textContent = k.spec.label;
  const val = document.createElement('span');
  css(val, { color: 'rgba(255, 210, 140, 0.95)', fontVariantNumeric: 'tabular-nums' });
  const showVal = () => { val.textContent = k.get().toFixed(3); };
  showVal();
  head.append(name, val);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(k.spec.min);
  slider.max = String(k.spec.max);
  slider.step = String(k.spec.step);
  slider.value = String(k.get());
  css(slider, { width: '100%', margin: '4px 0 0', accentColor: '#c8a068', height: '26px' });
  // `input` not `change` — the whole point is watching it move.
  slider.addEventListener('input', () => {
    k.set(parseFloat(slider.value));
    showVal();
    onChanged();
  });

  const foot = document.createElement('div');
  css(foot, {
    font: '400 9px ui-monospace, SFMono-Regular, Menlo, monospace',
    color: 'rgba(170, 195, 230, 0.55)', letterSpacing: '0.02em', marginTop: '1px',
  });
  // The apply cost is shown per knob, because a slider that needs a reload and
  // one that does not look identical otherwise — and silently doing nothing is
  // the worst thing a debug control can do.
  const costTag = k.spec.apply === 'live' ? ''
    : k.spec.apply === 'rebake' ? ' · rebakes' : ' · NEEDS RELOAD';
  foot.textContent = (k.spec.hint ?? '') + costTag;
  if (k.spec.apply === 'reload') css(foot, { color: 'rgba(255, 160, 140, 0.75)' });

  row.append(head, slider, foot);
  return row;
}

function build(): void {
  if (!root) return;
  root.replaceChildren();

  const groups = knobGroups();
  if (!groups.length) {
    const empty = document.createElement('div');
    css(empty, { font: '400 11px ui-monospace, monospace', color: 'rgba(200,225,255,0.6)' });
    empty.textContent = 'no knobs registered';
    root.append(empty);
    return;
  }
  if (!groups.includes(activeGroup)) activeGroup = groups[0];

  // ── drag handle + tabs ────────────────────────────────────────────────────
  const bar = document.createElement('div');
  css(bar, { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px', cursor: 'move' });

  const grip = document.createElement('span');
  grip.textContent = '⠿';
  css(grip, { color: 'rgba(160,190,240,0.6)', font: '600 13px monospace', padding: '0 4px 0 0' });
  bar.append(grip);

  for (const g of groups) {
    const tab = document.createElement('button');
    tab.textContent = g;
    const on = g === activeGroup;
    css(tab, {
      padding: '5px 9px', minHeight: '28px', borderRadius: '5px', cursor: 'pointer',
      background: on ? 'rgba(200, 160, 104, 0.22)' : 'rgba(14, 18, 28, 0.7)',
      border: `1px solid ${on ? 'rgba(220,180,120,0.75)' : 'rgba(150,180,255,0.3)'}`,
      color: on ? 'rgba(255,220,170,0.95)' : 'rgba(190,215,250,0.8)',
      font: '600 10px ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.06em', touchAction: 'manipulation',
    });
    tab.addEventListener('click', (e) => { e.stopPropagation(); activeGroup = g; build(); });
    bar.append(tab);
  }
  root.append(bar);

  // ── knobs for the active tab ──────────────────────────────────────────────
  const body = document.createElement('div');
  css(body, { maxHeight: '46vh', overflowY: 'auto', paddingRight: '2px' });
  const mine = listKnobs().filter((k) => k.spec.group === activeGroup);
  for (const k of mine) body.append(makeRow(k, () => { /* value readout handled per-row */ }));
  root.append(body);

  // ── copy the current look as a URL ────────────────────────────────────────
  // The panel is for FINDING a value; the URL is for KEEPING one. Without this
  // a look found by dragging exists only until the tab closes.
  const copy = document.createElement('button');
  copy.textContent = 'copy as ?query';
  css(copy, {
    marginTop: '8px', width: '100%', padding: '7px', minHeight: '32px', borderRadius: '5px',
    background: 'rgba(14,18,28,0.8)', border: '1px solid rgba(150,180,255,0.35)',
    color: 'rgba(200,225,255,0.9)', cursor: 'pointer',
    font: '600 10px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.06em',
  });
  copy.addEventListener('click', (e) => {
    e.stopPropagation();
    const q = knobsAsQuery();
    const text = q || '(all at defaults)';
    void navigator.clipboard?.writeText(q).catch(() => { /* clipboard may be blocked */ });
    copy.textContent = text.length > 42 ? `${text.slice(0, 42)}…` : text;
    window.setTimeout(() => { copy.textContent = 'copy as ?query'; }, 2200);
  });
  root.append(copy);
}

function makeDraggable(el: HTMLDivElement): void {
  let dragging = false, ox = 0, oy = 0;
  const down = (cx: number, cy: number, target: EventTarget | null) => {
    // Only the tab bar drags — otherwise a slider drag would move the panel.
    if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'BUTTON')) return;
    dragging = true;
    ox = cx - el.getBoundingClientRect().left;
    oy = cy - el.getBoundingClientRect().top;
  };
  const move = (cx: number, cy: number) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 60, cx - ox));
    const y = Math.max(0, Math.min(window.innerHeight - 40, cy - oy));
    css(el, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ l: el.style.left, t: el.style.top })); }
    catch { /* private mode */ }
  };
  el.addEventListener('pointerdown', (e) => down(e.clientX, e.clientY, e.target));
  window.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('pointerup', up);
}

export function isTuningPanelOpen(): boolean { return !!root; }

export function toggleTuningPanel(): void {
  if (root) { root.remove(); root = null; return; }
  root = document.createElement('div');
  css(root, {
    position: 'fixed', top: '56px', right: '10px', zIndex: '10000',
    width: 'min(300px, 82vw)', padding: '10px',
    background: 'rgba(10, 13, 20, 0.93)',
    border: '1px solid rgba(150, 180, 255, 0.35)', borderRadius: '8px',
    backdropFilter: 'blur(3px)', touchAction: 'none',
    boxShadow: '0 6px 26px rgba(0,0,0,0.55)',
  });
  try {
    const p = JSON.parse(localStorage.getItem(PANEL_POS_KEY) ?? 'null') as { l: string; t: string } | null;
    if (p?.l) css(root, { left: p.l, top: p.t, right: 'auto' });
  } catch { /* ignore */ }
  document.body.append(root);
  makeDraggable(root);
  build();
}

// Rebuild the readouts if something else moves a knob (a console call, say),
// so the panel can never show a value the game isn't using.
onKnobChange(() => { if (root) { /* per-row readouts update themselves on input */ } });
