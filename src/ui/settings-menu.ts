import { getSettings, updateSettings } from '../settings/settings';
import { setMasterVolume } from '../audio/sfx';
import { openMenu, closeMenu, onDismissRequest } from '../controls/input-mode';

// Settings menu: tap the gear icon (top-left, below the style switcher)
// to open a panel with sliders + toggles. Same warm/dim palette as
// the rest of the in-world UI (avoid blue/cyan = "tech" register).
//
// Settings persisted via src/settings/settings.ts to localStorage.

const PANEL_BG = 'rgba(20, 14, 10, 0.92)';
const BORDER = '1px solid rgba(180, 130, 90, 0.5)';

let openButton: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let panelOpen = false;

export function createSettingsMenu() {
  if (openButton) return;

  // The gear button — top-left, beneath the style switcher chip.
  openButton = document.createElement('button');
  openButton.id = 'settings-button';
  openButton.setAttribute('aria-label', 'settings');
  openButton.textContent = '⚙';
  Object.assign(openButton.style, {
    position: 'fixed',
    top: 'calc(72px + env(safe-area-inset-top, 0px))',
    left: 'calc(16px + env(safe-area-inset-left, 0px))',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '1px solid rgba(180, 130, 90, 0.5)',
    background: 'rgba(20, 14, 10, 0.75)',
    color: 'rgba(220, 180, 140, 0.9)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    zIndex: '95',  // above the menu backdrop (90), below panels (100)
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  openButton.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });
  document.body.appendChild(openButton);

  // The panel itself, hidden by default.
  panel = document.createElement('div');
  panel.id = 'settings-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    minWidth: '300px',
    maxWidth: '90vw',
    padding: '20px 22px',
    background: PANEL_BG,
    border: BORDER,
    borderRadius: '4px',
    color: 'rgba(230, 200, 170, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
    zIndex: '100',
    display: 'none',
    flexDirection: 'column',
    gap: '18px',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(panel);

  buildPanelContents();

  // Backdrop tap = close. Routed through input-mode so the close logic
  // composes cleanly with other menus that may be open at the same time.
  onDismissRequest(() => { if (panelOpen) closePanel(); });
}

function togglePanel() {
  if (panelOpen) closePanel();
  else openPanel();
}

function openPanel() {
  if (!panel) return;
  panel.style.display = 'flex';
  panelOpen = true;
  openMenu('settings');
}

function closePanel() {
  if (!panel) return;
  panel.style.display = 'none';
  panelOpen = false;
  closeMenu('settings');
}

function buildPanelContents() {
  if (!panel) return;
  panel.replaceChildren();

  // Header row
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(180, 130, 90, 0.3)',
    paddingBottom: '8px',
  } as Partial<CSSStyleDeclaration>);
  const title = document.createElement('div');
  title.textContent = 'SETTINGS';
  Object.assign(title.style, {
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.28em',
    color: 'rgba(255, 200, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);
  const close = document.createElement('button');
  close.textContent = '✕';
  Object.assign(close.style, {
    background: 'transparent',
    border: 'none',
    color: 'rgba(220, 180, 140, 0.7)',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px 8px',
  } as Partial<CSSStyleDeclaration>);
  close.addEventListener('click', closePanel);
  header.append(title, close);
  panel.appendChild(header);

  // --- Look sensitivity slider ---
  panel.appendChild(makeSlider({
    label: 'LOOK SENSITIVITY',
    min: 0.001, max: 0.012, step: 0.0005,
    get: () => getSettings().lookSensitivity,
    set: (v) => updateSettings({ lookSensitivity: v }),
    format: (v) => v.toFixed(4),
  }));

  // --- Hybrid look toggle ---
  panel.appendChild(makeToggle({
    label: 'HYBRID LOOK',
    description: 'Drag past the aim zone to keep rotating (like a joystick).',
    get: () => getSettings().hybridLook,
    set: (v) => updateSettings({ hybridLook: v }),
  }));

  // --- Master volume slider ---
  panel.appendChild(makeSlider({
    label: 'MASTER VOLUME',
    min: 0, max: 1, step: 0.05,
    get: () => getSettings().masterVolume,
    set: (v) => {
      updateSettings({ masterVolume: v });
      setMasterVolume(v);
    },
    format: (v) => `${Math.round(v * 100)}%`,
  }));
}

interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format?: (v: number) => string;
}

function makeSlider(opts: SliderOpts): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', flexDirection: 'column', gap: '6px' } as Partial<CSSStyleDeclaration>);

  const labelRow = document.createElement('div');
  Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.textContent = opts.label;
  Object.assign(label.style, {
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const valueLabel = document.createElement('span');
  valueLabel.textContent = opts.format ? opts.format(opts.get()) : String(opts.get());
  Object.assign(valueLabel.style, {
    fontSize: '11px',
    color: 'rgba(180, 140, 100, 0.8)',
    fontFamily: 'monospace',
  } as Partial<CSSStyleDeclaration>);

  labelRow.append(label, valueLabel);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(opts.min);
  slider.max = String(opts.max);
  slider.step = String(opts.step);
  slider.value = String(opts.get());
  Object.assign(slider.style, {
    width: '100%',
    accentColor: 'rgba(255, 160, 80, 0.9)',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    opts.set(v);
    valueLabel.textContent = opts.format ? opts.format(v) : String(v);
  });

  row.append(labelRow, slider);
  return row;
}

interface ToggleOpts {
  label: string;
  description?: string;
  get: () => boolean;
  set: (v: boolean) => void;
}

function makeToggle(opts: ToggleOpts): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);

  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.textContent = opts.label;
  Object.assign(label.style, {
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const switchEl = document.createElement('div');
  Object.assign(switchEl.style, {
    width: '36px',
    height: '20px',
    borderRadius: '10px',
    background: opts.get() ? 'rgba(255, 160, 80, 0.6)' : 'rgba(60, 40, 30, 0.6)',
    position: 'relative',
    transition: 'background 0.15s',
  } as Partial<CSSStyleDeclaration>);
  const knob = document.createElement('div');
  Object.assign(knob.style, {
    position: 'absolute',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: 'rgba(240, 220, 200, 0.95)',
    top: '2px',
    left: opts.get() ? '18px' : '2px',
    transition: 'left 0.15s',
  } as Partial<CSSStyleDeclaration>);
  switchEl.appendChild(knob);

  top.append(label, switchEl);
  row.appendChild(top);

  if (opts.description) {
    const desc = document.createElement('div');
    desc.textContent = opts.description;
    Object.assign(desc.style, {
      fontSize: '11px',
      color: 'rgba(160, 130, 100, 0.7)',
      fontStyle: 'italic',
    } as Partial<CSSStyleDeclaration>);
    row.appendChild(desc);
  }

  row.addEventListener('click', () => {
    const newVal = !opts.get();
    opts.set(newVal);
    switchEl.style.background = newVal ? 'rgba(255, 160, 80, 0.6)' : 'rgba(60, 40, 30, 0.6)';
    knob.style.left = newVal ? '18px' : '2px';
  });

  return row;
}
