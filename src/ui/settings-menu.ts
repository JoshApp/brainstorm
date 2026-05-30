import { getSettings, updateSettings } from '../settings/settings';
import { setMasterVolume, setReverbEnabled } from '../audio/sfx';
import { setMusicVolume } from '../audio/music';
import { openScreen, closeScreen } from './screen-manager';
import { getUpdateStatus, applyUpdate, onUpdateStatusChange } from '../pwa-update';

// Settings panel.
//
// Settings persisted via src/settings/settings.ts to localStorage.
// "Run actions" (abandon / quit / exit) live at the bottom of the
// panel — they're app-level shutdowns, kept out of mainline gameplay
// flow but discoverable when the player explicitly opens settings.

const PANEL_BG = 'rgba(20, 14, 10, 0.92)';
const BORDER = '1px solid rgba(180, 130, 90, 0.5)';

let panel: HTMLDivElement | null = null;
let panelOpen = false;

// Run-action handlers — wired by main.ts at boot via configureSettingsMenu.
// Kept out of this module's imports so settings doesn't need to know
// about run-state or the title screen.
interface RunActions {
  abandonRun: () => void;
  quitToMenu: () => void;
  exitGame:   () => void;
}
let runActions: RunActions | null = null;

export function configureSettingsMenu(actions: RunActions) {
  runActions = actions;
  if (panel) buildPanelContents();   // rebuild if already mounted
}

export function createSettingsMenu() {
  if (panel) return;

  // The panel itself, hidden by default. Built ONCE at boot so opens are
  // instant; only callers vary.
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
}

/** Public API — called by other UI (e.g. the inventory header gear)
 *  to open the settings panel. Idempotent. */
export function openSettings() { openPanel(); }
export function closeSettings() { closePanel(); }
export function toggleSettings() {
  if (panelOpen) closePanel(); else openPanel();
}

function openPanel() {
  if (!panel) return;
  panel.style.display = 'flex';
  panelOpen = true;
  openScreen({
    id: 'settings',
    root: panel,
    onDismissRequest: () => { if (panelOpen) closePanel(); },
  });
}

function closePanel() {
  if (!panel) return;
  panel.style.display = 'none';
  panelOpen = false;
  closeScreen('settings');
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

  // --- Music volume slider ---
  panel.appendChild(makeSlider({
    label: 'MUSIC VOLUME',
    min: 0, max: 1, step: 0.05,
    get: () => getSettings().musicVolume,
    set: (v) => {
      updateSettings({ musicVolume: v });
      setMusicVolume(v);
    },
    format: (v) => `${Math.round(v * 100)}%`,
  }));

  // --- Reverb toggle (mobile-perf escape hatch) ---
  panel.appendChild(makeToggle({
    label: 'REVERB',
    description: 'Adds a sense of room to sounds. Turn off if performance drops — the convolver is the most expensive piece of the audio chain on weaker phones.',
    get: () => getSettings().reverb,
    set: (v) => {
      updateSettings({ reverb: v });
      setReverbEnabled(v);
    },
  }));

  // --- Auto-update toggle + install-now button ---
  panel.appendChild(makeToggle({
    label: 'AUTO UPDATE',
    description: 'Install new builds automatically at safe moments (title screen, level transitions).',
    get: () => getSettings().autoUpdate,
    set: (v) => updateSettings({ autoUpdate: v }),
  }));
  panel.appendChild(makeToggle({
    label: 'DEV AUTO-UPDATE',
    description: 'For development. Apply pending updates the instant the service worker detects them, without waiting. Mid-floor state is lost on reload (resumes at floor entry).',
    get: () => getSettings().devAutoUpdate,
    set: (v) => updateSettings({ devAutoUpdate: v }),
  }));
  panel.appendChild(makeUpdateRow());

  // --- Debug capture toggle ---
  panel.appendChild(makeToggle({
    label: 'DEBUG MODE',
    description: 'Show the ⊕ CAPTURE button. Tap it on a glitch to copy a report + screenshot to share.',
    get: () => getSettings().debugMode,
    set: (v) => updateSettings({ debugMode: v }),
  }));

  // --- RUN ACTIONS ──────────────────────────────────────────────────
  // Bottom-of-panel danger-ish row. Three buttons in descending
  // commitment: ABANDON RUN wipes the save, QUIT keeps the save and
  // returns to title, EXIT tries to close the tab (mobile PWAs
  // usually just go to home). Two-step confirm on the destructive
  // ones so a fat-finger doesn't nuke a run.
  if (runActions) {
    const divider = document.createElement('div');
    Object.assign(divider.style, {
      height: '1px',
      background: 'rgba(180, 130, 90, 0.25)',
      margin: '4px 0',
    } as Partial<CSSStyleDeclaration>);
    panel.appendChild(divider);

    const sectionLabel = document.createElement('div');
    sectionLabel.textContent = 'RUN';
    Object.assign(sectionLabel.style, {
      fontSize: '10px',
      fontWeight: '600',
      letterSpacing: '0.30em',
      color: 'rgba(180, 130, 90, 0.7)',
    } as Partial<CSSStyleDeclaration>);
    panel.appendChild(sectionLabel);

    // CHARACTER — view attributes + proficiencies + spend points (at
    // safe rooms). Lives above the run-actions block so it's easy to
    // reach from touch without scrolling past the destructive buttons.
    panel.appendChild(makeRunButton({
      label: 'CHARACTER',
      description: 'View attributes + proficiencies. Spend points at safe rooms.',
      destructive: false,
      onClick: () => {
        closePanel();
        // Lazy import to avoid the settings menu pulling the screen at
        // module load.
        import('./character-screen').then(({ openCharacterScreen }) => openCharacterScreen());
      },
    }));
    panel.appendChild(makeRunButton({
      label: 'QUIT TO MENU',
      description: 'Return to the title screen. Your run is saved.',
      destructive: false,
      onClick: () => {
        closePanel();
        runActions!.quitToMenu();
      },
    }));
    panel.appendChild(makeRunButton({
      label: 'ABANDON RUN',
      description: 'Discard this run. Inventory, depth, and progress are lost.',
      destructive: true,
      onClick: () => {
        closePanel();
        runActions!.abandonRun();
      },
    }));
    panel.appendChild(makeRunButton({
      label: 'EXIT GAME',
      description: 'Close the game tab. (On mobile, returns to the home screen.)',
      destructive: false,
      onClick: () => runActions!.exitGame(),
    }));
  }
}

interface RunButtonOpts {
  label: string;
  description: string;
  destructive: boolean;
  onClick: () => void;
}

/** A two-step-confirm button. First tap arms the button (label
 *  becomes "TAP AGAIN TO CONFIRM"); second tap within 2.5s commits.
 *  Non-destructive buttons skip the confirm and fire immediately. */
function makeRunButton(opts: RunButtonOpts): HTMLDivElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  } as Partial<CSSStyleDeclaration>);

  const button = document.createElement('button');
  button.textContent = opts.label;
  const baseBg = opts.destructive ? 'rgba(60, 18, 12, 0.7)' : 'rgba(40, 28, 20, 0.7)';
  const baseBorder = opts.destructive ? 'rgba(200, 80, 60, 0.55)' : 'rgba(180, 130, 90, 0.5)';
  const baseColor = opts.destructive ? 'rgba(255, 190, 170, 0.95)' : 'rgba(230, 200, 170, 0.95)';
  Object.assign(button.style, {
    padding: '9px 14px',
    background: baseBg,
    border: `1px solid ${baseBorder}`,
    borderRadius: '3px',
    color: baseColor,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(button);

  const desc = document.createElement('div');
  desc.textContent = opts.description;
  Object.assign(desc.style, {
    fontSize: '10px',
    color: 'rgba(180, 140, 100, 0.7)',
    paddingLeft: '2px',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(desc);

  if (!opts.destructive) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClick();
    });
    return wrap;
  }

  // Destructive: two-step confirm.
  let armed = false;
  let armTimer: number | undefined;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      button.textContent = 'TAP AGAIN TO CONFIRM';
      button.style.background = 'rgba(120, 30, 22, 0.85)';
      button.style.borderColor = 'rgba(255, 120, 80, 0.85)';
      button.style.color = 'rgba(255, 230, 220, 0.98)';
      if (armTimer !== undefined) clearTimeout(armTimer);
      armTimer = window.setTimeout(() => {
        armed = false;
        button.textContent = opts.label;
        button.style.background = baseBg;
        button.style.borderColor = baseBorder;
        button.style.color = baseColor;
      }, 2500);
    } else {
      if (armTimer !== undefined) clearTimeout(armTimer);
      opts.onClick();
    }
  });
  return wrap;
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

/** Update status row: shows "UP TO DATE" (disabled) or "INSTALL UPDATE"
 *  (tappable, applies the pending SW). Live-updates when the status
 *  changes — subscribes to pwa-update via onUpdateStatusChange. */
function makeUpdateRow(): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.textContent = 'UPDATE';
  Object.assign(label.style, {
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.25em',
    color: 'rgba(220, 180, 140, 0.85)',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(label);

  const button = document.createElement('button');
  Object.assign(button.style, {
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.25em',
    borderRadius: '3px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);

  function render() {
    const pending = getUpdateStatus() === 'pending';
    if (pending) {
      button.textContent = 'INSTALL NOW';
      button.disabled = false;
      Object.assign(button.style, {
        background: 'rgba(255, 160, 80, 0.6)',
        border: '1px solid rgba(255, 200, 140, 0.8)',
        color: 'rgba(255, 240, 220, 0.98)',
      } as Partial<CSSStyleDeclaration>);
    } else {
      button.textContent = 'UP TO DATE';
      button.disabled = true;
      Object.assign(button.style, {
        background: 'rgba(40, 32, 26, 0.6)',
        border: '1px solid rgba(120, 90, 70, 0.4)',
        color: 'rgba(150, 130, 110, 0.65)',
        cursor: 'default',
      } as Partial<CSSStyleDeclaration>);
    }
  }
  render();
  onUpdateStatusChange(render);

  button.addEventListener('click', () => {
    if (getUpdateStatus() !== 'pending') return;
    button.textContent = 'INSTALLING…';
    button.disabled = true;
    void applyUpdate();   // triggers reload — this panel goes away with it
  });
  row.appendChild(button);

  return row;
}
