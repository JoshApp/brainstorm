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
import {
  listKnobs, knobGroups, knobsAsQuery, knobsAsNotes, onKnobChange,
  recordKnob, toggleKnobsShowing, knobsShowing, resetKnobs, knobsChangedCount,
  type Knob,
} from './tuning';
// Side-effect imports: register knob groups that nothing else pulls in. Without
// these the groups only appear once something happens to import the module.
import './tuning-view';
import './tuning-grade';
import { allPresets, applyPreset, savePreset } from './tuning-presets';

let root: HTMLDivElement | null = null;
let activeGroup = '';
// Per-row updaters for the CURRENTLY BUILT tab, so the A/B toggle can move
// every visible slider and readout without rebuilding the DOM (a rebuild
// scrolls the list back to the top mid-comparison, which is the one thing an
// A/B must not do).
let rowRefreshers: (() => void)[] = [];
let sliderRefreshers: (() => void)[] = [];

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
  css(val, { fontVariantNumeric: 'tabular-nums' });
  // A value moved off the shipped default is coloured, one still at it is grey.
  // With eight tabs it is otherwise impossible to see WHERE your set actually
  // is without opening every one of them.
  const showVal = () => {
    const v = k.get();
    const moved = Math.abs(v - k.authored) > 1e-6;
    val.textContent = v.toFixed(3);
    css(val, { color: moved ? 'rgba(255, 210, 140, 0.95)' : 'rgba(150, 175, 210, 0.5)' });
    css(name, { color: moved ? 'rgba(220, 235, 255, 0.95)' : 'rgba(200, 225, 255, 0.72)' });
  };
  showVal();
  head.append(name, val);
  rowRefreshers.push(showVal);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(k.spec.min);
  slider.max = String(k.spec.max);
  slider.step = String(k.spec.step);
  slider.value = String(k.get());
  css(slider, { width: '100%', margin: '4px 0 0', accentColor: '#c8a068', height: '26px' });
  // `input` not `change` — the whole point is watching it move.
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    k.set(v);
    // RECORD only here. A slider drag is an edit; the A/B toggle and the reset
    // also move knobs and must NOT count as one, or flipping to DEFAULT would
    // overwrite the set you were comparing against.
    recordKnob(k.spec.id, v);
    showVal();
    onChanged();
  });
  sliderRefreshers.push(() => { slider.value = String(k.get()); });

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
  rowRefreshers = [];
  sliderRefreshers = [];

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
    // A dot marks a tab holding values you've moved. Eight tabs deep, the
    // question "where did I actually change something" is otherwise answered
    // only by opening all of them.
    const touched = listKnobs().some(
      (k) => k.spec.group === g && Math.abs(k.get() - k.authored) > 1e-6,
    );
    tab.textContent = touched ? `${g} ·` : g;
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

  // ── PRESETS ───────────────────────────────────────────────────────────────
  // Josh: *"can you keep both as presets so i can switch between."* The A/B
  // button compares a set against the shipped defaults, which is the tool for
  // dragging one slider; it cannot hold two rival looks. These can.
  //
  // A preset only sets the knobs it names, so they compose — a wall look and a
  // floor look can be applied one after the other — and applying one cannot
  // quietly reset a surface it says nothing about.
  const presets = allPresets();
  if (presets.length) {
    const row = document.createElement('div');
    css(row, { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' });
    for (const p of presets) {
      const chip = document.createElement('button');
      chip.textContent = p.name;
      css(chip, {
        padding: '4px 8px', minHeight: '26px', borderRadius: '4px', cursor: 'pointer',
        background: 'rgba(60, 40, 20, 0.55)', border: '1px solid rgba(200,160,104,0.45)',
        color: 'rgba(255,225,180,0.9)', touchAction: 'manipulation',
        font: '600 9px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.05em',
      });
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const msg = applyPreset(p.name);
        chip.textContent = msg.includes('unknown') ? msg.slice(0, 22) : 'APPLIED';
        window.setTimeout(() => { chip.textContent = p.name; build(); }, 900);
      });
      row.append(chip);
    }
    root.append(row);
  }

  // ── knobs for the active tab ──────────────────────────────────────────────
  const body = document.createElement('div');
  css(body, { maxHeight: '46vh', overflowY: 'auto', paddingRight: '2px' });
  const mine = listKnobs().filter((k) => k.spec.group === activeGroup);
  for (const k of mine) body.append(makeRow(k, () => { /* value readout handled per-row */ }));
  root.append(body);

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  // The panel is for FINDING a value. These three are for everything that has
  // to happen to a value after it's found: compare it, keep it, say it.
  const actions = document.createElement('div');
  css(actions, { display: 'flex', gap: '6px', marginTop: '9px' });

  // A/B — the one that matters most while tuning. Your eye cannot hold the
  // previous look while you drag, so the comparison has to be one tap and it
  // has to be non-destructive in both directions.
  const ab = document.createElement('button');
  const paintAB = () => {
    const mine = knobsShowing() === 'mine';
    ab.textContent = mine ? `MINE (${knobsChangedCount()})` : 'DEFAULT';
    css(ab, {
      background: mine ? 'rgba(200, 160, 104, 0.26)' : 'rgba(90, 110, 150, 0.26)',
      borderColor: mine ? 'rgba(220,180,120,0.75)' : 'rgba(150,180,255,0.5)',
      color: mine ? 'rgba(255,220,170,0.98)' : 'rgba(200,220,255,0.9)',
    });
  };
  btnStyle(ab);
  paintAB();
  ab.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleKnobsShowing();
    // Move the visible controls, don't rebuild — see rowRefreshers.
    for (const f of sliderRefreshers) f();
    for (const f of rowRefreshers) f();
    paintAB();
  });

  // RESET — throws the saved set away for THIS TAB, not just this session's
  // edits, so the next reload comes back clean too. Two taps, because it is the
  // one button here that destroys work.
  //
  // Tab-scoped: a destructive button should not reach past what you can see when
  // you press it. It names the tab it will clear so there is no guessing, and
  // it greys out when that tab has nothing to clear — a reset that does nothing
  // still costs two taps to discover.
  const reset = document.createElement('button');
  btnStyle(reset);
  const tabDirty = () => listKnobs().some(
    (k) => k.spec.group === activeGroup && Math.abs(k.get() - k.authored) > 1e-6,
  );
  const label = `RESET ${activeGroup.toUpperCase()}`;
  reset.textContent = label;
  css(reset, { fontSize: '9px' });   // room for the longest tab name
  if (!tabDirty()) css(reset, { opacity: '0.4' });
  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!tabDirty()) return;
    if (reset.dataset.armed !== '1') {
      reset.dataset.armed = '1';
      reset.textContent = 'SURE?';
      window.setTimeout(() => {
        if (reset.dataset.armed === '1') { reset.dataset.armed = ''; reset.textContent = label; }
      }, 2500);
      return;
    }
    reset.dataset.armed = '';
    resetKnobs(activeGroup);
    build();
  });

  // COPY — both forms at once. The query is what a browser needs to reproduce
  // the look; the notes are what a MESSAGE needs, because "flrrough=0.94" does
  // not tell anyone what you were going for and "Sheen · Floor roughness: 0.94"
  // does. Josh asked for a way to communicate what he wants, and a URL on its
  // own is not that.
  const copy = document.createElement('button');
  btnStyle(copy);
  copy.textContent = 'COPY';
  copy.addEventListener('click', (e) => {
    e.stopPropagation();
    const q = knobsAsQuery();
    const text = q ? `${knobsAsNotes()}\n\n?${q}` : '(everything at defaults)';
    void navigator.clipboard?.writeText(text).catch(() => { /* clipboard may be blocked */ });
    copy.textContent = q ? `${knobsChangedCount()} COPIED` : 'NOTHING SET';
    window.setTimeout(() => { copy.textContent = 'COPY'; }, 1800);
  });

  actions.append(ab, reset, copy);
  root.append(actions);
}

function btnStyle(b: HTMLButtonElement): void {
  css(b, {
    flex: '1', padding: '8px 4px', minHeight: '34px', borderRadius: '5px',
    background: 'rgba(14,18,28,0.8)', border: '1px solid rgba(150,180,255,0.35)',
    color: 'rgba(200,225,255,0.9)', cursor: 'pointer', touchAction: 'manipulation',
    font: '600 10px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.06em',
  });
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
  // Addressable: the game has other buttons whose labels collide with this
  // panel's (there is a RESET in the settings screen), and a document-wide
  // querySelector for one of ours will silently find theirs. Cost me a wrong
  // conclusion while testing this very button.
  root.id = 'tune-panel';
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
